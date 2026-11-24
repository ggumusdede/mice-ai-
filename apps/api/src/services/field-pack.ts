// v0.5 S-15 / K-24 çevrimdışı saha paketi: günün paketi (ad + oda + transfer grubu + telefon), rol bazlı (saha personeli projede
// bir transfer grubuna atanmışsa yalnız o grup), cihazda şifreli (WebCrypto AES-GCM; anahtar bir kez döner, sunucuda yalnız
// özeti durur), uzaktan iptal ve süre sonu. Paket salt okunur: onay gerektiren hiçbir şey çevrimdışı yapılmaz.
import { createHash, randomBytes } from 'node:crypto';
import type { FieldPackData, FieldPackResponse, FieldPackStatus, FieldPackSummary } from '@mice/shared';
import { fieldPackExpiry, fieldPackGuests, localDate } from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { iso } from '../lib/dates.js';
import type { Row } from '../lib/mappers.js';
import { getProjectRow } from './projects.js';

const PACK_ROLES = new Set(['field', 'clerk_ops', 'admin']);
const STAFF_ROLES = new Set(['admin', 'clerk_ops']);

export async function issueFieldPack(ctx: Ctx, opts: { date?: string; device?: string | null } = {}): Promise<FieldPackResponse> {
  const user = requireUser(ctx);
  if (!PACK_ROLES.has(user.role)) throw forbidden('Saha paketi yalnız saha / operasyon / yönetici için', 'FIELD_PACK_ROLE');
  const rules = await ctx.rules();
  if (!rules.fieldPackEnabled) throw conflict('Çevrimdışı saha paketi bu acentada kapalı', 'FIELD_PACK_DISABLED');
  const tz = rules.businessHours.timezone;
  const day = opts.date ?? localDate(ctx.now(), tz);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw badRequest('Tarih YYYY-MM-DD olmalı', undefined, 'INVALID_DATE');
  // projects running that day; when a project has field-staff assignments, only the assigned people get it (and only their group)
  const projects = (await ctx.db.query(
    `SELECT p.id, p.code, p.title, p.venue_name, p.start_date, p.end_date,
            (SELECT count(*)::int FROM project_field_staff s WHERE s.project_id = p.id AND s.active) AS staffed,
            (SELECT s.transfer_group FROM project_field_staff s WHERE s.project_id = p.id AND s.active AND s.user_id = $2 LIMIT 1) AS my_group,
            EXISTS (SELECT 1 FROM project_field_staff s WHERE s.project_id = p.id AND s.active AND s.user_id = $2) AS assigned
       FROM projects p WHERE p.outcome IN ('won') AND NOT p.historical AND p.start_date <= $1::date AND COALESCE(p.end_date, p.start_date) >= $1::date
      ORDER BY p.start_date, p.code`, [day, user.id])).rows
    .filter((p) => user.role !== 'field' || !p.staffed || p.assigned);
  const data: FieldPackData = {
    packId: '', date: day, issuedAt: ctx.now().toISOString(), expiresAt: fieldPackExpiry(day, tz, rules.fieldPackValidHours).toISOString(),
    userName: user.fullName, projects: [],
  };
  let guestCount = 0;
  for (const p of projects) {
    const rows = (await ctx.db.query(
      `SELECT pgp_sym_decrypt(full_name_enc, $2) AS full_name, pgp_sym_decrypt(phone_enc, $2) AS phone, room_no, transfer_group, anonymized_at
         FROM guests WHERE project_id = $1 ORDER BY created_at`, [p.id, ctx.deps.config.guestDataKey])).rows;
    const guests = fieldPackGuests(rows.map((g) => ({ fullName: g.full_name, roomNo: g.room_no, transferGroup: g.transfer_group, phone: g.phone, anonymized: !!g.anonymized_at })), {
      includePhone: rules.fieldPackIncludePhone, onlyGroup: user.role === 'field' ? p.my_group ?? null : null,
    });
    guestCount += guests.length;
    data.projects.push({ id: p.id, code: p.code, title: p.title, venue: p.venue_name ?? null, startDate: p.start_date ? String(p.start_date).slice(0, 10) : null, endDate: p.end_date ? String(p.end_date).slice(0, 10) : null, guests });
  }
  const key = randomBytes(32);
  const row = (await ctx.db.query(
    `INSERT INTO field_packs (tenant_id, user_id, pack_date, project_ids, guest_count, key_hash, issued_at, expires_at, device)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [user.id, day, data.projects.map((p) => p.id), guestCount, createHash('sha256').update(key).digest('hex'), ctx.now(), data.expiresAt, opts.device?.slice(0, 200) ?? null])).rows[0];
  data.packId = row.id;
  return { pack: data, key: key.toString('base64') };
}

export async function fieldPackStatus(ctx: Ctx, id: string): Promise<FieldPackStatus> {
  const user = requireUser(ctx);
  const r = (await ctx.db.query('SELECT * FROM field_packs WHERE id = $1', [id])).rows[0];
  if (!r || (r.user_id !== user.id && user.role !== 'admin')) throw notFound('Paket');
  const revoked = !!r.revoked_at;
  const expired = new Date(r.expires_at) <= ctx.now();
  return { packId: r.id, valid: !revoked && !expired, revokedAt: iso(r.revoked_at), expiresAt: iso(r.expires_at)!, reason: revoked ? 'revoked' : expired ? 'expired' : 'ok' };
}

const mapSummary = (r: Row): FieldPackSummary => ({
  id: r.id, userId: r.user_id, userName: r.user_name ?? '', date: String(r.pack_date).slice(0, 10), issuedAt: iso(r.issued_at)!, expiresAt: iso(r.expires_at)!,
  revokedAt: iso(r.revoked_at), guestCount: r.guest_count,
});

export async function listFieldPacks(ctx: Ctx): Promise<FieldPackSummary[]> {
  const user = requireUser(ctx);
  const { rows } = await ctx.db.query(
    `SELECT f.*, u.full_name AS user_name FROM field_packs f JOIN users u ON u.id = f.user_id
      WHERE ($1::boolean OR f.user_id = $2) AND f.issued_at > $3 ORDER BY f.issued_at DESC LIMIT 200`,
    [user.role === 'admin', user.id, new Date(ctx.now().getTime() - 14 * 86_400_000)]);
  return rows.map(mapSummary);
}

export async function revokeFieldPack(ctx: Ctx, id: string, reason?: string): Promise<FieldPackSummary> {
  const user = requireUser(ctx);
  const r = (await ctx.db.query('SELECT user_id FROM field_packs WHERE id = $1', [id])).rows[0];
  if (!r) throw notFound('Paket');
  // admin revokes anyone's pack (lost phone); a user may revoke their own
  if (user.role !== 'admin' && r.user_id !== user.id) throw forbidden('Paketi yalnız yönetici iptal eder', 'ADMIN_ONLY');
  await ctx.db.query(`UPDATE field_packs SET revoked_at = COALESCE(revoked_at, $2), revoked_by = COALESCE(revoked_by, $3), revoke_reason = COALESCE(revoke_reason, $4) WHERE id = $1`,
    [id, ctx.now(), user.id, reason?.trim() || 'manual']);
  return mapSummary((await ctx.db.query('SELECT f.*, u.full_name AS user_name FROM field_packs f JOIN users u ON u.id = f.user_id WHERE f.id = $1', [id])).rows[0]);
}

// ------------------------------------------------------------------ saha ekibi ataması + misafir oda / grup bilgisi
export async function listFieldStaff(ctx: Ctx, projectId: string): Promise<{ userId: string; userName: string; transferGroup: string | null }[]> {
  await getProjectRow(ctx, projectId);
  const { rows } = await ctx.db.query(
    `SELECT s.user_id, u.full_name, s.transfer_group FROM project_field_staff s JOIN users u ON u.id = s.user_id WHERE s.project_id = $1 AND s.active ORDER BY u.full_name`, [projectId]);
  return rows.map((r) => ({ userId: r.user_id, userName: r.full_name, transferGroup: r.transfer_group ?? null }));
}

export async function setFieldStaff(ctx: Ctx, projectId: string, b: { userId: string; transferGroup?: string | null; active?: boolean }): Promise<{ userId: string; userName: string; transferGroup: string | null }[]> {
  const user = requireUser(ctx);
  if (!STAFF_ROLES.has(user.role)) throw forbidden('Saha ekibini yönetici / operasyon atar');
  await getProjectRow(ctx, projectId);
  await ctx.db.query('UPDATE project_field_staff SET active = false WHERE project_id = $1 AND user_id = $2 AND active', [projectId, b.userId]);
  if (b.active !== false) {
    await ctx.db.query(`INSERT INTO project_field_staff (tenant_id, project_id, user_id, transfer_group, created_by) VALUES (app_tenant_id(), $1,$2,$3,$4)`,
      [projectId, b.userId, b.transferGroup?.trim() || null, user.id]);
  }
  return listFieldStaff(ctx, projectId);
}

export async function setGuestFieldInfo(ctx: Ctx, guestId: string, b: { roomNo?: string | null; transferGroup?: string | null }): Promise<{ id: string; roomNo: string | null; transferGroup: string | null }> {
  const user = requireUser(ctx);
  if (!STAFF_ROLES.has(user.role)) throw forbidden('Oda / grup bilgisini yönetici / operasyon girer');
  const { rows } = await ctx.db.query(
    `UPDATE guests SET room_no = CASE WHEN $2::boolean THEN $3 ELSE room_no END, transfer_group = CASE WHEN $4::boolean THEN $5 ELSE transfer_group END
      WHERE id = $1 AND anonymized_at IS NULL RETURNING id, room_no, transfer_group`,
    [guestId, b.roomNo !== undefined, b.roomNo?.trim() || null, b.transferGroup !== undefined, b.transferGroup?.trim() || null]);
  if (!rows[0]) throw notFound('Misafir');
  return { id: rows[0].id, roomNo: rows[0].room_no, transferGroup: rows[0].transfer_group };
}
