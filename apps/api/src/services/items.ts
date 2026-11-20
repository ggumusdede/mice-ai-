// §5 Hizmet kalemleri. Every item has its own RFQs, offers (versions), selected supplier, contract, finance lines.
import type { ServiceItem, ServiceItemInput, SupplierRanking } from '@mice/shared';
import type { Ctx } from '../context.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { mapServiceItem, type Row } from '../lib/mappers.js';
import { getProjectRow } from './projects.js';
import { rankForProject } from './suppliers.js';

export async function getItemRow(ctx: Ctx, id: string, forUpdate = false): Promise<Row> {
  const { rows } = await ctx.db.query(`SELECT * FROM service_items WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) throw notFound('Hizmet kalemi');
  return rows[0];
}

export async function createItem(ctx: Ctx, projectId: string, input: ServiceItemInput): Promise<ServiceItem> {
  const p = await getProjectRow(ctx, projectId);
  if (['lost', 'cancelled', 'closed'].includes(p.outcome)) throw conflict('Kapalı projeye kalem eklenemez', 'PROJECT_CLOSED');
  const sort = (await ctx.db.query('SELECT COALESCE(max(sort), -1) + 1 AS s FROM service_items WHERE project_id = $1', [projectId])).rows[0].s;
  const { rows } = await ctx.db.query(
    `INSERT INTO service_items (tenant_id, project_id, kind, description, date_from, date_to, quantity, unit, nights, specs, value_add, sort)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [projectId, input.kind, input.description, input.dateFrom ?? p.start_date, input.dateTo ?? p.end_date, input.quantity, input.unit,
      input.nights ?? null, JSON.stringify(input.specs ?? {}), input.valueAdd ?? false, sort],
  );
  return mapServiceItem(rows[0]);
}

const COLS: Record<string, string> = {
  kind: 'kind', description: 'description', dateFrom: 'date_from', dateTo: 'date_to', quantity: 'quantity', unit: 'unit',
  nights: 'nights', specs: 'specs', valueAdd: 'value_add', status: 'status',
};

export async function patchItem(ctx: Ctx, id: string, input: Partial<ServiceItemInput> & { status?: string }): Promise<ServiceItem> {
  await getItemRow(ctx, id, true);
  if (input.status && !['cancelled', 'open'].includes(input.status)) throw badRequest('Kalem durumu yalnızca iptal / açık yapılabilir');
  const sets: string[] = [];
  const vals: unknown[] = [id];
  for (const [k, col] of Object.entries(COLS)) {
    const v = (input as Record<string, unknown>)[k];
    if (v === undefined) continue;
    vals.push(col === 'specs' ? JSON.stringify(v) : v);
    sets.push(`${col} = $${vals.length}`);
  }
  if (!sets.length) return mapServiceItem(await getItemRow(ctx, id));
  const { rows } = await ctx.db.query(`UPDATE service_items SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
  if (input.status === 'cancelled') {
    await ctx.db.query(
      `UPDATE rfqs SET status = 'cancelled', closed_reason = 'item_cancelled', link_expires_at = $2 WHERE service_item_id = $1 AND status NOT IN ('closed','cancelled')`,
      [id, ctx.now()],
    );
  }
  return mapServiceItem(rows[0]);
}

export async function selectOffer(ctx: Ctx, id: string, offerId: string): Promise<ServiceItem> {
  await getItemRow(ctx, id, true);
  const o = (await ctx.db.query('SELECT * FROM supplier_offers WHERE id = $1 AND service_item_id = $2', [offerId, id])).rows[0];
  if (!o) throw notFound('Bu kaleme ait teklif');
  if (o.superseded_by) throw conflict('Bu teklif sürümü eskidi; güncel sürümü seçin', 'OFFER_SUPERSEDED');
  const { rows } = await ctx.db.query(`UPDATE service_items SET selected_offer_id = $2, status = 'selected' WHERE id = $1 RETURNING *`, [id, offerId]);
  return mapServiceItem(rows[0]);
}

export async function shortlistForItem(ctx: Ctx, id: string): Promise<SupplierRanking[]> {
  const it = await getItemRow(ctx, id);
  const p = await getProjectRow(ctx, it.project_id);
  return rankForProject(ctx, p, it.kind, it.kind === 'accommodation' ? Number(it.quantity) : null);
}
