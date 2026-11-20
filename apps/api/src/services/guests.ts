// §7 Adım 6 / §17.9 KVKK: rooming list in the personal-data layer. Names / e-mail / phone are encrypted at rest with
// pgcrypto (pgp_sym_encrypt, key = GUEST_DATA_KEY, never stored in the DB). Only roles with 'view_guest_pii' see clear
// text; everyone else gets masked names. Consent is explicit per guest, recorded as consent_events; non-consenting guests
// are anonymized when the legal retention period (rules.guestDataRetentionDays, from event end) has passed.
import type { Guest, PublicRoomingSubmit, PublicRoomingView } from '@mice/shared';
import { retentionUntil, roleCan, shouldAnonymize } from '@mice/domain';
import type { Ctx } from '../context.js';
import { badRequest, conflict, forbidden, gone, notFound } from '../errors.js';
import { iso, isoDate } from '../lib/dates.js';
import { newPublicToken } from '../lib/crypto.js';
import type { Row } from '../lib/mappers.js';
import { getProjectRow } from './projects.js';

export const CONSENT_TEXT_VERSION = 'kvkk-rooming-v1';

export interface GuestInput {
  fullName: string; email?: string | null; phone?: string | null; roomType?: string | null; arrival?: string | null; departure?: string | null;
  consentReuse?: boolean;
}

/** Masked label for roles without 'view_guest_pii' (the name is never decrypted for them). */
export function maskedGuestLabel(index: number, roomType: string | null): string {
  return `Misafir ${index + 1}${roomType ? ` (${roomType})` : ''} — ***`;
}

const SELECT_GUEST = (decrypt: boolean) => decrypt
  ? `SELECT g.*, pgp_sym_decrypt(g.full_name_enc, $KEY) AS full_name, pgp_sym_decrypt(g.email_enc, $KEY) AS email,
       pgp_sym_decrypt(g.phone_enc, $KEY) AS phone FROM guests g`
  // unauthorized roles: nothing is decrypted at all (the key parameter is bound but unused)
  : `SELECT g.*, NULL::text AS full_name, NULL::text AS email, NULL::text AS phone, $KEY::text IS NULL AS _k FROM guests g`;

function mapGuest(r: Row, clear: boolean, index: number): Guest {
  return {
    id: r.id, projectId: r.project_id,
    fullName: r.anonymized_at ? '[anonim]' : clear ? (r.full_name ?? '') : maskedGuestLabel(index, r.room_type),
    email: clear && !r.anonymized_at ? r.email ?? null : null,
    phone: clear && !r.anonymized_at ? r.phone ?? null : null,
    roomType: r.room_type, arrival: r.arrival, departure: r.departure, consentReuse: r.consent_reuse,
    consentAt: iso(r.consent_at), consentWithdrawnAt: iso(r.consent_withdrawn_at), anonymizedAt: iso(r.anonymized_at),
    retentionUntil: r.retention_until,
  };
}

async function queryGuests(ctx: Ctx, where: string, params: unknown[], clear: boolean): Promise<Row[]> {
  // the key is passed as the LAST bind parameter; it is never logged nor stored
  const keyIdx = params.length + 1;
  const sql = `${SELECT_GUEST(clear).split('$KEY').join(`$${keyIdx}`)} WHERE ${where} ORDER BY g.created_at`;
  return (await ctx.db.query(sql, [...params, ctx.deps.config.guestDataKey])).rows;
}

export async function listGuests(ctx: Ctx, projectId: string): Promise<Guest[]> {
  await getProjectRow(ctx, projectId);
  const clear = !!ctx.user && roleCan(ctx.user.role, 'view_guest_pii');
  return (await queryGuests(ctx, 'g.project_id = $1', [projectId], clear)).map((r, i) => mapGuest(r, clear, i));
}

async function retentionFor(ctx: Ctx, p: Row): Promise<string | null> {
  const rules = await ctx.rules();
  const end = p.end_date ?? p.start_date ?? isoDate(ctx.now());
  return retentionUntil(end, rules.guestDataRetentionDays);
}

/** Inserts guests (encrypted). Returns the new rows' ids. */
export async function insertGuests(ctx: Ctx, projectId: string, guests: GuestInput[], source: 'staff' | 'rooming_form'): Promise<string[]> {
  const p = await getProjectRow(ctx, projectId);
  const retention = await retentionFor(ctx, p);
  const key = ctx.deps.config.guestDataKey;
  const ids: string[] = [];
  for (const g of guests) {
    if (!g.fullName?.trim()) throw badRequest('Misafir adı zorunlu', undefined, 'GUEST_NAME_REQUIRED');
    const consent = g.consentReuse === true;
    const row = (await ctx.db.query(
      `INSERT INTO guests (tenant_id, project_id, full_name_enc, email_enc, phone_enc, room_type, arrival, departure, consent_reuse, consent_at,
         consent_text_version, retention_until, source, created_at)
       VALUES (app_tenant_id(), $1, pgp_sym_encrypt($2, $11), CASE WHEN $3::text IS NULL THEN NULL ELSE pgp_sym_encrypt($3, $11) END,
         CASE WHEN $4::text IS NULL THEN NULL ELSE pgp_sym_encrypt($4, $11) END, $5, $6, $7, $8, $9, $10, $12, $13, clock_timestamp()) RETURNING id`,
      [projectId, g.fullName.trim(), g.email?.trim() || null, g.phone?.trim() || null, g.roomType ?? null, g.arrival || null, g.departure || null,
        consent, consent ? ctx.now() : null, consent ? CONSENT_TEXT_VERSION : null, key, retention, source],
    )).rows[0];
    if (consent) {
      await ctx.db.query(`INSERT INTO consent_events (tenant_id, guest_id, event, channel, at) VALUES (app_tenant_id(), $1, 'given', $2, $3)`, [row.id, source, ctx.now()]);
    }
    ids.push(row.id);
  }
  return ids;
}

export async function staffAddGuests(ctx: Ctx, projectId: string, guests: GuestInput[]): Promise<Guest[]> {
  const user = ctx.user!;
  if (!roleCan(user.role, 'view_guest_pii')) throw forbidden('Misafir kişisel verisi için yetkiniz yok (KVKK)', 'PII_FORBIDDEN');
  await insertGuests(ctx, projectId, guests, 'staff');
  return listGuests(ctx, projectId);
}

// ------------------------------------------------------------------ public rooming form (/r/<token>)
export async function createRoomingLink(ctx: Ctx, projectId: string): Promise<{ url: string }> {
  const p = await getProjectRow(ctx, projectId);
  const { token, hash } = newPublicToken();
  // read-only from the event start; the link itself expires 30 days after the event
  const readOnlyAfter = p.start_date ? new Date(`${p.start_date}T00:00:00Z`) : null;
  const expires = p.end_date ? new Date(Date.parse(`${p.end_date}T00:00:00Z`) + 30 * 86_400_000) : null;
  await ctx.db.query(
    `INSERT INTO public_tokens (tenant_id, purpose, token_hash, entity_type, entity_id, expires_at, read_only_after) VALUES (app_tenant_id(), 'rooming', $1, 'project', $2, $3, $4)`,
    [hash, projectId, expires, readOnlyAfter]);
  return { url: `${ctx.deps.config.publicBaseUrl}/r/${token}` };
}

async function tokenRow(ctx: Ctx, purpose: string, entityId: string): Promise<Row | null> {
  // the public route already resolved the token by hash; pick the matching live token row for its validity window
  const { rows } = await ctx.db.query(
    `SELECT * FROM public_tokens WHERE purpose = $1 AND entity_id = $2 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`, [purpose, entityId]);
  return rows[0] ?? null;
}

async function agencyName(ctx: Ctx): Promise<string> {
  return (await ctx.db.query('SELECT name FROM tenants WHERE id = $1', [ctx.tenantId])).rows[0]?.name ?? '';
}

export async function publicRoomingView(ctx: Ctx, projectId: string, tokenHash: string): Promise<PublicRoomingView> {
  const p = await getProjectRow(ctx, projectId);
  const t = (await ctx.db.query('SELECT * FROM public_tokens WHERE token_hash = $1', [tokenHash])).rows[0] ?? (await tokenRow(ctx, 'rooming', projectId));
  if (t?.expires_at && new Date(t.expires_at) < ctx.now()) throw gone('Bağlantının süresi doldu', 'LINK_EXPIRED');
  const items = (await ctx.db.query(`SELECT specs FROM service_items WHERE project_id = $1 AND kind = 'accommodation' AND status <> 'cancelled'`, [projectId])).rows;
  const roomTypes = new Set<string>();
  for (const i of items) if (typeof i.specs?.roomType === 'string') roomTypes.add(i.specs.roomType);
  if (p.rooms_sgl) roomTypes.add('SGL');
  if (p.rooms_dbl) roomTypes.add('DBL');
  if (!roomTypes.size) ['SGL', 'DBL'].forEach((x) => roomTypes.add(x));
  const submitted = (await ctx.db.query(`SELECT count(*)::int AS n FROM guests WHERE project_id = $1 AND source = 'rooming_form'`, [projectId])).rows[0].n;
  return {
    agencyName: await agencyName(ctx), projectCode: p.code, eventTitle: p.title, startDate: p.start_date, endDate: p.end_date,
    roomTypes: [...roomTypes], privacyNoticeUrl: null, deadlineAt: iso(t?.read_only_after ?? null),
    readOnly: !!(t?.read_only_after && new Date(t.read_only_after) <= ctx.now()), submittedCount: submitted,
  };
}

/** Public submit: guests saved encrypted; consenting guests get a personal withdrawal link by e-mail (§17.9). */
export async function publicRoomingSubmit(ctx: Ctx, projectId: string, tokenHash: string, body: PublicRoomingSubmit): Promise<{ ok: true; saved: number }> {
  const view = await publicRoomingView(ctx, projectId, tokenHash);
  if (view.readOnly) throw conflict('Rooming list formu kapandı (etkinlik başladı)', 'ROOMING_READ_ONLY');
  if (!body.guests.length) throw badRequest('En az bir misafir girin', undefined, 'NO_GUESTS');
  const ids = await insertGuests(ctx, projectId, body.guests, 'rooming_form');
  await ctx.db.query('UPDATE public_tokens SET last_used_at = $2, use_count = use_count + 1 WHERE token_hash = $1', [tokenHash, ctx.now()]);
  const p = await getProjectRow(ctx, projectId);
  // sent from the responsible person's address (project owner, else the agency admin)
  const sender = (await ctx.db.query(
    `SELECT email FROM users WHERE active AND (id = $1 OR role = 'admin') ORDER BY (id = $1) DESC NULLS LAST, created_at LIMIT 1`, [p.owner_id])).rows[0]?.email ?? null;
  for (let i = 0; i < ids.length; i++) {
    const g = body.guests[i];
    if (!g.consentReuse) continue;
    const { token, hash } = newPublicToken();
    await ctx.db.query(
      `INSERT INTO public_tokens (tenant_id, purpose, token_hash, entity_type, entity_id) VALUES (app_tenant_id(), 'consent', $1, 'guest', $2)`, [hash, ids[i]]);
    if (g.email && sender) {
      const url = `${ctx.deps.config.publicBaseUrl}/api/public/consent/${token}/withdraw`;
      // transactional KVKK notice to the data subject (not a sales message): the withdrawal link is redacted in the outbox copy
      await ctx.deps.email.send(ctx.db, {
        tenantId: ctx.tenantId, from: sender, to: g.email, subject: `${view.agencyName}: kişisel veri izniniz`,
        body: `Merhaba ${g.fullName},\n\n${p.code} etkinliği için bilgilerinizin sonraki etkinliklerde kullanılmasına izin verdiniz. İzninizi dilediğiniz zaman geri alabilirsiniz:\n${url}\n\n${view.agencyName}`,
        secrets: [token], autonomous: true,
      });
    }
  }
  return { ok: true, saved: ids.length };
}

/** Withdraw consent (public token or staff). Anonymizes immediately when the retention period has already passed. */
export async function withdrawConsent(ctx: Ctx, guestId: string, channel: string): Promise<{ ok: true; anonymized: boolean }> {
  const g = (await ctx.db.query('SELECT * FROM guests WHERE id = $1 FOR UPDATE', [guestId])).rows[0];
  if (!g) throw notFound('Misafir');
  if (!g.consent_withdrawn_at) {
    await ctx.db.query('UPDATE guests SET consent_withdrawn_at = $2, consent_reuse = false WHERE id = $1', [guestId, ctx.now()]);
    await ctx.db.query(`INSERT INTO consent_events (tenant_id, guest_id, event, channel, at) VALUES (app_tenant_id(), $1, 'withdrawn', $2, $3)`, [guestId, channel, ctx.now()]);
  }
  await ctx.db.query(`UPDATE public_tokens SET revoked_at = $2 WHERE purpose = 'consent' AND entity_id = $1 AND revoked_at IS NULL`, [guestId, ctx.now()]);
  const fresh = (await ctx.db.query('SELECT * FROM guests WHERE id = $1', [guestId])).rows[0];
  const now = shouldAnonymize({ consentReuse: fresh.consent_reuse, consentWithdrawnAt: iso(fresh.consent_withdrawn_at), anonymizedAt: iso(fresh.anonymized_at), retentionUntil: fresh.retention_until }, ctx.now());
  if (now) await anonymizeGuest(ctx, guestId);
  return { ok: true, anonymized: now };
}

export async function anonymizeGuest(ctx: Ctx, guestId: string, now: Date = ctx.now()): Promise<void> {
  await ctx.db.query(
    `UPDATE guests SET full_name_enc = NULL, email_enc = NULL, phone_enc = NULL, anonymized_at = $2 WHERE id = $1 AND anonymized_at IS NULL`, [guestId, now]);
  await ctx.db.query(`INSERT INTO consent_events (tenant_id, guest_id, event, channel, at) VALUES (app_tenant_id(), $1, 'anonymized', 'system', $2)`, [guestId, now]);
  await ctx.db.query(`UPDATE public_tokens SET revoked_at = $2 WHERE purpose = 'consent' AND entity_id = $1 AND revoked_at IS NULL`, [guestId, now]);
}

/** Worker job (KVKK m.4): anonymize every guest whose data may no longer be kept. */
export async function runAnonymization(ctx: Ctx, now: Date): Promise<number> {
  const { rows } = await ctx.db.query(
    `SELECT id, consent_reuse, consent_withdrawn_at, anonymized_at, retention_until FROM guests WHERE anonymized_at IS NULL`);
  let n = 0;
  for (const g of rows) {
    if (shouldAnonymize({ consentReuse: g.consent_reuse, consentWithdrawnAt: iso(g.consent_withdrawn_at), anonymizedAt: null, retentionUntil: g.retention_until }, now)) {
      await anonymizeGuest(ctx, g.id, now);
      n++;
    }
  }
  return n;
}
