// §7 Adım 2 — supplier offers (versioned, never overwritten), AI reading with confidence, human verification,
// price history, normalization + evaluation (channel price / history median; EUR internal), negotiation drafts.
import type {
  ChannelPriceInput, ComparisonResponse, Currency, ManualOfferInput, MessageDraft, NegotiationArgument, OfferEvaluation, OfferLine,
  Supplier, SupplierOffer,
} from '@mice/shared';
import type { FileInput, ParsedOffer } from '@mice/ai';
import {
  canNegotiate, daysInclusive, evaluateOffer, lineMultiplier, negotiationDraftViolations, normalizeOffer, splitLine,
  type ChannelBenchmark,
} from '@mice/domain';
import ExcelJS from 'exceljs';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { mapDraft, mapOffer, mapServiceItem, mapSupplier, type Row } from '../lib/mappers.js';
import { isoDate } from '../lib/dates.js';
import { attachAiActionEntity, logAiAction, recordCorrection } from './ai-log.js';
import { createDecision } from './decisions.js';
import { aiDraft } from './drafts.js';
import { currentFx, toEur, type FxSnapshot } from './fx.js';
import { getItemRow } from './items.js';
import { getProjectRow, setStep } from './projects.js';
import { aiGate } from './automation.js';

export interface OfferInput {
  supplierId: string;
  rfqId?: string | null;
  source: SupplierOffer['source'];
  currency: Currency;
  lines: OfferLine[];
  optionUntil?: string | null;
  guaranteePax?: number | null;
  attritionTerms?: string | null;
  paymentTerms?: string | null;
  prepaymentRate?: number | null;
  cancellationTerms?: string | null;
  overtimeTerms?: string | null;
  notes?: string | null;
  confidence: number | null;
  fieldConfidence?: Record<string, number> | null;
  rawText?: string | null;
  fileName?: string | null;
  aiActionId?: string | null;
  verifiedBy?: string | null;
}

export async function getOfferRow(ctx: Ctx, id: string, forUpdate = false): Promise<Row> {
  const { rows } = await ctx.db.query(`SELECT * FROM supplier_offers WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) throw notFound('Teklif');
  return rows[0];
}

/** VAT rates are fractions everywhere in the domain (0.1 = %10). @mice/ai now returns fractions too; this stays as a guard for
 *  manual / supplier-form input, which still accepts percent values (vatRate ≤ 100). */
export function normalizeLines(lines: OfferLine[]): OfferLine[] {
  return (lines ?? []).map((l) => ({ ...l, vatRate: l.vatRate > 1 ? Math.round(l.vatRate * 100) / 10000 : l.vatRate }));
}

/** Creates a new offer version (v+1) and supersedes the previous latest version of the same item × supplier. */
export async function createOfferVersion(ctx: Ctx, item: Row, input: OfferInput): Promise<Row> {
  const supplier = (await ctx.db.query('SELECT * FROM suppliers WHERE id = $1', [input.supplierId])).rows[0];
  if (!supplier) throw notFound('Tedarikçi');
  const prev = (await ctx.db.query(
    `SELECT * FROM supplier_offers WHERE service_item_id = $1 AND supplier_id = $2 ORDER BY version DESC LIMIT 1 FOR UPDATE`,
    [item.id, input.supplierId])).rows[0];
  const round = (await ctx.db.query(
    `SELECT COALESCE(max(round), 0) AS r FROM negotiation_rounds WHERE service_item_id = $1 AND supplier_id = $2 AND status IN ('approved','sent')`,
    [item.id, input.supplierId])).rows[0].r as number;
  const rfqId = input.rfqId ?? prev?.rfq_id ?? (await ctx.db.query(
    `SELECT id FROM rfqs WHERE service_item_id = $1 AND supplier_id = $2 ORDER BY created_at DESC LIMIT 1`, [item.id, input.supplierId])).rows[0]?.id ?? null;
  const row = (await ctx.db.query(
    `INSERT INTO supplier_offers (tenant_id, project_id, rfq_id, service_item_id, supplier_id, version, source, currency, lines, option_until,
       guarantee_pax, attrition_terms, payment_terms, prepayment_rate, cancellation_terms, overtime_terms, notes, confidence,
       field_confidence, raw_text, file_name, verified_by, verified_at, negotiation_round, ai_action_id, created_by)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING *`,
    [item.project_id, rfqId, item.id, input.supplierId, (prev?.version ?? 0) + 1, input.source, input.currency, JSON.stringify(normalizeLines(input.lines)),
      input.optionUntil ?? null, input.guaranteePax ?? null, input.attritionTerms ?? null, input.paymentTerms ?? null,
      input.prepaymentRate ?? null, input.cancellationTerms ?? null, input.overtimeTerms ?? null, input.notes ?? null, input.confidence,
      input.fieldConfidence ? JSON.stringify(input.fieldConfidence) : null, input.rawText ?? null, input.fileName ?? null,
      input.verifiedBy ?? null, input.verifiedBy ? ctx.now() : null, round, input.aiActionId ?? null, ctx.user?.id ?? null],
  )).rows[0];
  if (prev && !prev.superseded_by) await ctx.db.query('UPDATE supplier_offers SET superseded_by = $2 WHERE id = $1', [prev.id, row.id]);
  if (prev && item.selected_offer_id === prev.id) {
    // the selected version was revised → the item now points at the newest version (documents become stale via trigger)
    await ctx.db.query('UPDATE service_items SET selected_offer_id = $2 WHERE id = $1', [item.id, row.id]);
  }
  await writePriceHistory(ctx, item, supplier, row, round > 0 ? 'negotiated' : 'initial');
  await ctx.db.query(`UPDATE service_items SET status = 'offered' WHERE id = $1 AND status IN ('open','rfq')`, [item.id]);
  await setStep(ctx, item.project_id, 2);
  return row;
}

/** "Fiyat geçmişine kalem kalem yazılır" — one row per offer line, ex VAT / ex accommodation tax, in EUR. */
export async function writePriceHistory(ctx: Ctx, item: Row, supplier: Row, offer: Row, priceType: 'initial' | 'negotiated' | 'realized'): Promise<void> {
  const rules = await ctx.rules();
  const fx = await currentFx(ctx.db);
  const p = (await ctx.db.query('SELECT city, district, pax, start_date FROM projects WHERE id = $1', [item.project_id])).rows[0];
  const month = p?.start_date ? Number(String(p.start_date).slice(5, 7)) : null;
  const season = month == null ? null : month >= 4 && month <= 10 ? 'high' : 'low';
  for (const line of (offer.lines ?? []) as OfferLine[]) {
    const mult = lineMultiplier(line);
    if (!(mult > 0) || !(line.unitPrice > 0)) continue;
    const s = splitLine(line, rules.accommodationTaxRate);
    const unitNet = s.netExVat / mult;
    let unitEur: number;
    try {
      unitEur = toEur(fx, unitNet, offer.currency);
    } catch {
      continue;
    }
    await ctx.db.query(
      `INSERT INTO price_history (tenant_id, supplier_id, project_id, service_item_id, offer_id, kind, description, city, district, segment,
         season, service_date, pax, room_type, board, cancellation, unit, price_type, unit_price, currency, unit_price_eur)
       VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [supplier.id, item.project_id, item.id, offer.id, line.kind ?? item.kind, line.description, p?.city ?? supplier.city, p?.district ?? supplier.district,
        supplier.segment, season, item.date_from, p?.pax ?? null, line.roomType ?? null, line.board ?? null,
        offer.cancellation_terms ? (/iade|refund/i.test(offer.cancellation_terms) ? 'non_refundable' : 'flexible') : null,
        line.unit, priceType, Math.round(unitNet * 100) / 100, offer.currency, Math.round(unitEur * 100) / 100],
    );
  }
}

export async function manualOffer(ctx: Ctx, itemId: string, input: ManualOfferInput): Promise<SupplierOffer> {
  const user = requireUser(ctx);
  const item = await getItemRow(ctx, itemId);
  const row = await createOfferVersion(ctx, item, {
    supplierId: input.supplierId, rfqId: input.rfqId, source: input.source ?? 'manual', currency: input.currency, lines: input.lines,
    optionUntil: input.optionUntil, guaranteePax: input.guaranteePax, attritionTerms: input.attritionTerms, paymentTerms: input.paymentTerms,
    prepaymentRate: input.prepaymentRate, cancellationTerms: input.cancellationTerms, overtimeTerms: input.overtimeTerms, notes: input.notes,
    confidence: null, verifiedBy: user.id,
  });
  await respondedFromOffer(ctx, row);
  return mapOffer(row);
}

async function respondedFromOffer(ctx: Ctx, offer: Row): Promise<void> {
  if (!offer.rfq_id) return;
  const rfq = (await ctx.db.query('SELECT * FROM rfqs WHERE id = $1', [offer.rfq_id])).rows[0];
  if (rfq && ['sent', 'responded'].includes(rfq.status)) {
    const { markRfqResponded } = await import('./rfqs.js');
    await markRfqResponded(ctx, rfq, offer.option_until);
  }
}

export interface UploadedFile { filename: string; mimetype: string; buffer: Buffer }

/** XLSX → CSV text (exceljs) so the model reads a table, not a binary blob. */
export async function xlsxToCsv(buf: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: string[] = [];
  wb.eachSheet((ws) => {
    out.push(`# ${ws.name}`);
    ws.eachRow((row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => {
        const x = v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v;
        const s = x instanceof Date ? x.toISOString().slice(0, 10) : x == null ? '' : String(typeof x === 'object' && 'text' in (x as object) ? (x as { text: string }).text : x);
        return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      });
      out.push(vals.join(','));
    });
  });
  return out.join('\n');
}

export async function fileToAiInput(file: UploadedFile): Promise<{ text?: string; file?: FileInput; source: SupplierOffer['source'] }> {
  const name = file.filename.toLowerCase();
  if (name.endsWith('.xlsx') || file.mimetype.includes('spreadsheetml')) return { text: await xlsxToCsv(file.buffer), source: 'excel' };
  if (name.endsWith('.csv') || file.mimetype === 'text/csv') return { text: file.buffer.toString('utf8'), source: 'excel' };
  if (name.endsWith('.txt') || name.endsWith('.eml') || file.mimetype.startsWith('text/')) return { text: file.buffer.toString('utf8'), source: 'email' };
  if (name.endsWith('.pdf') || file.mimetype === 'application/pdf') {
    return { file: { filename: file.filename, mimeType: 'application/pdf', base64: file.buffer.toString('base64') }, source: 'pdf' };
  }
  if (file.mimetype.startsWith('image/')) return { file: { filename: file.filename, mimeType: file.mimetype, base64: file.buffer.toString('base64') }, source: 'image' };
  throw badRequest('Desteklenmeyen dosya türü (pdf, xlsx, csv, görsel, metin)', { mimetype: file.mimetype }, 'UNSUPPORTED_FILE');
}

/** AI offer reading (§7 Adım 1 yanıt okuma). Low confidence → human verification decision. */
export async function parseOffer(
  ctx: Ctx, itemId: string, input: { text?: string; file?: UploadedFile; supplierId?: string; rfqId?: string; viaPublicLink?: boolean },
): Promise<SupplierOffer> {
  const rules = await ctx.rules();
  const item = await getItemRow(ctx, itemId);
  let text = input.text;
  let fileInput: FileInput | undefined;
  let source: SupplierOffer['source'] = 'email';
  if (input.file) {
    const conv = await fileToAiInput(input.file);
    text = conv.text ?? text;
    fileInput = conv.file;
    source = conv.source;
  }
  if (!text && !fileInput) throw badRequest('Metin veya dosya gerekli', undefined, 'NO_INPUT');
  const result = await ctx.deps.ai.parseSupplierOffer({ text, file: fileInput, itemKind: item.kind, today: isoDate(ctx.now()) });
  const parsed: ParsedOffer = result.data;
  const aiActionId = await logAiAction(ctx, {
    actionType: 'document_reading', result, projectId: item.project_id, inputSummary: { kind: 'supplier_offer', source, fileName: input.file?.filename ?? null },
  });
  let supplierId = input.supplierId;
  if (!supplierId && parsed.supplierName) {
    const s = (await ctx.db.query('SELECT id FROM suppliers WHERE name ILIKE $1 LIMIT 1', [`%${parsed.supplierName}%`])).rows[0];
    supplierId = s?.id;
  }
  if (!supplierId) throw badRequest('Tedarikçi belirlenemedi; supplierId gönderin', undefined, 'SUPPLIER_REQUIRED');
  const fieldConfidence = { ...(parsed.fieldConfidence ?? {}) };
  if (!parsed.currency) fieldConfidence.currency = 0;
  const lowFields = Object.entries(fieldConfidence).filter(([, c]) => c < rules.aiConfidenceThreshold).map(([f]) => f);
  const row = await createOfferVersion(ctx, item, {
    supplierId, rfqId: input.rfqId ?? null, source, currency: (parsed.currency ?? 'EUR') as Currency, lines: parsed.lines ?? [],
    optionUntil: parsed.optionUntil, guaranteePax: parsed.guaranteePax, attritionTerms: parsed.attritionTerms, paymentTerms: parsed.paymentTerms,
    prepaymentRate: parsed.prepaymentRate, cancellationTerms: parsed.cancellationTerms, overtimeTerms: parsed.overtimeTerms, notes: parsed.notes,
    confidence: result.confidence, fieldConfidence, rawText: text ?? null, fileName: input.file?.filename ?? null, aiActionId,
  });
  await attachAiActionEntity(ctx, aiActionId, 'supplier_offer', row.id);
  if (input.file) {
    await ctx.db.query(
      `INSERT INTO offer_files (tenant_id, rfq_id, offer_id, file_name, mime_type, size_bytes, data, uploaded_via) VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7)`,
      [row.rfq_id, row.id, input.file.filename, input.file.mimetype, input.file.buffer.length, input.file.buffer, input.viaPublicLink ? 'supplier' : 'staff'],
    );
  }
  if (result.confidence < rules.aiConfidenceThreshold || lowFields.length || !(parsed.lines ?? []).length) {
    const s = (await ctx.db.query('SELECT name FROM suppliers WHERE id = $1', [supplierId])).rows[0];
    await createDecision(ctx, {
      projectId: item.project_id, kind: 'low_confidence_review', badge: 'suggestion', requiredRole: 'clerk_sales',
      summary: `${s?.name ?? 'Tedarikçi'} teklifi düşük güvenle okundu (%${Math.round(result.confidence * 100)}) — doğrulayın`,
      detail: { offerId: row.id, itemId, confidence: result.confidence, lowFields, fieldConfidence },
      aiNote: lowFields.length ? `Emin olunmayan alanlar: ${lowFields.join(', ')}` : null,
      entityType: 'supplier_offer', entityId: row.id,
      draft: { currency: row.currency, lines: row.lines, optionUntil: row.option_until, guaranteePax: row.guarantee_pax, prepaymentRate: row.prepayment_rate, paymentTerms: row.payment_terms, cancellationTerms: row.cancellation_terms, attritionTerms: row.attrition_terms },
      aiActionId,
    });
  }
  await respondedFromOffer(ctx, row);
  return mapOffer(row);
}

const VERIFIABLE: (keyof SupplierOffer)[] = [
  'currency', 'lines', 'optionUntil', 'guaranteePax', 'attritionTerms', 'paymentTerms', 'prepaymentRate', 'cancellationTerms', 'overtimeTerms', 'notes',
];

/** Human verification of an AI reading. Corrections create a NEW version (never overwrite) and are logged as learning data. */
export async function verifyOffer(ctx: Ctx, offerId: string, patch: Partial<SupplierOffer>): Promise<SupplierOffer> {
  const user = requireUser(ctx);
  const o = await getOfferRow(ctx, offerId, true);
  if (o.superseded_by) throw conflict('Bu sürüm eskidi; güncel sürümü doğrulayın', 'OFFER_SUPERSEDED');
  const current = mapOffer(o);
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of VERIFIABLE) {
    if (patch[k] === undefined) continue;
    if (JSON.stringify(patch[k]) !== JSON.stringify(current[k])) changes[k] = { before: current[k], after: patch[k] };
  }
  let result: Row;
  if (Object.keys(changes).length) {
    const item = await getItemRow(ctx, o.service_item_id);
    const merged = { ...current, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.after])) } as SupplierOffer;
    result = await createOfferVersion(ctx, item, {
      supplierId: o.supplier_id, rfqId: o.rfq_id, source: o.source, currency: merged.currency, lines: merged.lines, optionUntil: merged.optionUntil,
      guaranteePax: merged.guaranteePax, attritionTerms: merged.attritionTerms, paymentTerms: merged.paymentTerms, prepaymentRate: merged.prepaymentRate,
      cancellationTerms: merged.cancellationTerms, overtimeTerms: merged.overtimeTerms, notes: merged.notes, confidence: 1,
      rawText: o.raw_text, fileName: o.file_name, aiActionId: o.ai_action_id, verifiedBy: user.id,
    });
    await recordCorrection(ctx, o.ai_action_id, { offerId, newOfferId: result.id, changes });
  } else {
    result = (await ctx.db.query('UPDATE supplier_offers SET verified_by = $2, verified_at = $3 WHERE id = $1 RETURNING *', [offerId, user.id, ctx.now()])).rows[0];
  }
  await ctx.db.query(
    `UPDATE decisions SET status = $2, action = $3, decided_by = $4, decided_at = $5, edits = $6
     WHERE kind = 'low_confidence_review' AND status = 'open' AND entity_id = $1`,
    [offerId, Object.keys(changes).length ? 'edited' : 'approved', Object.keys(changes).length ? 'edit' : 'approve', user.id, ctx.now(),
      Object.keys(changes).length ? JSON.stringify(changes) : null],
  );
  return mapOffer(result);
}

// ------------------------------------------------------------------ comparison
async function channelBenchmark(ctx: Ctx, offer: SupplierOffer, item: Row, fx: FxSnapshot): Promise<ChannelBenchmark | null> {
  const acc = offer.lines.find((l) => l.kind === 'accommodation');
  if (!acc || !item.date_from) return null;
  const to = item.date_to && item.date_to > item.date_from ? item.date_to : item.date_from;
  const { rows } = await ctx.db.query(
    `SELECT room_type, board, cancellation, price_eur FROM channel_prices WHERE supplier_id = $1 AND stay_date >= $2 AND stay_date <= $3`,
    [offer.supplierId, item.date_from, to],
  );
  if (!rows.length) return null;
  const wantCancel = offer.cancellationTerms && /(iadesiz|non[- ]?refundable|iade edilmez)/i.test(offer.cancellationTerms) ? 'non_refundable' : 'flexible';
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
  const match = rows.filter((r) => norm(r.room_type) === norm(acc.roomType) && norm(r.board) === norm(acc.board) && r.cancellation === wantCancel);
  void fx;
  const avg = (xs: Row[]) => xs.reduce((s, r) => s + Number(r.price_eur), 0) / xs.length;
  if (match.length) return { priceEur: Math.round(avg(match) * 100) / 100, conditionsMatch: true };
  return { priceEur: Math.round(avg(rows) * 100) / 100, conditionsMatch: false };
}

async function historyFor(ctx: Ctx, offer: SupplierOffer, item: Row, project: Row): Promise<{ history: number[]; unitPriceEur: number | null }> {
  const fx = await currentFx(ctx.db);
  const rules = await ctx.rules();
  const main = offer.lines.find((l) => l.kind === item.kind) ?? offer.lines[0];
  if (!main) return { history: [], unitPriceEur: null };
  const mult = lineMultiplier(main);
  let unitPriceEur: number | null = null;
  if (mult > 0) {
    try {
      unitPriceEur = Math.round(toEur(fx, splitLine(main, rules.accommodationTaxRate).netExVat / mult, offer.currency) * 100) / 100;
    } catch {
      unitPriceEur = null;
    }
  }
  const { rows } = await ctx.db.query(
    `SELECT unit_price_eur FROM price_history WHERE kind = $1 AND unit = $2 AND ($3::text IS NULL OR lower(city) = lower($3))
       AND (service_item_id IS NULL OR service_item_id <> $4) AND created_at > now() - interval '24 months'`,
    [item.kind, main.unit, project.city, item.id],
  );
  return { history: rows.map((r) => Number(r.unit_price_eur)), unitPriceEur };
}

export async function evaluateItemOffers(ctx: Ctx, item: Row, project: Row): Promise<{ offers: SupplierOffer[]; evaluations: OfferEvaluation[]; suppliers: Supplier[] }> {
  const rules = await ctx.rules();
  const fx = await currentFx(ctx.db);
  const offerRows = (await ctx.db.query(
    'SELECT * FROM supplier_offers WHERE service_item_id = $1 AND superseded_by IS NULL ORDER BY created_at', [item.id])).rows;
  const offers = offerRows.map(mapOffer);
  const supplierIds = [...new Set(offers.map((o) => o.supplierId))];
  const suppliers = supplierIds.length ? (await ctx.db.query('SELECT * FROM suppliers WHERE id = ANY($1)', [supplierIds])).rows.map(mapSupplier) : [];
  const evaluations: OfferEvaluation[] = [];
  const it = mapServiceItem(item);
  for (const offer of offers) {
    const s = suppliers.find((x) => x.id === offer.supplierId);
    let normalized;
    try {
      normalized = normalizeOffer(offer, { item: it, pax: project.pax, days: daysInclusive(item.date_from, item.date_to), rates: fx.rates, accommodationTaxRate: rules.accommodationTaxRate });
    } catch {
      continue; // unknown currency etc. — never guess (§3.7)
    }
    const base = { kind: it.kind, normalized, supplierStatus: s?.status ?? 'candidate', rules, valueAdd: it.valueAdd } as const;
    if (it.kind === 'accommodation') {
      evaluations.push(evaluateOffer({ ...base, channel: await channelBenchmark(ctx, offer, item, fx) }));
    } else {
      const h = await historyFor(ctx, offer, item, project);
      evaluations.push(evaluateOffer({ ...base, history: h.history, unitPriceEur: h.unitPriceEur }));
    }
  }
  return { offers, evaluations, suppliers };
}

export async function comparison(ctx: Ctx, itemId: string): Promise<ComparisonResponse> {
  const item = await getItemRow(ctx, itemId);
  const project = await getProjectRow(ctx, item.project_id);
  const r = await evaluateItemOffers(ctx, item, project);
  await logAiAction(ctx, { actionType: 'comparison', projectId: project.id, entityType: 'service_item', entityId: itemId, result: { confidence: 1, model: 'domain', data: { offers: r.offers.length } } });
  return { item: mapServiceItem(item), ...r };
}

// ------------------------------------------------------------------ negotiation (§7 Adım 2)
const ARG_LABELS: Record<NegotiationArgument, string> = {
  volume: 'hacim (grup büyüklüğü / gelecek iş)', relationship: 'uzun vadeli ilişki', flexible_dates: 'esnek tarih', payment_ease: 'ödeme kolaylığı',
};

export async function negotiate(ctx: Ctx, offerId: string, args: NegotiationArgument[]): Promise<MessageDraft> {
  const user = requireUser(ctx);
  const rules = await ctx.rules();
  const o = await getOfferRow(ctx, offerId);
  if (o.superseded_by) throw conflict('Eski teklif sürümü için pazarlık yapılamaz', 'OFFER_SUPERSEDED');
  const item = await getItemRow(ctx, o.service_item_id);
  const p = await getProjectRow(ctx, item.project_id);
  const current = (await ctx.db.query(
    `SELECT COALESCE(max(round), 0) AS r FROM negotiation_rounds WHERE service_item_id = $1 AND supplier_id = $2 AND status <> 'rejected'`,
    [item.id, o.supplier_id])).rows[0].r as number;
  const can = canNegotiate(current, rules.maxNegotiationRounds);
  if (!can.allowed) {
    throw conflict(can.reason ?? `En fazla ${rules.maxNegotiationRounds} tur taslak; sonrası telefonla`, 'NEGOTIATION_LIMIT', { offerId });
  }
  const supplier = (await ctx.db.query('SELECT * FROM suppliers WHERE id = $1', [o.supplier_id])).rows[0];
  const others = (await ctx.db.query(
    'SELECT DISTINCT s.name FROM supplier_offers so JOIN suppliers s ON s.id = so.supplier_id WHERE so.service_item_id = $1 AND so.supplier_id <> $2',
    [item.id, o.supplier_id])).rows.map((r) => r.name as string);
  const ownerId = p.owner_id ?? user.id;
  const owner = (await ctx.db.query('SELECT full_name FROM users WHERE id = $1', [ownerId])).rows[0];
  const offer = mapOffer(o);
  // facts deliberately exclude any competitor information (§7 Adım 2: rakip fiyatı argüman olarak kullanılmaz)
  const draft = await aiDraft(ctx, {
    kind: 'negotiation', language: 'tr', senderName: owner?.full_name, recipientName: supplier.contact_name ?? supplier.name,
    facts: {
      projectCode: p.code, item: item.description, pax: p.pax, dates: [item.date_from, item.date_to], round: current + 1,
      arguments: args.map((a) => ARG_LABELS[a]), currentOffer: { currency: offer.currency, lines: offer.lines.map((l) => ({ description: l.description, unitPrice: l.unitPrice, quantity: l.quantity })) },
    },
  }, { projectId: p.id, to: supplier.email, status: 'pending_approval', requiresApproval: true, fromUserId: ownerId, entityType: 'supplier_offer', entityId: o.id });
  const violations = negotiationDraftViolations(`${draft.subject ?? ''}\n${draft.body}`, others);
  const round = (await ctx.db.query(
    `INSERT INTO negotiation_rounds (tenant_id, project_id, service_item_id, supplier_id, offer_id, round, arguments, draft_id, violations, status, created_by)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,'pending_approval',$9) RETURNING *`,
    [p.id, item.id, o.supplier_id, o.id, current + 1, args, draft.id, JSON.stringify(violations), user.id],
  )).rows[0];
  const gate = await aiGate(ctx, 'negotiation_message', {
    projectId: p.id, kind: 'negotiation_message', badge: violations.length ? 'critical' : 'within_rules',
    summary: `${p.code}: ${supplier.name} — ${current + 1}. tur pazarlık mesajı`,
    detail: { offerId: o.id, roundId: round.id, round: current + 1, arguments: args, violations, draftId: draft.id, to: supplier.email },
    aiNote: violations.length ? `Kural ihlali şüphesi: ${violations.join('; ')}` : `Argümanlar: ${args.map((a) => ARG_LABELS[a]).join(', ')}`,
    requiredRole: 'admin', entityType: 'message_draft', entityId: draft.id, draft: { subject: draft.subject, body: draft.body },
    aiActionId: draft.ai_action_id, forceApproval: violations.length > 0,
  });
  await ctx.db.query('UPDATE negotiation_rounds SET decision_id = $2 WHERE id = $1', [round.id, gate.decision.id]);
  return mapDraft((await ctx.db.query('SELECT * FROM message_drafts WHERE id = $1', [draft.id])).rows[0]);
}

/** After the round limit the human takes over by phone (§7 Adım 2) — runs in its own transaction (the refused request rolls back). */
export async function ensureNegotiationCallTask(ctx: Ctx, offerId: string): Promise<void> {
  const o = await getOfferRow(ctx, offerId);
  const p = await getProjectRow(ctx, o.project_id);
  await ctx.db.query(
    `INSERT INTO tasks (tenant_id, project_id, assignee_id, kind, title, source, origin_key, entity_type, entity_id)
     VALUES (app_tenant_id(), $1, $2, 'call_supplier', $3, 'rule', $4, 'supplier_offer', $5) ON CONFLICT (tenant_id, origin_key) DO NOTHING`,
    [p.id, p.owner_id ?? ctx.user?.id ?? null, `${p.code}: pazarlık turu limiti doldu — tedarikçiyi telefonla arayın`, `negotiation:${o.service_item_id}:${o.supplier_id}:call`, o.id],
  );
}

export async function addChannelPrice(ctx: Ctx, input: ChannelPriceInput): Promise<{ id: string }> {
  const user = requireUser(ctx);
  const fx = await currentFx(ctx.db);
  const s = await ctx.db.query('SELECT 1 FROM suppliers WHERE id = $1', [input.supplierId]);
  if (!s.rowCount) throw notFound('Tedarikçi');
  const priceEur = Math.round(toEur(fx, input.price, input.currency) * 100) / 100;
  const { rows } = await ctx.db.query(
    `INSERT INTO channel_prices (tenant_id, supplier_id, stay_date, room_type, board, cancellation, price, currency, price_eur, source, captured_by)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [input.supplierId, input.date, input.roomType, input.board, input.cancellation, input.price, input.currency.toUpperCase(), priceEur, input.source, user.id],
  );
  return { id: rows[0].id };
}
