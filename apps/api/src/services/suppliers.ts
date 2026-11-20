// Block 1 — suppliers. New suppliers are ALWAYS 'candidate'; accreditation only by the admin via a decision (§7 Adım 1, §6).
import type { ServiceKind, Supplier, SupplierRanking } from '@mice/shared';
import { rankSuppliers, roleCan } from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { mapSupplier, type Row } from '../lib/mappers.js';
import { createDecision } from './decisions.js';

export async function getSupplierRow(ctx: Ctx, id: string): Promise<Row> {
  const { rows } = await ctx.db.query('SELECT * FROM suppliers WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Tedarikçi');
  return rows[0];
}

export async function listSuppliers(ctx: Ctx, f: { kind?: string; city?: string; status?: string; q?: string }): Promise<Supplier[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.kind) { params.push(f.kind); where.push(`$${params.length} = ANY(kinds)`); }
  if (f.city) { params.push(f.city); where.push(`lower(city) = lower($${params.length})`); }
  if (f.status) { params.push(f.status); where.push(`status = $${params.length}`); }
  if (f.q) { params.push(`%${f.q}%`); where.push(`name ILIKE $${params.length}`); }
  const { rows } = await ctx.db.query(`SELECT * FROM suppliers ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY name`, params);
  return rows.map(mapSupplier);
}

const COLS: Record<string, string> = {
  name: 'name', kinds: 'kinds', city: 'city', district: 'district', lat: 'lat', lng: 'lng', capacityPax: 'capacity_pax',
  roomCount: 'room_count', halls: 'halls', segment: 'segment', email: 'email', phone: 'phone', contactName: 'contact_name',
  commission: 'commission', paymentTerms: 'payment_terms',
};
const JSON_COLS = new Set(['halls', 'commission']);

export async function createSupplier(ctx: Ctx, input: Partial<Supplier>): Promise<Supplier> {
  const user = requireUser(ctx);
  if (!roleCan(user.role, 'create_candidate_supplier')) throw forbidden('Tedarikçi kaydı açma yetkiniz yok');
  if (!input.name || !input.city) throw badRequest('Tedarikçi adı ve şehir zorunludur');
  const cols: string[] = ['tenant_id', 'status', 'created_by'];
  const vals: unknown[] = ['candidate', user.id];
  const ph: string[] = ['app_tenant_id()', '$1', '$2'];
  for (const [k, col] of Object.entries(COLS)) {
    const v = (input as Record<string, unknown>)[k];
    if (v === undefined) continue;
    vals.push(JSON_COLS.has(col) ? JSON.stringify(v) : v);
    cols.push(col);
    ph.push(`$${vals.length}`);
  }
  const { rows } = await ctx.db.query(`INSERT INTO suppliers (${cols.join(', ')}) VALUES (${ph.join(', ')}) RETURNING *`, vals);
  return mapSupplier(rows[0]);
}

/** PATCH: data fields update directly; status → 'accredited' never applies directly — it opens an admin-only decision. */
export async function patchSupplier(ctx: Ctx, id: string, input: Partial<Supplier> & { reason?: string }): Promise<Supplier> {
  const user = requireUser(ctx);
  const s = await getSupplierRow(ctx, id);
  const sets: string[] = [];
  const vals: unknown[] = [id];
  for (const [k, col] of Object.entries(COLS)) {
    const v = (input as Record<string, unknown>)[k];
    if (v === undefined) continue;
    vals.push(JSON_COLS.has(col) ? JSON.stringify(v) : v);
    sets.push(`${col} = $${vals.length}`);
  }
  if (input.status && input.status !== s.status) {
    if (input.status === 'accredited') {
      const open = await ctx.db.query(`SELECT 1 FROM decisions WHERE kind = 'supplier_accreditation' AND status = 'open' AND entity_id = $1`, [id]);
      if (!open.rowCount) {
        await createDecision(ctx, {
          kind: 'supplier_accreditation', badge: 'suggestion', summary: `${s.name} akredite edilsin mi?`,
          detail: { supplierId: id, name: s.name, city: s.city, district: s.district, kinds: s.kinds, requestedBy: user.fullName, reason: input.reason ?? null },
          requiredRole: 'admin', entityType: 'supplier', entityId: id, primaryActionLabel: 'Akredite et',
        });
      }
    } else if (input.status === 'passive') {
      if (user.role !== 'admin') throw forbidden('Tedarikçiyi pasife yalnızca yönetici alabilir');
      vals.push('passive');
      sets.push(`status = $${vals.length}`);
    } else if (input.status === 'candidate') {
      throw badRequest('Akredite tedarikçi adaya düşürülemez; pasife alın');
    }
  }
  if (!sets.length) return mapSupplier((await ctx.db.query('SELECT * FROM suppliers WHERE id = $1', [id])).rows[0]);
  const { rows } = await ctx.db.query(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
  return mapSupplier(rows[0]);
}

/** Decision effect (admin only, enforced by canDecide + ADMIN_ONLY_DECISIONS): accredit. */
export async function accreditSupplier(ctx: Ctx, id: string, adminId: string): Promise<void> {
  await ctx.db.query(`UPDATE suppliers SET status = 'accredited', accredited_by = $2, accredited_at = $3 WHERE id = $1`, [id, adminId, ctx.now()]);
}

/** Average historical advantage per supplier for a kind: (overall mean − supplier mean) / overall mean. */
async function historicalAdvantage(ctx: Ctx, kind: string, city: string | null): Promise<Record<string, number>> {
  const { rows } = await ctx.db.query(
    `WITH h AS (SELECT supplier_id, unit_price_eur FROM price_history WHERE kind = $1 AND ($2::text IS NULL OR lower(city) = lower($2)) AND supplier_id IS NOT NULL),
          o AS (SELECT avg(unit_price_eur) AS m FROM h)
     SELECT h.supplier_id, (o.m - avg(h.unit_price_eur)) / NULLIF(o.m, 0) AS adv FROM h, o GROUP BY h.supplier_id, o.m`,
    [kind, city],
  );
  const out: Record<string, number> = {};
  for (const r of rows) if (r.adv != null) out[r.supplier_id] = Number(r.adv);
  return out;
}

export async function rankForProject(ctx: Ctx, p: Row, kind: ServiceKind, rooms?: number | null): Promise<SupplierRanking[]> {
  const { rows } = await ctx.db.query(`SELECT * FROM suppliers WHERE status <> 'passive' AND $1 = ANY(kinds)`, [kind]);
  const adv = await historicalAdvantage(ctx, kind, p.city);
  return rankSuppliers(rows.map(mapSupplier), {
    kind, city: p.city, district: p.district, pax: p.pax,
    rooms: rooms ?? ((p.rooms_sgl ?? 0) + (p.rooms_dbl ?? 0) || null), avgHistoricalAdvantage: adv,
  });
}
