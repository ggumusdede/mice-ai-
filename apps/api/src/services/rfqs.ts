// §7 Adım 1 — RFQ: 3–5 suppliers (override with recorded reason), drafts sent from the responsible user's own
// address after approval, one-time supplier link (only SHA-256 stored), open until deadline, read-only until option end.
import type { CreateRfqsRequest, PublicOfferInput, PublicRfqView, Rfq } from '@mice/shared';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, conflict, gone, notFound } from '../errors.js';
import { mapOffer, mapRfq, type Row } from '../lib/mappers.js';
import { newPublicToken } from '../lib/crypto.js';
import { addHours } from '../lib/dates.js';
import { aiDraft, approveDraft, discardDraft, getDraftRow, sendDraft } from './drafts.js';
import { aiGate } from './automation.js';
import { getItemRow } from './items.js';
import { getProjectRow, setStep } from './projects.js';
import { createOfferVersion } from './offers.js';

export const LINK_PLACEHOLDER = '{{TEDARIKCI_LINKI}}';
/** link stays readable this long after the deadline when no option date is known */
const DEFAULT_READONLY_DAYS = 30;

export function supplierLink(ctx: Ctx, token: string): string {
  return `${ctx.deps.config.publicBaseUrl}/supplier/rfq/${token}`;
}

export async function getRfqRow(ctx: Ctx, id: string, forUpdate = false): Promise<Row> {
  const { rows } = await ctx.db.query(`SELECT * FROM rfqs WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) throw notFound('RFQ');
  return rows[0];
}

export async function createRfqs(ctx: Ctx, itemId: string, req: CreateRfqsRequest): Promise<Rfq[]> {
  const user = requireUser(ctx);
  const rules = await ctx.rules();
  const item = await getItemRow(ctx, itemId);
  const p = await getProjectRow(ctx, item.project_id);
  if (p.outcome !== 'open' && p.outcome !== 'won') throw conflict('Kapalı proje için RFQ açılamaz', 'PROJECT_CLOSED');
  if (item.value_add) throw badRequest('Katma değer kalemi için RFQ açılmaz (alış 0)', undefined, 'VALUE_ADD_ITEM');
  const ids = [...new Set(req.supplierIds)];
  if (!ids.length) throw badRequest('En az bir tedarikçi seçin', undefined, 'RFQ_COUNT');
  const outside = ids.length < rules.rfqMinSuppliers || ids.length > rules.rfqMaxSuppliers;
  const customHours = req.deadlineHours != null && req.deadlineHours !== rules.rfqCallTaskHours;
  if ((outside || customHours) && !req.overrideReason?.trim()) {
    throw badRequest(
      `Talep başına ${rules.rfqMinSuppliers}–${rules.rfqMaxSuppliers} tedarikçi ve ${rules.rfqCallTaskHours} saat varsayılandır; değiştirmek için gerekçe yazın (§17.6)`,
      { count: ids.length, min: rules.rfqMinSuppliers, max: rules.rfqMaxSuppliers }, 'RFQ_OVERRIDE_REASON_REQUIRED');
  }
  const suppliers = (await ctx.db.query('SELECT * FROM suppliers WHERE id = ANY($1)', [ids])).rows;
  if (suppliers.length !== ids.length) throw notFound('Tedarikçi');
  for (const s of suppliers) {
    if (s.status === 'passive') throw badRequest(`${s.name} pasif tedarikçi`, undefined, 'SUPPLIER_PASSIVE');
    if (!s.kinds.includes(item.kind)) throw badRequest(`${s.name} bu hizmet türünü sağlamıyor (${item.kind})`, undefined, 'SUPPLIER_KIND');
  }
  const existing = (await ctx.db.query(
    `SELECT supplier_id FROM rfqs WHERE service_item_id = $1 AND supplier_id = ANY($2) AND status NOT IN ('closed','cancelled')`, [itemId, ids])).rows;
  if (existing.length) throw conflict('Bu tedarikçilere bu kalem için açık RFQ zaten var', 'RFQ_EXISTS', { supplierIds: existing.map((e) => e.supplier_id) });

  const deadlineHours = req.deadlineHours ?? rules.rfqCallTaskHours;
  const ratio = deadlineHours / rules.rfqCallTaskHours;
  const reminderHours = Math.max(1, Math.round(rules.rfqReminderHours * ratio));
  const callHours = Math.max(reminderHours + 1, Math.round(rules.rfqCallTaskHours * ratio));
  const ownerId = p.owner_id ?? user.id;
  const owner = (await ctx.db.query('SELECT full_name FROM users WHERE id = $1', [ownerId])).rows[0];
  const language = req.language ?? 'tr';
  const created: Row[] = [];
  const draftIds: string[] = [];
  for (const s of suppliers) {
    const rfq = (await ctx.db.query(
      `INSERT INTO rfqs (tenant_id, project_id, service_item_id, supplier_id, status, language, deadline_hours, reminder_hours, call_hours,
         override_reason, created_by)
       VALUES (app_tenant_id(), $1,$2,$3,'pending_approval',$4,$5,$6,$7,$8,$9) RETURNING *`,
      [p.id, itemId, s.id, language, deadlineHours, reminderHours, callHours, req.overrideReason ?? null, user.id],
    )).rows[0];
    const draft = await aiDraft(ctx, {
      kind: 'rfq', language, senderName: owner?.full_name, recipientName: s.contact_name ?? s.name,
      facts: {
        projectCode: p.code, item: { kind: item.kind, description: item.description, dateFrom: item.date_from, dateTo: item.date_to, quantity: Number(item.quantity), unit: item.unit, nights: item.nights, specs: item.specs },
        pax: p.pax, deadlineHours, optionRequested: true, link: LINK_PLACEHOLDER,
      },
    }, { projectId: p.id, to: s.email, status: 'pending_approval', requiresApproval: true, fromUserId: ownerId, entityType: 'rfq', entityId: rfq.id });
    if (!draft.body.includes(LINK_PLACEHOLDER)) {
      await ctx.db.query('UPDATE message_drafts SET body = body || $2 WHERE id = $1', [draft.id, `\n\nTeklif formu: ${LINK_PLACEHOLDER}`]);
    }
    await ctx.db.query('UPDATE rfqs SET draft_id = $2 WHERE id = $1', [rfq.id, draft.id]);
    draftIds.push(draft.id);
    created.push(rfq);
  }
  await ctx.db.query(`UPDATE service_items SET status = 'rfq' WHERE id = $1 AND status = 'open'`, [itemId]);
  await setStep(ctx, p.id, 1);

  const gate = await aiGate(ctx, 'rfq_send', {
    projectId: p.id, kind: 'rfq_send', badge: req.overrideReason ? 'critical' : 'within_rules',
    summary: `${p.code}: ${item.description} için ${suppliers.length} tedarikçiye RFQ`,
    detail: {
      rfqIds: created.map((r) => r.id), draftIds, itemId, suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, status: s.status })),
      deadlineHours, overrideReason: req.overrideReason ?? null,
    },
    aiNote: req.overrideReason ? `Varsayılandan farklı: ${req.overrideReason}` : null,
    requiredRole: 'clerk_sales', entityType: 'service_item', entityId: itemId,
  });
  await ctx.db.query('UPDATE rfqs SET decision_id = $2 WHERE id = ANY($1)', [created.map((r) => r.id), gate.decision.id]);
  const fresh = (await ctx.db.query('SELECT * FROM rfqs WHERE id = ANY($1) ORDER BY created_at', [created.map((r) => r.id)])).rows;
  return fresh.map(mapRfq);
}

/** Effect of an approved 'rfq_send' decision: issue links, mark sent, send each draft from the responsible user's address. */
export async function sendApprovedRfqs(ctx: Ctx, rfqIds: string[], edits?: Record<string, unknown>): Promise<string[]> {
  const out: string[] = [];
  const now = ctx.now();
  const perDraft = (edits?.drafts ?? {}) as Record<string, { body?: string; subject?: string }>;
  for (const id of rfqIds) {
    const rfq = await getRfqRow(ctx, id, true);
    if (!['draft', 'pending_approval'].includes(rfq.status)) continue;
    const { token, hash } = newPublicToken();
    const deadline = addHours(now, rfq.deadline_hours);
    await ctx.db.query(
      `UPDATE rfqs SET status = 'sent', token_hash = $2, sent_at = $3, sent_by = $4, deadline_at = $5, link_expires_at = $6 WHERE id = $1`,
      [id, hash, now, null, deadline, addHours(deadline, 24 * DEFAULT_READONLY_DAYS)],
    );
    if (rfq.draft_id) {
      const draft = await getDraftRow(ctx, rfq.draft_id);
      const e = perDraft[rfq.draft_id] ?? (typeof edits?.body === 'string' ? { body: edits.body as string } : undefined);
      await approveDraft(ctx, rfq.draft_id, ctx.user?.id ?? null, e);
      const link = supplierLink(ctx, token);
      if (draft.to_address) {
        await sendDraft(ctx, rfq.draft_id, {
          approvedByDecision: true, fromUserId: draft.from_user_id,
          render: (body) => ({ body: body.split(LINK_PLACEHOLDER).join(link), secrets: [token] }),
        });
        await ctx.db.query('UPDATE rfqs SET sent_by = $2 WHERE id = $1', [id, draft.from_user_id]);
      }
    }
    out.push(`rfq_sent:${id}`);
  }
  return out;
}

export async function rejectRfqs(ctx: Ctx, rfqIds: string[], reason: string | undefined): Promise<string[]> {
  for (const id of rfqIds) {
    const rfq = await getRfqRow(ctx, id, true);
    if (!['draft', 'pending_approval'].includes(rfq.status)) continue;
    await ctx.db.query(`UPDATE rfqs SET status = 'cancelled', closed_reason = $2 WHERE id = $1`, [id, reason ?? 'rejected']);
    if (rfq.draft_id) await discardDraft(ctx, rfq.draft_id);
  }
  return ['rfqs_cancelled'];
}

/** Issues a fresh one-time link (e.g. to share via WhatsApp). The previous link stops working. */
export async function rotateRfqLink(ctx: Ctx, id: string): Promise<Rfq> {
  const rfq = await getRfqRow(ctx, id, true);
  if (!['sent', 'responded'].includes(rfq.status)) throw conflict('Link yalnızca gönderilmiş RFQ için üretilebilir', 'RFQ_NOT_SENT');
  const { token, hash } = newPublicToken();
  const row = (await ctx.db.query('UPDATE rfqs SET token_hash = $2 WHERE id = $1 RETURNING *', [id, hash])).rows[0];
  return { ...mapRfq(row), supplierLink: supplierLink(ctx, token) };
}

export async function cancelRfq(ctx: Ctx, id: string, reason: string): Promise<Rfq> {
  if (!reason?.trim()) throw badRequest('İptal gerekçesi zorunludur', undefined, 'REASON_REQUIRED');
  const rfq = await getRfqRow(ctx, id, true);
  if (['closed', 'cancelled'].includes(rfq.status)) throw conflict('RFQ zaten kapalı', 'RFQ_CLOSED');
  const row = (await ctx.db.query(
    `UPDATE rfqs SET status = 'cancelled', closed_reason = $2, link_expires_at = $3 WHERE id = $1 RETURNING *`, [id, reason, ctx.now()])).rows[0];
  if (rfq.draft_id) await discardDraft(ctx, rfq.draft_id);
  return mapRfq(row);
}

// ------------------------------------------------------------------ supplier portal (public, token-scoped)
function linkState(ctx: Ctx, rfq: Row): { readOnly: boolean } {
  const now = ctx.now();
  if (['cancelled', 'closed'].includes(rfq.status)) throw gone('Bu teklif bağlantısı kapatıldı', 'RFQ_LINK_CLOSED');
  if (!['sent', 'responded'].includes(rfq.status)) throw gone('Bu teklif bağlantısı geçerli değil', 'RFQ_LINK_CLOSED');
  if (rfq.link_expires_at && new Date(rfq.link_expires_at) < now) throw gone('Bu teklif bağlantısının süresi doldu', 'RFQ_LINK_EXPIRED');
  return { readOnly: !!rfq.deadline_at && new Date(rfq.deadline_at) < now };
}

export async function publicRfqView(ctx: Ctx, rfqId: string): Promise<PublicRfqView> {
  const rfq = await getRfqRow(ctx, rfqId);
  const { readOnly } = linkState(ctx, rfq);
  const item = await getItemRow(ctx, rfq.service_item_id);
  const p = await getProjectRow(ctx, rfq.project_id);
  const tenant = (await ctx.db.query('SELECT name FROM tenants WHERE id = app_tenant_id()')).rows[0];
  const supplier = (await ctx.db.query('SELECT name FROM suppliers WHERE id = $1', [rfq.supplier_id])).rows[0];
  // scoped: only this supplier's own versions for this one item
  const offers = (await ctx.db.query(
    'SELECT * FROM supplier_offers WHERE service_item_id = $1 AND supplier_id = $2 ORDER BY version', [rfq.service_item_id, rfq.supplier_id])).rows.map(mapOffer);
  return {
    agencyName: tenant?.name ?? '', projectCode: p.code, supplierName: supplier?.name ?? '',
    item: {
      kind: item.kind, description: item.description, dateFrom: item.date_from, dateTo: item.date_to, quantity: Number(item.quantity),
      unit: item.unit, nights: item.nights, specs: item.specs ?? {},
    },
    deadlineAt: rfq.deadline_at ? new Date(rfq.deadline_at).toISOString() : null,
    readOnly,
    previousVersions: offers.map((o) => ({ version: o.version, createdAt: o.createdAt, lines: o.lines })),
  };
}

export async function publicSubmitOffer(ctx: Ctx, rfqId: string, input: PublicOfferInput): Promise<{ ok: true; version: number }> {
  const rfq = await getRfqRow(ctx, rfqId, true);
  const { readOnly } = linkState(ctx, rfq);
  if (readOnly) throw conflict('Yanıt süresi doldu; bağlantı artık salt okunur', 'RFQ_READ_ONLY');
  const item = await getItemRow(ctx, rfq.service_item_id);
  const offer = await createOfferVersion(ctx, item, {
    supplierId: rfq.supplier_id, rfqId: rfq.id, source: 'form', currency: input.currency as never, lines: input.lines,
    optionUntil: input.optionUntil ?? null, guaranteePax: input.guaranteePax ?? null, paymentTerms: input.paymentTerms ?? null,
    prepaymentRate: input.prepaymentRate ?? null, cancellationTerms: input.cancellationTerms ?? null,
    attritionTerms: input.attritionTerms ?? null, notes: input.notes ?? null, confidence: null,
  });
  await markRfqResponded(ctx, rfq, offer.option_until);
  return { ok: true, version: offer.version };
}

/** After any supplier response: status, read-only window until option end, supplier response time. */
export async function markRfqResponded(ctx: Ctx, rfq: Row, optionUntil: string | null): Promise<void> {
  const optionEnd = optionUntil ? new Date(`${optionUntil}T23:59:59Z`) : null;
  await ctx.db.query(
    `UPDATE rfqs SET status = 'responded', link_expires_at = GREATEST(link_expires_at, $2) WHERE id = $1`, [rfq.id, optionEnd]);
  if (rfq.status === 'sent' && rfq.sent_at) {
    const hours = (ctx.now().getTime() - new Date(rfq.sent_at).getTime()) / 3_600_000;
    await ctx.db.query(
      `UPDATE suppliers SET avg_response_hours = CASE WHEN avg_response_hours IS NULL THEN $2 ELSE round((avg_response_hours * 3 + $2) / 4, 2) END WHERE id = $1`,
      [rfq.supplier_id, Math.round(hours * 100) / 100],
    );
  }
}
