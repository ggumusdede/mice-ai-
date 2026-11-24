// v0.5 S-03 tedarik çekirdeği (K-11 kontrat fiyatı, K-12 allotment / release / attrition, K-13 opsiyon sırası + uzatma).
// The system computes and reminds; humans decide. Releasing rooms or dropping / extending an option is never automatic (AI forbidden
// list: allotment_release) and every message to the supplier is a draft that a human approves (ana çatı 6).
import type { AllotmentBlock, AllotmentInput, ContractRate, ContractRateInput, SupplierOption, SupplierOptionInput } from '@mice/shared';
import { allotmentSummary, localDate, needsReleaseCard, nextOptionRank, optionCardDue, optionRankWarning, validateExtension } from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import type { Row } from '../lib/mappers.js';
import { createDecision, expireDecisionsFor } from './decisions.js';
import { aiDraft, createDraft } from './drafts.js';
import { supplierRef } from './visibility.js';

const d10 = (v: unknown): string => String(v).slice(0, 10);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const today = async (ctx: Ctx) => localDate(ctx.now(), (await ctx.rules()).businessHours.timezone);

function assertHuman(ctx: Ctx): void {
  if (ctx.actor.type !== 'user' || !ctx.user) throw forbidden('Bu işlem yalnız insan tarafından yapılır (yapay zekâ yasak listesi)', 'AI_FORBIDDEN_ACTION');
}
function assertBuyer(ctx: Ctx): void {
  const u = requireUser(ctx);
  if (!['admin', 'clerk_sales', 'clerk_ops'].includes(u.role)) throw forbidden('Tedarik kayıtlarını yönetici veya operasyon / satış ekibi girer', 'FORBIDDEN');
}

// ------------------------------------------------------------------ K-11 contract rates
const mapRate = (r: Row): ContractRate => ({
  id: r.id, supplierId: r.supplier_id, supplierName: r.supplier_name ?? null, kind: r.kind, roomType: r.room_type, board: r.board, unit: r.unit,
  validFrom: d10(r.valid_from), validTo: d10(r.valid_to), price: Number(r.price), currency: r.currency, vatIncluded: !!r.vat_included,
  conditions: r.conditions, status: r.status, createdAt: iso(r.created_at),
});

export async function listContractRates(ctx: Ctx, f: { supplierId?: string; includeArchived?: boolean } = {}): Promise<ContractRate[]> {
  const { rows } = await ctx.db.query(
    `SELECT cr.*, s.name AS supplier_name FROM contract_rates cr JOIN suppliers s ON s.id = cr.supplier_id
      WHERE ($1::uuid IS NULL OR cr.supplier_id = $1) AND ($2::boolean OR cr.status = 'active') ORDER BY s.name, cr.valid_from DESC`,
    [f.supplierId ?? null, !!f.includeArchived]);
  return rows.map(mapRate);
}

export async function createContractRate(ctx: Ctx, input: ContractRateInput): Promise<ContractRate> {
  assertBuyer(ctx);
  if (!(input.price > 0)) throw badRequest('Fiyat sıfırdan büyük olmalı', undefined, 'INVALID_PRICE');
  if (input.validTo < input.validFrom) throw badRequest('Geçerlilik bitişi başlangıçtan önce olamaz', undefined, 'INVALID_PERIOD');
  const s = (await ctx.db.query('SELECT id FROM suppliers WHERE id = $1', [input.supplierId])).rows[0];
  if (!s) throw notFound('Tedarikçi');
  const r = (await ctx.db.query(
    `INSERT INTO contract_rates (tenant_id, supplier_id, kind, room_type, board, unit, valid_from, valid_to, price, currency, vat_included, conditions, created_by)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [input.supplierId, input.kind, input.roomType?.trim() || null, input.board?.trim() || null, input.unit?.trim() || (input.kind === 'accommodation' ? 'room_night' : 'unit'),
      input.validFrom, input.validTo, input.price, input.currency, !!input.vatIncluded, input.conditions?.trim() || null, ctx.user!.id])).rows[0];
  return (await listContractRates(ctx, { includeArchived: true })).find((x) => x.id === r.id)!;
}

/** No delete (ana çatı 3): an outdated rate is archived. */
export async function archiveContractRate(ctx: Ctx, id: string): Promise<ContractRate> {
  assertBuyer(ctx);
  const r = (await ctx.db.query(`UPDATE contract_rates SET status = 'archived' WHERE id = $1 RETURNING id`, [id])).rows[0];
  if (!r) throw notFound('Kontrat fiyatı');
  return (await listContractRates(ctx, { includeArchived: true })).find((x) => x.id === id)!;
}

// ------------------------------------------------------------------ K-12 allotment
async function mapBlock(ctx: Ctx, r: Row, day?: string): Promise<AllotmentBlock> {
  const rules = await ctx.rules();
  const b: AllotmentBlock = {
    id: r.id, projectId: r.project_id, serviceItemId: r.service_item_id, supplierId: r.supplier_id, supplierName: r.supplier_name ?? null,
    roomType: r.room_type, dateFrom: d10(r.date_from), dateTo: d10(r.date_to), roomsPerNight: Number(r.rooms_per_night),
    ratePerRoomNight: Number(r.rate_per_room_night), currency: r.currency, releaseDate: r.release_date ? d10(r.release_date) : null,
    attritionPct: Number(r.attrition_pct), penaltyPct: Number(r.penalty_pct), penaltyTerms: r.penalty_terms, releasedRooms: Number(r.released_rooms),
    pickup: (r.pickup ?? []) as { date: string; rooms: number }[], status: r.status, createdAt: iso(r.created_at),
  };
  b.summary = allotmentSummary(b, day ?? (await today(ctx)), rules.allotmentReleaseWarningDays);
  return b;
}

async function blockRow(ctx: Ctx, id: string, forUpdate = false): Promise<Row> {
  const r = (await ctx.db.query(`SELECT a.*, s.name AS supplier_name FROM allotment_blocks a JOIN suppliers s ON s.id = a.supplier_id WHERE a.id = $1 ${forUpdate ? 'FOR UPDATE OF a' : ''}`, [id])).rows[0];
  if (!r) throw notFound('Allotment');
  return r;
}

export async function listAllotments(ctx: Ctx, f: { projectId?: string } = {}): Promise<AllotmentBlock[]> {
  const { rows } = await ctx.db.query(
    `SELECT a.*, s.name AS supplier_name FROM allotment_blocks a JOIN suppliers s ON s.id = a.supplier_id
      WHERE ($1::uuid IS NULL OR a.project_id = $1) ORDER BY a.date_from, s.name`, [f.projectId ?? null]);
  const day = await today(ctx);
  return Promise.all(rows.map((r) => mapBlock(ctx, r, day)));
}

export async function createAllotment(ctx: Ctx, input: AllotmentInput): Promise<AllotmentBlock> {
  assertBuyer(ctx);
  if (input.dateTo < input.dateFrom) throw badRequest('Son gece ilk geceden önce olamaz', undefined, 'INVALID_PERIOD');
  if (!(input.roomsPerNight > 0)) throw badRequest('Gecelik oda sayısı sıfırdan büyük olmalı', undefined, 'INVALID_ROOMS');
  if (input.releaseDate && input.releaseDate > input.dateFrom) throw badRequest('Release tarihi ilk geceden sonra olamaz', undefined, 'INVALID_RELEASE');
  const r = (await ctx.db.query(
    `INSERT INTO allotment_blocks (tenant_id, project_id, service_item_id, supplier_id, room_type, date_from, date_to, rooms_per_night, rate_per_room_night,
       currency, release_date, attrition_pct, penalty_pct, penalty_terms, created_by)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [input.projectId ?? null, input.serviceItemId ?? null, input.supplierId, input.roomType?.trim() || null, input.dateFrom, input.dateTo,
      Math.round(input.roomsPerNight), input.ratePerRoomNight, input.currency, input.releaseDate ?? null, input.attritionPct ?? 0,
      input.penaltyPct ?? 1, input.penaltyTerms?.trim() || null, ctx.user!.id])).rows[0];
  return mapBlock(ctx, await blockRow(ctx, r.id));
}

/** Nameless pickup count (rooms sold / named in the rooming list); date omitted = every night of the block. */
export async function recordPickup(ctx: Ctx, id: string, input: { date?: string; rooms: number }): Promise<AllotmentBlock> {
  requireUser(ctx);
  const r = await blockRow(ctx, id, true);
  if (!(input.rooms >= 0)) throw badRequest('Oda sayısı negatif olamaz', undefined, 'INVALID_ROOMS');
  const b = await mapBlock(ctx, r);
  const nights = input.date ? [input.date] : (await import('@mice/domain')).blockNights(b);
  if (input.date && (input.date < b.dateFrom || input.date > b.dateTo)) throw badRequest('Tarih blok gecelerinin dışında', undefined, 'INVALID_DATE');
  const pickup = new Map(b.pickup.map((p) => [p.date, p.rooms]));
  for (const n of nights) pickup.set(n, Math.round(input.rooms));
  await ctx.db.query('UPDATE allotment_blocks SET pickup = $2, updated_at = now() WHERE id = $1',
    [id, JSON.stringify([...pickup.entries()].sort().map(([date, rooms]) => ({ date, rooms })))]);
  return mapBlock(ctx, await blockRow(ctx, id));
}

/**
 * A human releases rooms back to the hotel (free before the release date). Records the release and prepares the supplier notice as a
 * DRAFT that goes out only after approval (outbound_message card) — never automatic.
 */
export async function releaseAllotment(ctx: Ctx, id: string, input: { rooms: number; reason?: string }): Promise<AllotmentBlock> {
  assertHuman(ctx);
  assertBuyer(ctx);
  const r = await blockRow(ctx, id, true);
  const b = await mapBlock(ctx, r);
  const rooms = Math.round(input.rooms);
  if (!(rooms > 0) || rooms > b.roomsPerNight - b.releasedRooms) throw badRequest('Geçersiz release oda sayısı', undefined, 'INVALID_ROOMS');
  const releases = [...((r.releases ?? []) as unknown[]), { rooms, at: ctx.now().toISOString(), by: ctx.user!.id, reason: input.reason?.trim() || null, beforeReleaseDate: b.summary?.stage !== 'after_release' }];
  const total = b.releasedRooms + rooms;
  await ctx.db.query(`UPDATE allotment_blocks SET released_rooms = $2, releases = $3, status = CASE WHEN $2 >= rooms_per_night THEN 'released' ELSE status END, updated_at = now() WHERE id = $1`,
    [id, total, JSON.stringify(releases)]);
  await expireDecisionsFor(ctx, 'allotment_block', id, ['allotment_release']);
  const s = (await ctx.db.query('SELECT name, email, contact_name FROM suppliers WHERE id = $1', [r.supplier_id])).rows[0];
  const p = r.project_id ? (await ctx.db.query('SELECT code, owner_id FROM projects WHERE id = $1', [r.project_id])).rows[0] : null;
  const ref = p ? await supplierRef(ctx, p.code, r.supplier_id) : 'Grup blokesi';
  const draft = await createDraft(ctx, {
    projectId: r.project_id, kind: 'other', to: s?.email ?? null, subject: `${ref}: oda release bildirimi`,
    body: `Merhaba ${s?.contact_name ?? s?.name ?? ''},\n\n${ref} referanslı ${b.dateFrom} – ${b.dateTo} grup blokemizden gecelik ${rooms} odayı release ediyoruz. `
      + `Güncel blok: gecelik ${b.roomsPerNight - total} oda.\n\nTeşekkürler,\n${ctx.user!.fullName}`,
    status: 'pending_approval', requiresApproval: true, fromUserId: ctx.user!.id, entityType: 'allotment_block', entityId: id,
  });
  await createDecision(ctx, {
    projectId: r.project_id, kind: 'outbound_message', badge: 'suggestion', summary: `${ref}: ${s?.name ?? ''} release bildirimi (${rooms} oda)`,
    detail: { draftId: draft.id, allotmentId: id, rooms }, draft: { subject: draft.subject, body: draft.body },
    requiredRole: 'clerk_sales', entityType: 'message_draft', entityId: draft.id, primaryActionLabel: 'Bildirimi gönder',
  });
  return mapBlock(ctx, await blockRow(ctx, id));
}

// ------------------------------------------------------------------ K-13 supplier options
const mapOption = (r: Row): SupplierOption => ({
  id: r.id, projectId: r.project_id, serviceItemId: r.service_item_id, supplierId: r.supplier_id, supplierName: r.supplier_name ?? null,
  offerId: r.offer_id, rank: Number(r.rank) === 2 ? 2 : 1, optionUntil: d10(r.option_until), status: r.status, extensions: r.extensions ?? [],
  note: r.note, createdAt: iso(r.created_at),
});

async function optionRow(ctx: Ctx, id: string, forUpdate = false): Promise<Row> {
  const r = (await ctx.db.query(`SELECT o.*, s.name AS supplier_name FROM supplier_options o JOIN suppliers s ON s.id = o.supplier_id WHERE o.id = $1 ${forUpdate ? 'FOR UPDATE OF o' : ''}`, [id])).rows[0];
  if (!r) throw notFound('Opsiyon');
  return r;
}

export async function listOptions(ctx: Ctx, projectId: string): Promise<SupplierOption[]> {
  const { rows } = await ctx.db.query(
    `SELECT o.*, s.name AS supplier_name FROM supplier_options o JOIN suppliers s ON s.id = o.supplier_id WHERE o.project_id = $1 ORDER BY o.option_until, o.rank`, [projectId]);
  return rows.map(mapOption);
}

export async function createOption(ctx: Ctx, projectId: string, input: SupplierOptionInput): Promise<SupplierOption & { warning: string | null }> {
  assertBuyer(ctx);
  const item = (await ctx.db.query('SELECT id FROM service_items WHERE id = $1 AND project_id = $2', [input.serviceItemId, projectId])).rows[0];
  if (!item) throw badRequest('Kalem bu projeye ait değil', undefined, 'INVALID_ITEM');
  if (input.offerId) {
    const o = (await ctx.db.query('SELECT supplier_id FROM supplier_offers WHERE id = $1 AND service_item_id = $2', [input.offerId, input.serviceItemId])).rows[0];
    if (!o || o.supplier_id !== input.supplierId) throw badRequest('Teklif bu kaleme / tedarikçiye ait değil', undefined, 'INVALID_OFFER');
  }
  // rank: what the supplier told us (1st / 2nd option); default from what we already hold for this item × supplier
  const existing = (await ctx.db.query('SELECT rank, status FROM supplier_options WHERE service_item_id = $1 AND supplier_id = $2', [input.serviceItemId, input.supplierId])).rows
    .map((r) => ({ rank: Number(r.rank) as 1 | 2, status: r.status }));
  const rank = input.rank ?? nextOptionRank(existing);
  const r = (await ctx.db.query(
    `INSERT INTO supplier_options (tenant_id, project_id, service_item_id, supplier_id, offer_id, rank, option_until, note, created_by)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [projectId, input.serviceItemId, input.supplierId, input.offerId ?? null, rank, input.optionUntil, input.note?.trim() || null, ctx.user!.id])).rows[0];
  return { ...mapOption(await optionRow(ctx, r.id)), warning: optionRankWarning(rank) };
}

/** Extension request: a draft to the supplier (AI may draft) that a human approves — nothing leaves automatically. */
export async function requestOptionExtension(ctx: Ctx, id: string, input: { days?: number } = {}): Promise<{ draftId: string; decisionId: string }> {
  requireUser(ctx);
  const o = await optionRow(ctx, id, true);
  if (!['active', 'extension_requested'].includes(o.status)) throw conflict(`Opsiyon durumu uygun değil: ${o.status}`, 'OPTION_NOT_ACTIVE');
  const p = (await ctx.db.query('SELECT code, owner_id FROM projects WHERE id = $1', [o.project_id])).rows[0];
  const s = (await ctx.db.query('SELECT name, email, contact_name FROM suppliers WHERE id = $1', [o.supplier_id])).rows[0];
  const draft = await aiDraft(ctx, {
    kind: 'option_extension', language: 'tr', recipientName: s?.contact_name ?? s?.name,
    facts: { projectCode: await supplierRef(ctx, p.code, o.supplier_id), optionUntil: d10(o.option_until), requestedDays: input.days ?? 7 },
  }, { projectId: o.project_id, to: s?.email ?? null, status: 'pending_approval', requiresApproval: true, fromUserId: p.owner_id ?? ctx.user!.id, entityType: 'supplier_option', entityId: id });
  const d = await createDecision(ctx, {
    projectId: o.project_id, kind: 'outbound_message', badge: 'suggestion', urgent: true,
    summary: `${p.code}: ${s?.name ?? ''} opsiyonu ${d10(o.option_until)} — uzatma talebi`,
    detail: { draftId: draft.id, optionId: id, optionUntil: d10(o.option_until), to: s?.email ?? null }, draft: { subject: draft.subject, body: draft.body },
    requiredRole: 'clerk_sales', entityType: 'message_draft', entityId: draft.id, aiActionId: draft.ai_action_id, primaryActionLabel: 'Uzatma talebini gönder',
  });
  await ctx.db.query(`UPDATE supplier_options SET status = 'extension_requested', updated_at = now() WHERE id = $1`, [id]);
  return { draftId: draft.id, decisionId: d.id };
}

/** The supplier agreed: new option date. The dependent customer quote becomes stale (DB trigger) → revise before sending. */
export async function markOptionExtended(ctx: Ctx, id: string, input: { optionUntil: string }): Promise<SupplierOption> {
  assertHuman(ctx);
  const o = await optionRow(ctx, id, true);
  if (!['active', 'extension_requested'].includes(o.status)) throw conflict(`Opsiyon durumu uygun değil: ${o.status}`, 'OPTION_NOT_ACTIVE');
  const err = validateExtension(d10(o.option_until), input.optionUntil);
  if (err) throw badRequest(err, undefined, 'INVALID_EXTENSION');
  const ext = [...((o.extensions ?? []) as unknown[]), { from: d10(o.option_until), to: input.optionUntil, at: ctx.now().toISOString(), by: ctx.user!.id }];
  await ctx.db.query(`UPDATE supplier_options SET option_until = $2, status = 'active', extensions = $3, alerted_until = NULL, updated_at = now() WHERE id = $1`,
    [id, input.optionUntil, JSON.stringify(ext)]);
  await expireDecisionsFor(ctx, 'supplier_option', id, ['supplier_option_expiry']);
  return mapOption(await optionRow(ctx, id));
}

/** Released (dropped — tell the supplier yourself / via draft) or confirmed. Human only. */
export async function setOptionStatus(ctx: Ctx, id: string, status: 'released' | 'confirmed'): Promise<SupplierOption> {
  assertHuman(ctx);
  const o = await optionRow(ctx, id, true);
  if (!['active', 'extension_requested'].includes(o.status)) throw conflict(`Opsiyon durumu uygun değil: ${o.status}`, 'OPTION_NOT_ACTIVE');
  await ctx.db.query(`UPDATE supplier_options SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
  await expireDecisionsFor(ctx, 'supplier_option', id, ['supplier_option_expiry']);
  return mapOption(await optionRow(ctx, id));
}

// ------------------------------------------------------------------ worker: T-x release cards, T-3 option cards (idempotent)
export async function runProcurementJobs(ctx: Ctx, now: Date): Promise<string[]> {
  const rules = await ctx.rules();
  const day = localDate(now, rules.businessHours.timezone);
  const out: string[] = [];
  const blocks = (await ctx.db.query(
    `SELECT a.*, s.name AS supplier_name, p.code, p.owner_id FROM allotment_blocks a JOIN suppliers s ON s.id = a.supplier_id LEFT JOIN projects p ON p.id = a.project_id
      WHERE a.status = 'active' AND a.release_date IS NOT NULL AND a.release_alerted_at IS NULL AND a.release_date >= $1::date`, [day])).rows;
  for (const r of blocks) {
    const b = await mapBlock(ctx, r, day);
    if (!b.summary || !needsReleaseCard(b.summary)) continue;
    await ctx.db.query('UPDATE allotment_blocks SET release_alerted_at = $2 WHERE id = $1', [r.id, now]);
    const s = b.summary;
    await createDecision(ctx, {
      projectId: r.project_id, kind: 'allotment_release', badge: 'critical', urgent: s.daysToRelease != null && s.daysToRelease <= 2,
      summary: `${r.code ?? 'Blok'}: ${r.supplier_name} release ${b.releaseDate} (T-${s.daysToRelease}) — satılmayan ${s.releasableRooms} oda; tutarsanız tahmini ceza ${s.penaltyIfHold} ${b.currency}`,
      detail: { allotmentId: r.id, releasableRooms: s.releasableRooms, penaltyIfHold: s.penaltyIfHold, penaltyIfRelease: s.penaltyIfRelease, pickupPct: s.pickupPct, currency: b.currency, releaseDate: b.releaseDate },
      aiNote: 'Release kararını siz verirsiniz: "Release et" odaları düşer ve tedarikçi bildirimi onayınıza taslak olarak gelir. "Reddet" = tut.',
      requiredRole: 'clerk_sales', entityType: 'allotment_block', entityId: r.id, primaryActionLabel: `${s.releasableRooms} odayı release et`,
    });
    out.push('allotment_release_card');
  }
  const opts = (await ctx.db.query(
    `SELECT o.*, s.name AS supplier_name, p.code FROM supplier_options o JOIN suppliers s ON s.id = o.supplier_id JOIN projects p ON p.id = o.project_id
      WHERE o.status IN ('active','extension_requested') AND (o.alerted_until IS NULL OR o.alerted_until <> o.option_until) AND p.outcome IN ('open','won')`)).rows;
  for (const r of opts) {
    const due = optionCardDue({ optionUntil: d10(r.option_until), status: r.status }, day, rules.supplierOptionWarningDays);
    if (!due.due) continue;
    await ctx.db.query('UPDATE supplier_options SET alerted_until = option_until WHERE id = $1', [r.id]);
    await createDecision(ctx, {
      projectId: r.project_id, kind: 'supplier_option_expiry', badge: 'critical', urgent: due.daysLeft <= 1,
      summary: `${r.code}: ${r.supplier_name} ${Number(r.rank) === 2 ? '2.' : '1.'} opsiyon ${d10(r.option_until)} tarihinde bitiyor (T-${due.daysLeft}) — uzat / bırak / konfirme et`,
      detail: { optionId: r.id, optionUntil: d10(r.option_until), rank: Number(r.rank) },
      aiNote: 'Onay: tedarikçiye uzatma talebi taslağı hazırlanır (gönderim yine onayınızla). Bırakmak / konfirme etmek için projedeki Opsiyonlar kartını kullanın.',
      requiredRole: 'clerk_sales', entityType: 'supplier_option', entityId: r.id, primaryActionLabel: 'Uzatma talebi hazırla',
    });
    out.push('supplier_option_card');
  }
  return out;
}

/** Decision effects (registered in registry.ts). */
export async function allotmentReleaseEffect(ctx: Ctx, d: Row, input: { action: string; decidedBy: string | null; edits?: Record<string, unknown> }): Promise<string[]> {
  if (input.action === 'reject') return ['allotment_hold'];
  if (!input.decidedBy || ctx.actor.type !== 'user') throw forbidden('Release kararı yapay zekâ tarafından verilemez', 'AI_FORBIDDEN_ACTION');
  const rooms = Number(input.edits?.rooms ?? d.detail?.releasableRooms ?? 0);
  if (!(rooms > 0)) return ['nothing_to_release'];
  await releaseAllotment(ctx, d.entity_id, { rooms, reason: 'Release kartı (T-x)' });
  return ['allotment_released', 'release_notice_drafted'];
}

export async function optionExpiryEffect(ctx: Ctx, d: Row, input: { action: string; decidedBy: string | null }): Promise<string[]> {
  if (input.action === 'reject') return ['option_card_dismissed'];
  const r = await requestOptionExtension(ctx, d.entity_id);
  return ['option_extension_drafted', `decision:${r.decisionId}`];
}
