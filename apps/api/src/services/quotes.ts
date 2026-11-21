// §7 Adım 3 (onay kapısı) & Adım 4 — customer quote: 2–3 options of item combinations, markup from evaluation,
// value-add lines, VAT & accommodation tax separated, customer rules applied & listed, option date ≤ supplier option,
// below-target margin blocked unless admin override with reason, personal-authority approval gate, PDF + internal P&L.
import type {
  BuildQuoteRequest, Customer, ProfitSummary, PublicQuoteView, Quote, QuoteLine, QuoteOption, SupplierStatus,
} from '@mice/shared';
import {
  addBusinessDays, markupForAdvantage, profitSummary, quoteNeedsApproval, revisionTargetStep, round2, roleCan, validateQuote,
  type QuoteValidationIssue,
} from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, conflict, forbidden, gone, notFound } from '../errors.js';
import { mapCustomer, mapQuoteBase, mapQuoteLine, mapServiceItem, type Row } from '../lib/mappers.js';
import { isoDate, minIsoDate } from '../lib/dates.js';
import { newPublicToken } from '../lib/crypto.js';
import { currentFx, rateFor } from './fx.js';
import { evaluateItemOffers } from './offers.js';
import { getProjectRow, setStep } from './projects.js';
import { aiGate } from './automation.js';
import { createDecision, expireDecisionsFor } from './decisions.js';
import { generateDocument, latestDocumentFor, registerDocumentGenerator } from './documents.js';
import { aiDraft, sendDraft } from './drafts.js';
import { logAiAction } from './ai-log.js';
import { money, pct, renderPdf, type PdfSpec } from './pdf.js';
import type { RealizedPnl } from './documents-b.js';

export interface BuildQuoteInput extends BuildQuoteRequest {
  /** (additive) explicit customer option date; blocked if later than any supplier option (§7 Adım 3) */
  optionUntil?: string;
}

interface OptionMeta { optionNo: number; title: string }
interface QuoteMeta { options: OptionMeta[]; accommodationTaxRate: number }

const mult = (l: { quantity: number; nights: number | null }) => l.quantity * (l.nights && l.nights > 0 ? l.nights : 1);

/** Option totals: margin (Kâr÷Satış) and markup (Kâr÷Alış) separate; VAT and accommodation tax separate. */
export function assembleOption(optionNo: number, title: string, lines: QuoteLine[], accommodationTaxRate: number, fxRate: number): QuoteOption {
  let cost = 0, sale = 0, vat = 0, accTax = 0;
  for (const l of lines) {
    const m = mult(l);
    cost += l.unitCostEur * m;
    const s = l.unitPriceEur * m;
    sale += s;
    vat += s * l.vatRate;
    if (l.kind === 'accommodation') accTax += s * accommodationTaxRate;
  }
  const totals: ProfitSummary = profitSummary(cost, sale);
  return {
    optionNo, title, lines, totals, vatEur: round2(vat), accommodationTaxEur: round2(accTax),
    grandTotalCustomerCurrency: round2((sale + vat + accTax) * fxRate),
  };
}

function metaOf(r: Row): QuoteMeta {
  const m = r.options_meta;
  if (Array.isArray(m)) return { options: m, accommodationTaxRate: 0.02 };
  return m as QuoteMeta;
}

export async function loadQuotes(ctx: Ctx, f: { projectId?: string; id?: string }): Promise<Quote[]> {
  const { rows } = await ctx.db.query(
    `SELECT * FROM quotes WHERE ($1::uuid IS NULL OR project_id = $1) AND ($2::uuid IS NULL OR id = $2) ORDER BY version DESC`,
    [f.projectId ?? null, f.id ?? null]);
  if (!rows.length) return [];
  const lines = (await ctx.db.query('SELECT * FROM quote_lines WHERE quote_id = ANY($1) ORDER BY option_no, sort', [rows.map((r) => r.id)])).rows;
  return rows.map((r) => {
    const meta = metaOf(r);
    const ql = lines.filter((l) => l.quote_id === r.id).map(mapQuoteLine);
    const options = meta.options.map((o) => assembleOption(o.optionNo, o.title, ql.filter((l) => l.optionNo === o.optionNo), meta.accommodationTaxRate, Number(r.fx_rate)));
    return { ...mapQuoteBase(r), options };
  });
}

export async function getQuote(ctx: Ctx, id: string): Promise<Quote> {
  const q = (await loadQuotes(ctx, { id }))[0];
  if (!q) throw notFound('Teklif');
  return q;
}

async function getQuoteRow(ctx: Ctx, id: string, forUpdate = false): Promise<Row> {
  const { rows } = await ctx.db.query(`SELECT * FROM quotes WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) throw notFound('Teklif');
  return rows[0];
}

async function customerOf(ctx: Ctx, p: Row): Promise<Customer | null> {
  if (!p.customer_id) return null;
  const r = (await ctx.db.query('SELECT * FROM customers WHERE id = $1', [p.customer_id])).rows[0];
  return r ? mapCustomer(r) : null;
}

const STATUS_RANK: Record<SupplierStatus, number> = { accredited: 0, passive: 1, candidate: 2 };

// ------------------------------------------------------------------ build
export async function buildQuote(ctx: Ctx, projectId: string, req: BuildQuoteInput): Promise<Quote> {
  const user = requireUser(ctx);
  const rules = await ctx.rules();
  const p = await getProjectRow(ctx, projectId, true);
  if (['lost', 'cancelled', 'closed'].includes(p.outcome)) throw conflict('Kapalı proje için teklif hazırlanamaz', 'PROJECT_CLOSED');
  const customer = await customerOf(ctx, p);
  const fx = await currentFx(ctx.db);
  const currency = (req.currency ?? customer?.rules.preferredCurrency ?? 'EUR').toUpperCase();
  const fxRate = rateFor(fx, currency);
  if (!req.options?.length) throw badRequest('En az bir seçenek gerekli', undefined, 'OPTIONS_REQUIRED');

  const itemIds = [...new Set(req.options.flatMap((o) => o.lines.map((l) => l.serviceItemId)))];
  const itemRows = (await ctx.db.query('SELECT * FROM service_items WHERE id = ANY($1) AND project_id = $2', [itemIds, projectId])).rows;
  if (itemRows.length !== itemIds.length) throw badRequest('Seçeneklerdeki kalemler bu projeye ait değil', undefined, 'INVALID_ITEM');
  const evalCache = new Map<string, Awaited<ReturnType<typeof evaluateItemOffers>>>();
  const supplierStatusByItem: Record<string, SupplierStatus | null> = {};
  const lowestMarkup = markupForAdvantage(Number.NEGATIVE_INFINITY, rules.markupTiers);
  const options: QuoteOption[] = [];
  const lineRows: (QuoteLine & { supplierId: string | null; suggestedMarkup: number | null; advantage: number | null })[] = [];

  for (const [i, opt] of req.options.entries()) {
    const optionNo = i + 1;
    const lines: QuoteLine[] = [];
    for (const l of opt.lines) {
      const item = itemRows.find((x) => x.id === l.serviceItemId)!;
      if (!evalCache.has(item.id)) evalCache.set(item.id, await evaluateItemOffers(ctx, item, p));
      const ev = evalCache.get(item.id)!;
      const offerId = item.value_add ? null : l.offerId !== undefined ? l.offerId : item.selected_offer_id;
      let unitCost = 0;
      let markup: number | null = l.markup ?? null;
      let supplierId: string | null = null;
      let optionUntil: string | null = null;
      let suggestedMarkup: number | null = null; // §16.5 learning data: tier suggestion vs applied markup
      let advantage: number | null = null;
      if (offerId) {
        const offer = ev.offers.find((o) => o.id === offerId);
        if (!offer) {
          const exists = (await ctx.db.query('SELECT superseded_by FROM supplier_offers WHERE id = $1 AND service_item_id = $2', [offerId, item.id])).rows[0];
          if (exists?.superseded_by) throw conflict(`${item.description}: teklif sürümü eskidi; güncel sürümü seçin`, 'OFFER_SUPERSEDED');
          throw badRequest(`${item.description}: teklif bu kaleme ait değil`, undefined, 'INVALID_OFFER');
        }
        const e = ev.evaluations.find((x) => x.offerId === offerId);
        if (!e) throw badRequest(`${item.description}: teklif normalize edilemedi (kur?)`, undefined, 'OFFER_NOT_NORMALIZABLE');
        unitCost = e.normalized.totalNetExVatEur / Math.max(mult({ quantity: Number(item.quantity), nights: item.nights }), 1e-9);
        suggestedMarkup = e.suggestedMarkup;
        advantage = e.advantage;
        markup ??= e.suggestedMarkup ?? lowestMarkup;
        supplierId = offer.supplierId;
        optionUntil = offer.optionUntil;
        const st = ev.suppliers.find((s) => s.id === offer.supplierId)?.status ?? 'candidate';
        const prev = supplierStatusByItem[item.id];
        if (!prev || STATUS_RANK[st] > STATUS_RANK[prev]) supplierStatusByItem[item.id] = st;
      } else if (!item.value_add) {
        throw badRequest(`${item.description}: seçili teklif yok`, undefined, 'OFFER_REQUIRED');
      } else {
        supplierStatusByItem[item.id] ??= null;
      }
      let unitPrice: number;
      if (l.unitPriceEur != null) {
        unitPrice = l.unitPriceEur;
        if (unitCost > 0 && l.markup == null) markup = unitPrice / unitCost - 1;
      } else {
        unitPrice = round2(unitCost * (1 + (markup ?? 0)));
      }
      const line: QuoteLine = {
        optionNo, serviceItemId: item.id, offerId, description: item.description, kind: item.kind, quantity: Number(item.quantity),
        unit: item.unit, nights: item.kind === 'accommodation' ? item.nights : null, unitCostEur: Math.round(unitCost * 10000) / 10000,
        unitPriceEur: unitPrice, markup: Math.round((markup ?? 0) * 10000) / 10000,
        vatRate: item.kind === 'accommodation' ? rules.vatRates.accommodation : rules.vatRates.service,
        valueAdd: item.value_add, supplierOptionUntil: optionUntil,
      };
      lines.push(line);
      lineRows.push({ ...line, supplierId, suggestedMarkup, advantage });
    }
    options.push(assembleOption(optionNo, opt.title, lines, rules.accommodationTaxRate, fxRate));
  }

  // option date: min(today + standard business days, earliest supplier option); explicit date may not exceed suppliers
  const standard = isoDate(addBusinessDays(ctx.now(), rules.customerOptionBusinessDays, rules.businessHours));
  const earliestSupplier = minIsoDate(...lineRows.map((l) => l.supplierOptionUntil));
  const optionUntil = req.optionUntil ?? minIsoDate(standard, earliestSupplier);

  const isAdminOverride = user.role === 'admin' && !!req.marginOverrideReason?.trim();
  const validation = validateQuote({
    options, items: itemRows.map(mapServiceItem), supplierStatusByItem, customerOptionUntil: optionUntil,
    customerRules: customer?.rules ?? null, rules, eventStartDate: p.start_date, eventEndDate: p.end_date,
    marginOverrideReason: req.marginOverrideReason ?? null, overrideByAdmin: isAdminOverride,
  });
  const blocking = validation.issues.filter((x) => x.blocking);
  const warnings = validation.issues.filter((x) => !x.blocking);
  const needsApproval = !validation.blocked && quoteNeedsApproval(user, customer, p.event_type);
  const status = validation.blocked ? 'blocked' : needsApproval ? 'pending_approval' : 'approved';

  // supersede previous versions
  const prev = (await ctx.db.query(`SELECT id FROM quotes WHERE project_id = $1 AND status <> 'superseded'`, [projectId])).rows;
  const version = (await ctx.db.query('SELECT COALESCE(max(version), 0) + 1 AS v FROM quotes WHERE project_id = $1', [projectId])).rows[0].v;
  const meta: QuoteMeta = { options: options.map((o) => ({ optionNo: o.optionNo, title: o.title })), accommodationTaxRate: rules.accommodationTaxRate };
  const q = (await ctx.db.query(
    `INSERT INTO quotes (tenant_id, project_id, version, status, currency, fx_rate, fx_source, fx_date, option_until, options_meta,
       applied_customer_rules, block_reasons, validation, requires_approval, created_by, approved_by, approved_at, margin_override_reason, margin_override_by)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [projectId, version, status, currency, fxRate, fx.source, fx.date, optionUntil, JSON.stringify(meta),
      JSON.stringify(validation.appliedCustomerRules), JSON.stringify(blocking.map((b) => b.message)), JSON.stringify(validation),
      needsApproval, user.id, status === 'approved' ? user.id : null, status === 'approved' ? ctx.now() : null,
      isAdminOverride ? req.marginOverrideReason : null, isAdminOverride ? user.id : null],
  )).rows[0];
  let sort = 0;
  for (const l of lineRows) {
    await ctx.db.query(
      `INSERT INTO quote_lines (tenant_id, quote_id, option_no, service_item_id, offer_id, supplier_id, description, kind, quantity, unit, nights,
         unit_cost_eur, unit_price_eur, markup, vat_rate, value_add, supplier_option_until, sort, suggested_markup, advantage)
       VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [q.id, l.optionNo, l.serviceItemId, l.offerId, l.supplierId, l.description, l.kind, l.quantity, l.unit, l.nights, l.unitCostEur,
        l.unitPriceEur, l.markup, l.vatRate, l.valueAdd, l.supplierOptionUntil, sort++,
        l.suggestedMarkup == null ? null : Math.round(l.suggestedMarkup * 10000) / 10000,
        l.advantage == null || !Number.isFinite(l.advantage) ? null : Math.max(-9999, Math.min(9999, Math.round(l.advantage * 10000) / 10000))],
    );
  }
  for (const pr of prev) {
    await ctx.db.query(`UPDATE quotes SET status = 'superseded', superseded_by = $2 WHERE id = $1`, [pr.id, q.id]);
    await expireDecisionsFor(ctx, 'quote', pr.id);
  }
  await logAiAction(ctx, {
    actionType: 'margin_suggestion', projectId, entityType: 'quote', entityId: q.id,
    result: { confidence: 1, model: 'domain', data: { markups: lineRows.map((l) => ({ itemId: l.serviceItemId, markup: l.markup })) } },
  });

  // decisions
  if (validation.blocked) {
    const onlyMargin = blocking.every((b) => b.code === 'below_target_margin');
    if (onlyMargin) {
      await createDecision(ctx, {
        projectId, kind: 'margin_override', badge: 'critical', urgent: false,
        summary: `${p.code} v${version}: hedef marj altı (${pct(rules.targetMarginMin)} altı) — gerekçeyle açılabilir`,
        detail: { quoteId: q.id, issues: blocking, options: options.map((o) => ({ optionNo: o.optionNo, title: o.title, totals: o.totals })) },
        aiNote: 'Yalnızca yönetici gerekçe yazarak açar (§7 Adım 3).', requiredRole: 'admin', entityType: 'quote', entityId: q.id,
      });
    }
  } else if (needsApproval) {
    await aiGate(ctx, 'customer_quote', {
      projectId, kind: 'quote_approval', badge: warnings.length ? 'critical' : 'within_rules',
      summary: `${p.code} v${version}: ${options.map((o) => `${o.title} ${money(o.totals.saleEur, 'EUR')} (marj ${pct(o.totals.margin)})`).join(' · ')}`,
      // §15: rule-compliant quote → one tap; otherwise ONLY the out-of-rule items are shown
      detail: {
        quoteId: q.id, outOfRule: warnings, appliedCustomerRules: validation.appliedCustomerRules, optionUntil, createdBy: user.fullName,
        options: warnings.length ? undefined : options.map((o) => ({ optionNo: o.optionNo, title: o.title, totals: o.totals })),
      },
      aiNote: warnings.length ? warnings.map((w) => w.message).join(' · ') : 'Tüm kurallara uygun.',
      requiredRole: 'admin', entityType: 'quote', entityId: q.id,
    });
  }

  await generateDocument(ctx, 'quote', projectId, q.id);
  await generateDocument(ctx, 'pnl', projectId, q.id);
  await setStep(ctx, projectId, 3);
  return getQuote(ctx, q.id);
}

// ------------------------------------------------------------------ decision effects
export async function approveQuote(ctx: Ctx, quoteId: string, decidedBy: string | null, decisionId: string): Promise<string[]> {
  const q = await getQuoteRow(ctx, quoteId, true);
  if (q.status !== 'pending_approval') return [`quote_not_pending:${q.status}`];
  await ctx.db.query(
    `UPDATE quotes SET status = 'approved', approved_by = $2, approved_at = $3, approval_decision_id = $4 WHERE id = $1`,
    [quoteId, decidedBy, ctx.now(), decisionId]);
  return ['quote_approved'];
}

export async function returnQuoteForEdit(ctx: Ctx, quoteId: string, note: string): Promise<string[]> {
  await ctx.db.query(
    `UPDATE quotes SET status = 'draft', block_reasons = block_reasons || $2::jsonb WHERE id = $1 AND status = 'pending_approval'`,
    [quoteId, JSON.stringify([`Yönetici düzeltme istedi: ${note}`])]);
  return ['quote_returned_for_edit'];
}

export async function rejectQuote(ctx: Ctx, quoteId: string): Promise<string[]> {
  await ctx.db.query(`UPDATE quotes SET status = 'rejected' WHERE id = $1 AND status IN ('pending_approval','blocked','draft')`, [quoteId]);
  return ['quote_rejected'];
}

/** Admin margin override (with reason): re-validate; if margin was the only block → approved. */
export async function applyMarginOverride(ctx: Ctx, quoteId: string, adminId: string, reason: string): Promise<string[]> {
  const q = await getQuoteRow(ctx, quoteId, true);
  if (q.status !== 'blocked') return [`quote_not_blocked:${q.status}`];
  const issues = ((q.validation?.issues ?? []) as QuoteValidationIssue[]).filter((i) => i.blocking && i.code !== 'below_target_margin');
  if (issues.length) {
    await ctx.db.query(`UPDATE quotes SET margin_override_reason = $2, margin_override_by = $3, block_reasons = $4 WHERE id = $1`,
      [quoteId, reason, adminId, JSON.stringify(issues.map((i) => i.message))]);
    return ['margin_override_recorded', 'quote_still_blocked'];
  }
  await ctx.db.query(
    `UPDATE quotes SET status = 'approved', margin_override_reason = $2, margin_override_by = $3, approved_by = $3, approved_at = $4, block_reasons = '[]' WHERE id = $1`,
    [quoteId, reason, adminId, ctx.now()]);
  return ['margin_override_applied', 'quote_approved'];
}

// ------------------------------------------------------------------ send (Adım 3 → 4)
export function quoteLink(ctx: Ctx, token: string): string {
  return `${ctx.deps.config.publicBaseUrl}/q/${token}`;
}

export async function sendQuote(ctx: Ctx, id: string): Promise<Quote> {
  const user = requireUser(ctx);
  if (!roleCan(user.role, 'send_quote')) throw forbidden('Teklif gönderme yetkiniz yok');
  const q = await getQuoteRow(ctx, id, true);
  if (q.status !== 'approved') throw conflict(`Teklif onaylı değil (durum: ${q.status})`, 'QUOTE_NOT_APPROVED');
  const doc = await latestDocumentFor(ctx, 'quote', 'quote', id);
  if (!doc || doc.status !== 'current' || doc.superseded_by) {
    throw conflict(`Teklif belgesi eski: ${doc?.stale_reason ?? 'belge yok'} — yeniden üretilmeden gönderilemez`, 'DOCUMENT_STALE');
  }
  const p = await getProjectRow(ctx, q.project_id, true);
  const customer = await customerOf(ctx, p);
  const { token, hash } = newPublicToken();
  const now = ctx.now();
  await ctx.db.query(`UPDATE documents SET sent_at = $2 WHERE id = $1`, [doc.id, now]);
  await ctx.db.query(`UPDATE quotes SET status = 'sent', sent_at = $2, sent_by = $3, public_token_hash = $4 WHERE id = $1`, [id, now, user.id, hash]);
  // §17.10: quote_sent_at stops the 2-business-day clock (first send)
  await ctx.db.query(`UPDATE projects SET quote_sent_at = COALESCE(quote_sent_at, $2), step = GREATEST(step, 4) WHERE id = $1`, [p.id, now]);
  const link = quoteLink(ctx, token);
  const to = customer?.contacts.find((c) => c.email)?.email
    ?? (await ctx.db.query(`SELECT from_address FROM inbound_messages WHERE project_id = $1 AND from_address LIKE '%@%' ORDER BY received_at LIMIT 1`, [p.id])).rows[0]?.from_address
    ?? null;
  if (to) {
    const lang = customer?.rules.preferredLanguage ?? 'tr';
    const draft = await aiDraft(ctx, {
      kind: 'quote_cover', language: lang, recipientName: customer?.contacts[0]?.name ?? customer?.name ?? null,
      facts: { projectCode: p.code, optionUntil: q.option_until, link: '{{TEKLIF_LINKI}}', options: (await getQuote(ctx, id)).options.map((o) => o.title) },
    }, { projectId: p.id, to, status: 'approved', fromUserId: user.id, entityType: 'quote', entityId: id });
    if (!draft.body.includes('{{TEKLIF_LINKI}}')) await ctx.db.query('UPDATE message_drafts SET body = body || $2 WHERE id = $1', [draft.id, '\n\nOnay linki: {{TEKLIF_LINKI}}']);
    await sendDraft(ctx, draft.id, { render: (b) => ({ body: b.split('{{TEKLIF_LINKI}}').join(link), secrets: [token] }) });
  }
  return { ...(await getQuote(ctx, id)), approvalLink: link };
}

// ------------------------------------------------------------------ public approval (Adım 4)
async function publicQuoteRow(ctx: Ctx, id: string): Promise<Row> {
  const q = await getQuoteRow(ctx, id, true);
  if (q.status === 'superseded') throw gone('Bu teklifin yeni bir sürümü gönderildi', 'QUOTE_SUPERSEDED');
  if (!['sent', 'accepted', 'revision_requested'].includes(q.status)) throw gone('Bu teklif bağlantısı geçerli değil', 'QUOTE_LINK_CLOSED');
  return q;
}

export async function publicQuoteView(ctx: Ctx, id: string): Promise<PublicQuoteView> {
  const q = await publicQuoteRow(ctx, id);
  await ctx.db.query('UPDATE quotes SET opened_at = COALESCE(opened_at, $2), open_count = open_count + 1 WHERE id = $1', [id, ctx.now()]);
  const quote = await getQuote(ctx, id);
  const p = await getProjectRow(ctx, q.project_id);
  const customer = await customerOf(ctx, p);
  const tenant = (await ctx.db.query('SELECT name FROM tenants WHERE id = app_tenant_id()')).rows[0];
  const fx = quote.fxRate;
  return {
    agencyName: tenant?.name ?? '', projectCode: p.code, customerName: p.customer_name, currency: quote.currency, optionUntil: quote.optionUntil,
    options: quote.options.map((o) => ({
      optionNo: o.optionNo, title: o.title,
      lines: o.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: round2(l.unitPriceEur * fx), total: round2(l.unitPriceEur * mult(l) * fx) })),
      total: round2(o.totals.saleEur * fx), vat: round2(o.vatEur * fx), accommodationTax: round2(o.accommodationTaxEur * fx), grandTotal: o.grandTotalCustomerCurrency,
    })),
    status: quote.status, firmApproval: customer?.rules.firmApproval ?? 'signed_or_po',
  };
}

export async function publicAccept(ctx: Ctx, id: string, input: { optionNo: number; approverName: string; poNumber?: string }): Promise<{ ok: true; firm: boolean }> {
  const q = await publicQuoteRow(ctx, id);
  if (q.status !== 'sent') throw conflict('Bu teklif zaten yanıtlandı', 'QUOTE_ALREADY_ANSWERED');
  if (q.option_until && q.option_until < isoDate(ctx.now())) throw conflict('Teklifin opsiyon süresi doldu', 'QUOTE_OPTION_EXPIRED');
  const quote = await getQuote(ctx, id);
  const option = quote.options.find((o) => o.optionNo === input.optionNo);
  if (!option) throw badRequest('Geçersiz seçenek', undefined, 'INVALID_OPTION');
  if (!input.approverName?.trim()) throw badRequest('Onaylayan adı zorunludur', undefined, 'APPROVER_REQUIRED');
  const p = await getProjectRow(ctx, q.project_id, true);
  const customer = await customerOf(ctx, p);
  const firmRule = customer?.rules.firmApproval ?? 'signed_or_po'; // §17.2 default for new customers
  const firm = firmRule === 'online' || !!input.poNumber?.trim();
  const now = ctx.now();
  await ctx.db.query(
    `UPDATE quotes SET status = 'accepted', accepted_option_no = $2, accepted_at = $3, accepted_by_name = $4, po_number = $5,
       awaiting_signed_form = $6, firm_approved_at = $7 WHERE id = $1`,
    [id, input.optionNo, now, input.approverName.trim(), input.poNumber?.trim() || null, !firm, firm ? now : null]);
  for (const l of option.lines) {
    if (l.offerId) {
      await ctx.db.query(`UPDATE service_items SET selected_offer_id = $2, status = 'selected' WHERE id = $1 AND selected_offer_id IS DISTINCT FROM $2`, [l.serviceItemId, l.offerId]);
    }
  }
  if (firm) {
    await ctx.db.query(`UPDATE projects SET outcome = 'won', step = GREATEST(step, 5) WHERE id = $1`, [p.id]);
  } else {
    await ctx.db.query(
      `INSERT INTO tasks (tenant_id, project_id, assignee_id, kind, title, source, origin_key, entity_type, entity_id)
       VALUES (app_tenant_id(), $1, $2, 'signed_form', $3, 'rule', $4, 'quote', $5) ON CONFLICT (tenant_id, origin_key) DO NOTHING`,
      [p.id, p.owner_id, `${p.code}: müşteri online seçti — imzalı onay formu / PO bekleniyor`, `quote:${id}:signed_form`, id]);
  }
  return { ok: true, firm };
}

/** Staff records the signed form / PO for 'signed_or_po' customers → firm approval. */
export async function recordFirmApproval(ctx: Ctx, id: string, input: { poNumber?: string; signedFormFileName?: string }): Promise<Quote> {
  requireUser(ctx);
  const q = await getQuoteRow(ctx, id, true);
  if (q.status !== 'accepted' || !q.awaiting_signed_form) throw conflict('Bu teklif imzalı form beklemiyor', 'NOT_AWAITING_FORM');
  if (!input.poNumber?.trim() && !input.signedFormFileName?.trim()) throw badRequest('PO numarası veya imzalı form gerekli', undefined, 'PO_OR_FORM_REQUIRED');
  await ctx.db.query(
    `UPDATE quotes SET awaiting_signed_form = false, firm_approved_at = $2, po_number = COALESCE($3, po_number), signed_form_file_name = $4 WHERE id = $1`,
    [id, ctx.now(), input.poNumber?.trim() || null, input.signedFormFileName ?? null]);
  await ctx.db.query(`UPDATE projects SET outcome = 'won', step = GREATEST(step, 5) WHERE id = $1`, [q.project_id]);
  await ctx.db.query(`UPDATE tasks SET status = 'done', completed_at = $2 WHERE origin_key = $1 AND status = 'open'`, [`quote:${id}:signed_form`, ctx.now()]);
  return getQuote(ctx, id);
}

const REVISION_FIELDS: { key: 'startDate' | 'endDate' | 'pax' | 'roomsSgl' | 'roomsDbl'; col: string; label: string }[] = [
  { key: 'startDate', col: 'start_date', label: 'Başlangıç tarihi' }, { key: 'endDate', col: 'end_date', label: 'Bitiş tarihi' },
  { key: 'pax', col: 'pax', label: 'Kişi sayısı' }, { key: 'roomsSgl', col: 'rooms_sgl', label: 'SGL oda' }, { key: 'roomsDbl', col: 'rooms_dbl', label: 'DBL oda' },
];

/** §7 Adım 4 revizyon: diff list; dates/pax changed → back to step 1, price only → step 2. */
export async function publicRevision(ctx: Ctx, id: string, message: string): Promise<{ ok: true; targetStep: 1 | 2; diff: unknown[] }> {
  const q = await publicQuoteRow(ctx, id);
  if (!message?.trim()) throw badRequest('Revizyon mesajı boş olamaz', undefined, 'MESSAGE_REQUIRED');
  if (q.status !== 'sent') throw conflict('Bu teklif zaten yanıtlandı', 'QUOTE_ALREADY_ANSWERED');
  const p = await getProjectRow(ctx, q.project_id, true);
  const ex = await ctx.deps.ai.extractRequest(message, { channel: 'email', today: isoDate(ctx.now()) });
  await logAiAction(ctx, { actionType: 'diff_report', result: ex, projectId: p.id, entityType: 'quote', entityId: id, inputSummary: { revision: true } });
  const diff: { field: string; label: string; current: unknown; requested: unknown }[] = [];
  for (const f of REVISION_FIELDS) {
    const v = ex.data[f.key]?.value;
    if (v != null && String(v) !== String(p[f.col] ?? '')) diff.push({ field: f.key, label: f.label, current: p[f.col], requested: v });
  }
  if (!diff.length) diff.push({ field: 'price', label: 'Fiyat', current: null, requested: message.slice(0, 200) });
  const target = revisionTargetStep(diff.map((d) => d.field));
  await ctx.db.query(`UPDATE quotes SET status = 'revision_requested', revision_message = $2, revision_diff = $3 WHERE id = $1`, [id, message, JSON.stringify(diff)]);
  await ctx.db.query('UPDATE projects SET step = $2 WHERE id = $1', [p.id, target]);
  await ctx.db.query(
    `INSERT INTO tasks (tenant_id, project_id, assignee_id, kind, title, source, origin_key, entity_type, entity_id)
     VALUES (app_tenant_id(), $1, $2, 'quote_revision', $3, 'rule', $4, 'quote', $5) ON CONFLICT (tenant_id, origin_key) DO NOTHING`,
    [p.id, p.owner_id, `${p.code}: müşteri revizyon istedi → Adım ${target} (${diff.map((d) => d.label).join(', ')})`, `quote:${id}:revision`, id]);
  return { ok: true, targetStep: target, diff };
}

// ------------------------------------------------------------------ documents: quote PDF + internal P&L
async function quoteDocData(ctx: Ctx, quoteId: string) {
  const quote = await getQuote(ctx, quoteId);
  const p = await getProjectRow(ctx, quote.projectId);
  const customer = await customerOf(ctx, p);
  const tenant = (await ctx.db.query('SELECT name FROM tenants WHERE id = app_tenant_id()')).rows[0];
  const offerIds = [...new Set(quote.options.flatMap((o) => o.lines.map((l) => l.offerId)).filter((x): x is string => !!x))];
  const offers = offerIds.length ? (await ctx.db.query('SELECT id, version, payment_terms, cancellation_terms FROM supplier_offers WHERE id = ANY($1)', [offerIds])).rows : [];
  const itemIds = [...new Set(quote.options.flatMap((o) => o.lines.map((l) => l.serviceItemId)))];
  const deps = [
    { type: 'project', id: p.id }, { type: 'quote', id: quote.id, version: quote.version },
    ...itemIds.map((id) => ({ type: 'service_item', id })), ...offers.map((o) => ({ type: 'supplier_offer', id: o.id, version: o.version })),
    ...(customer ? [{ type: 'customer', id: customer.id }] : []),
  ];
  return { quote, p, customer, tenantName: tenant?.name ?? '', offers, deps };
}

const PRICING_STALE = /^(service_item|supplier_offer)|project değişti: .*(start_date|end_date|pax|rooms_sgl|rooms_dbl|hall_layout|fnb_needs)/;

function registerQuoteDocuments(): void {
  registerDocumentGenerator('quote', 'quote', async (ctx, { entityId }) => {
    const { quote, p, customer, tenantName, deps } = await quoteDocData(ctx, entityId!);
    const fx = quote.fxRate;
    const cur = quote.currency;
    const rules = await ctx.rules();
    const clauses: string[] = [];
    if (!customer?.rules.omitPaymentCancellationClauses) {
      clauses.push('Ödeme: konfirmasyonla birlikte sözleşmede belirtilen takvime göre.', 'İptal: tedarikçi iptal koşulları geçerlidir; detaylar sözleşmede.');
    }
    for (const c of customer?.rules.specialClauses ?? []) clauses.push(c);
    const content = {
      agencyName: tenantName, projectCode: p.code, customerName: p.customer_name, currency: cur, fxRate: fx, fxSource: quote.fxSource, fxDate: quote.fxDate,
      optionUntil: quote.optionUntil, appliedCustomerRules: quote.appliedCustomerRules, clauses,
      options: quote.options.map((o) => ({
        optionNo: o.optionNo, title: o.title,
        lines: o.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, nights: l.nights, unitPrice: round2(l.unitPriceEur * fx), total: round2(l.unitPriceEur * mult(l) * fx), vatRate: l.vatRate, valueAdd: l.valueAdd })),
        subtotal: round2(o.totals.saleEur * fx),
        vatLines: vatBreakdown(o, fx),
        accommodationTax: round2(o.accommodationTaxEur * fx),
        grandTotal: o.grandTotalCustomerCurrency,
      })),
    };
    const pdf = await renderPdf({
      header: {
        agencyName: tenantName, title: `Teklif — ${p.code}`, subtitle: p.title,
        meta: [['Müşteri', p.customer_name ?? '-'], ['Tarih', isoDate(ctx.now())], ['Etkinlik', `${p.start_date ?? '?'} – ${p.end_date ?? '?'}, ${p.pax ?? '?'} kişi`],
          ['Opsiyon', quote.optionUntil ?? '-'], ['Para birimi', `${cur} (1 EUR = ${fx} ${cur}, ${quote.fxSource} ${quote.fxDate})`], ['Teklif sürümü', `v${quote.version}`]],
      },
      sections: [
        ...content.options.map((o) => ({
          kind: 'table' as const,
          table: {
            title: `Seçenek ${o.optionNo}: ${o.title}`,
            columns: [{ label: 'Hizmet', width: 230 }, { label: 'Miktar', width: 70, align: 'right' as const }, { label: 'Birim fiyat', width: 105, align: 'right' as const }, { label: 'Tutar', width: 110, align: 'right' as const }],
            rows: o.lines.map((l) => [l.description + (l.valueAdd ? ' *' : ''), `${l.quantity}${l.nights ? ` × ${l.nights} gece` : ''}`, money(l.unitPrice, cur), money(l.total, cur)]),
            footer: [
              { label: 'Ara toplam (KDV hariç)', value: money(o.subtotal, cur) },
              ...o.vatLines.map((v) => ({ label: `KDV ${pct(v.rate)}`, value: money(v.amount, cur) })),
              { label: `Konaklama vergisi ${pct(rules.accommodationTaxRate)}`, value: money(o.accommodationTax, cur) },
              { label: 'Genel toplam', value: money(o.grandTotal, cur), bold: true },
            ],
          },
        })),
        ...(clauses.length ? [{ kind: 'text' as const, title: 'Koşullar', lines: clauses }] : []),
      ],
      footerNote: `Proje referansı ${p.code}. Fiyatlar ${quote.optionUntil ?? '-'} tarihine kadar opsiyonludur. * Acenta hizmeti.`,
    });
    return { content, pdf, fileName: `${p.code}-teklif-v${quote.version}.pdf`, deps };
  }, async (_ctx, doc) => {
    if (doc.stale_reason && PRICING_STALE.test(doc.stale_reason)) {
      throw conflict(`Fiyatı etkileyen veri değişti (${doc.stale_reason}) — yeni teklif sürümü oluşturun`, 'QUOTE_REBUILD_REQUIRED');
    }
  });

  registerDocumentGenerator('pnl', 'quote', async (ctx, { entityId }) => {
    const { quote, p, tenantName, deps } = await quoteDocData(ctx, entityId!);
    const fin = (await ctx.db.query(
      `SELECT kind, status, sum(amount_eur) AS total FROM finance_entries WHERE project_id = $1 AND status <> 'cancelled' GROUP BY kind, status`, [p.id])).rows;
    const contracts = (await ctx.db.query('SELECT id, status FROM contracts WHERE project_id = $1 AND superseded_by IS NULL', [p.id])).rows;
    const content = {
      projectCode: p.code, quoteVersion: quote.version, acceptedOptionNo: quote.acceptedOptionNo,
      options: quote.options.map((o) => ({
        optionNo: o.optionNo, title: o.title,
        lines: o.lines.map((l) => ({ description: l.description, costEur: round2(l.unitCostEur * mult(l)), saleEur: round2(l.unitPriceEur * mult(l)), markup: l.markup, valueAdd: l.valueAdd })),
        // §9 / §7 Adım 3: margin (Kâr÷Satış) and markup (Kâr÷Alış) on SEPARATE rows
        costEur: o.totals.costEur, saleEur: o.totals.saleEur, profitEur: o.totals.profitEur, margin: o.totals.margin, markup: o.totals.markup,
      })),
      finance: fin.map((f) => ({ kind: f.kind, status: f.status, totalEur: Number(f.total) })),
      contracts: contracts.map((c) => ({ id: c.id, status: c.status })),
      // Adım 7/8: realized P&L once there are invoices (plan vs actual; margin and markup separately)
      realized: quote.acceptedOptionNo != null ? await (await import('./documents-b.js')).realizedPnl(ctx, p.id) : null,
    };
    const realized = content.realized;
    const pdf = await renderPdf({
      header: { agencyName: tenantName, title: `İç kâr-zarar — ${p.code}`, subtitle: 'GİZLİ — müşteriye gönderilmez', meta: [['Teklif', `v${quote.version}`], ['Tarih', isoDate(ctx.now())]] },
      sections: [...content.options.map((o) => ({
        kind: 'table' as const,
        table: {
          title: `Seçenek ${o.optionNo}: ${o.title}${quote.acceptedOptionNo === o.optionNo ? ' (kabul edildi)' : ''}`,
          columns: [{ label: 'Kalem', width: 235 }, { label: 'Alış (EUR)', width: 95, align: 'right' as const }, { label: 'Satış (EUR)', width: 95, align: 'right' as const }, { label: 'Markup', width: 90, align: 'right' as const }],
          rows: o.lines.map((l) => [l.description, money(l.costEur, 'EUR'), money(l.saleEur, 'EUR'), l.valueAdd ? 'katma değer' : pct(l.markup)]),
          footer: [
            { label: 'Toplam alış', value: money(o.costEur, 'EUR') }, { label: 'Toplam satış', value: money(o.saleEur, 'EUR') },
            { label: 'Kâr', value: money(o.profitEur, 'EUR'), bold: true },
            { label: 'Marj (Kâr ÷ Satış)', value: pct(o.margin) }, { label: 'Markup (Kâr ÷ Alış)', value: pct(o.markup) },
          ],
        },
      })),
        ...(realized ? await realizedSections(realized) : []),
      ],
    });
    return { content, pdf, fileName: `${p.code}-kar-zarar-v${quote.version}.pdf`, deps };
  });
}

async function realizedSections(r: RealizedPnl): Promise<PdfSpec['sections']> {
  const { planVsActualRows } = await import('./documents-b.js');
  const out: PdfSpec['sections'] = [{
    kind: 'table',
    table: {
      title: 'Plan vs gerçekleşen (EUR)',
      columns: [{ label: '', width: 175 }, { label: 'Plan', width: 110, align: 'right' }, { label: 'Gerçekleşen', width: 110, align: 'right' }, { label: 'Fark', width: 110, align: 'right' }],
      rows: planVsActualRows(r),
    },
  }];
  if (r.suppliers.length) {
    out.push({
      kind: 'table',
      table: {
        title: 'Tedarikçi: sözleşme vs fatura (EUR)',
        columns: [{ label: 'Tedarikçi', width: 205 }, { label: 'Sözleşme', width: 100, align: 'right' }, { label: 'Fatura', width: 100, align: 'right' }, { label: 'Fark', width: 100, align: 'right' }],
        rows: r.suppliers.map((s) => [s.supplier, money(s.contractEur, 'EUR'), money(s.invoicedEur, 'EUR'), money(s.differenceEur, 'EUR')]),
      },
    });
  }
  const lines = [
    `Müşteri faturası: ${money(r.customerInvoicedEur, 'EUR')}`,
    `Saha ekstraları: ${money(r.extras.totalEur, 'EUR')} (yansıtılan ${money(r.extras.reflectedEur, 'EUR')}, yansıtılmayan ${money(r.extras.unreflectedEur, 'EUR')})`,
    ...r.deviations.map((d) => `${d.reason}: ${money(d.amountEur, 'EUR')}`),
  ];
  out.push({ kind: 'text', title: 'Sapma nedenleri', lines });
  return out;
}

function vatBreakdown(o: QuoteOption, fx: number): { rate: number; amount: number }[] {
  const m = new Map<number, number>();
  for (const l of o.lines) m.set(l.vatRate, (m.get(l.vatRate) ?? 0) + l.unitPriceEur * mult(l) * l.vatRate);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([rate, amt]) => ({ rate, amount: round2(amt * fx) }));
}

export { registerQuoteDocuments };
