// §7 Adım 5 (onay kapısı) — confirmation & contract: agency template from the accepted quote, AI reading of the supplier
// contract, field-by-field diff vs quote, mutual condition risk, accreditation lock, approval, wet-signature recording
// (locks the version), commitment record (payable/receivable), supplier confirmation DRAFT (AI never confirms itself).
import type { Contract, ContractFields, Currency, OfferLine } from '@mice/shared';
import {
  changeImpact, conditionRisk, diffContractVsQuote, isContractClean, lineMultiplier, roleCan, type QuoteSnapshotForContract,
} from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { mapContract, mapCustomer, type Row } from '../lib/mappers.js';
import { addDaysIso, isoDate } from '../lib/dates.js';
import { logAiAction } from './ai-log.js';
import { aiGate, assertAiMayExecute } from './automation.js';
import { createDecision, expireDecisionsFor } from './decisions.js';
import { aiDraft } from './drafts.js';
import { currentFx, toEur } from './fx.js';
import { fileToAiInput, type UploadedFile } from './offers.js';
import { getProjectRow, setStep } from './projects.js';
import { getQuote } from './quotes.js';
import { supplierRef } from './visibility.js';

export async function getContractRow(ctx: Ctx, id: string, forUpdate = false): Promise<Row> {
  const { rows } = await ctx.db.query(`SELECT * FROM contracts WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) throw notFound('Sözleşme');
  return rows[0];
}

async function acceptedQuote(ctx: Ctx, projectId: string) {
  const r = (await ctx.db.query(
    `SELECT id FROM quotes WHERE project_id = $1 AND status = 'accepted' ORDER BY version DESC LIMIT 1`, [projectId])).rows[0];
  if (!r) throw conflict('Kabul edilmiş müşteri teklifi yok', 'NO_ACCEPTED_QUOTE');
  const quote = await getQuote(ctx, r.id);
  const option = quote.options.find((o) => o.optionNo === quote.acceptedOptionNo);
  if (!option) throw conflict('Kabul edilen seçenek bulunamadı', 'NO_ACCEPTED_QUOTE');
  return { quote, option };
}

interface Snapshot {
  snapshot: QuoteSnapshotForContract;
  supplierTotal: number;
  supplierCurrency: Currency;
  customerTotalEur: number;
  customerTotalQuoteCurrency: number;
  prepaymentRate: number;
  quoteId: string;
  quoteCurrency: Currency;
}

/** The accepted quote projected into ContractFields for the given supplier's items (supplier-side prices). */
async function quoteSnapshot(ctx: Ctx, projectId: string, supplierId: string, itemIds: string[]): Promise<Snapshot> {
  const rules = await ctx.rules();
  const p = await getProjectRow(ctx, projectId);
  const customer = p.customer_id ? mapCustomer((await ctx.db.query('SELECT * FROM customers WHERE id = $1', [p.customer_id])).rows[0]) : null;
  const supplier = (await ctx.db.query('SELECT * FROM suppliers WHERE id = $1', [supplierId])).rows[0];
  const { quote, option } = await acceptedQuote(ctx, projectId);
  const lines = option.lines.filter((l) => itemIds.includes(l.serviceItemId));
  const offerIds = [...new Set(lines.map((l) => l.offerId).filter((x): x is string => !!x))];
  // deterministic: quote-line order (the first offer supplies the contract terms below — never rely on plan order)
  const offers = offerIds.length ? (await ctx.db.query('SELECT * FROM supplier_offers WHERE id = ANY($1::uuid[]) ORDER BY array_position($1::uuid[], id)', [offerIds])).rows : [];
  if (offers.some((o) => o.supplier_id !== supplierId)) throw badRequest('Seçilen kalemlerin teklifi bu tedarikçiye ait değil', undefined, 'SUPPLIER_MISMATCH');
  const items = (await ctx.db.query('SELECT * FROM service_items WHERE id = ANY($1)', [itemIds])).rows;
  const offerLines: OfferLine[] = offers.flatMap((o) => o.lines as OfferLine[]);
  const first = offers[0];
  const supplierTotal = offerLines.reduce((s, l) => s + l.unitPrice * lineMultiplier(l), 0);
  const mult = (l: { quantity: number; nights: number | null }) => l.quantity * (l.nights && l.nights > 0 ? l.nights : 1);
  let saleEur = 0;
  for (const l of lines) {
    const s = l.unitPriceEur * mult(l);
    saleEur += s + s * l.vatRate + (l.kind === 'accommodation' ? s * rules.accommodationTaxRate : 0);
  }
  const fnb = items.find((i) => i.kind === 'fnb');
  const dates = items.map((i) => i.date_from).filter(Boolean).sort();
  const datesTo = items.map((i) => i.date_to).filter(Boolean).sort();
  const snapshot: QuoteSnapshotForContract = {
    supplierName: supplier?.name ?? null,
    customerName: p.customer_name,
    billingInfo: p.billing_info ?? customer?.billingAddress ?? null,
    startDate: dates[0] ?? p.start_date,
    endDate: datesTo[datesTo.length - 1] ?? p.end_date,
    pax: p.pax,
    guaranteePax: first?.guarantee_pax ?? null,
    rooms: offerLines.filter((l) => l.kind === 'accommodation').map((l) => ({ type: l.roomType ?? l.description, count: l.quantity, nights: l.nights ?? 1, unitPrice: l.unitPrice })),
    menu: (fnb?.specs?.menu as string | undefined) ?? p.fnb_needs ?? null,
    hall: items.some((i) => i.kind === 'hall') ? p.hall_layout : null,
    unitPrices: offerLines.filter((l) => l.kind !== 'accommodation').map((l) => ({ description: l.description, unitPrice: l.unitPrice, quantity: l.quantity })),
    vatSeparated: true,
    accommodationTaxSeparated: offerLines.some((l) => l.kind === 'accommodation') ? true : null,
    currency: (first?.currency ?? null) as Currency | null,
    totalAmount: Math.round(supplierTotal * 100) / 100,
    paymentTerms: first?.payment_terms ?? null,
    prepaymentRate: first?.prepayment_rate != null ? Number(first.prepayment_rate) : null,
    cancellationTerms: first?.cancellation_terms ?? null,
    attritionTerms: first?.attrition_terms ?? null,
    optionDate: first?.option_until ?? null,
    valueAddDescriptions: option.lines.filter((l) => l.valueAdd).map((l) => l.description),
  };
  return {
    snapshot, supplierTotal, supplierCurrency: (first?.currency ?? 'EUR') as Currency, customerTotalEur: saleEur,
    customerTotalQuoteCurrency: Math.round(saleEur * quote.fxRate * 100) / 100, prepaymentRate: snapshot.prepaymentRate ?? 0,
    quoteId: quote.id, quoteCurrency: quote.currency,
  };
}

function fieldsFromSnapshot(s: QuoteSnapshotForContract): ContractFields {
  const { valueAddDescriptions: _v, ...fields } = s;
  void _v;
  return fields;
}

export async function createContract(ctx: Ctx, projectId: string, input: { supplierId: string; serviceItemIds: string[]; template: 'agency' | 'supplier' }): Promise<Contract> {
  const user = requireUser(ctx);
  await getProjectRow(ctx, projectId);
  const supplier = (await ctx.db.query('SELECT * FROM suppliers WHERE id = $1', [input.supplierId])).rows[0];
  if (!supplier) throw notFound('Tedarikçi');
  if (supplier.status !== 'accredited') {
    throw conflict(`${supplier.name} akredite değil — akreditasyon olmadan sözleşme/konfirmasyon süreci durur (§7 Adım 5)`, 'SUPPLIER_NOT_ACCREDITED');
  }
  if (!input.serviceItemIds.length) throw badRequest('En az bir kalem seçin', undefined, 'ITEMS_REQUIRED');
  const items = (await ctx.db.query('SELECT id FROM service_items WHERE id = ANY($1) AND project_id = $2', [input.serviceItemIds, projectId])).rows;
  if (items.length !== new Set(input.serviceItemIds).size) throw badRequest('Kalemler bu projeye ait değil', undefined, 'INVALID_ITEM');
  const snap = await quoteSnapshot(ctx, projectId, input.supplierId, input.serviceItemIds);
  const version = (await ctx.db.query('SELECT COALESCE(max(version), 0) + 1 AS v FROM contracts WHERE project_id = $1 AND supplier_id = $2', [projectId, input.supplierId])).rows[0].v;
  const fields: ContractFields = input.template === 'agency' ? fieldsFromSnapshot(snap.snapshot) : emptyFields();
  const { rows } = await ctx.db.query(
    `INSERT INTO contracts (tenant_id, project_id, supplier_id, quote_id, service_item_ids, version, template, status, fields, created_by)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,'draft',$7,$8) RETURNING *`,
    [projectId, input.supplierId, snap.quoteId, input.serviceItemIds, version, input.template, JSON.stringify(fields), user.id],
  );
  await setStep(ctx, projectId, 5);
  return mapContract(rows[0]);
}

function emptyFields(): ContractFields {
  return {
    supplierName: null, customerName: null, billingInfo: null, startDate: null, endDate: null, pax: null, guaranteePax: null, rooms: [],
    menu: null, hall: null, unitPrices: [], vatSeparated: null, accommodationTaxSeparated: null, currency: null, totalAmount: null,
    paymentTerms: null, prepaymentRate: null, cancellationTerms: null, attritionTerms: null, optionDate: null,
  };
}

function assertEditable(c: Row): void {
  if (c.locked) throw conflict('İmzalı sözleşme kilitli; değişiklik ek protokol ile yapılır', 'CONTRACT_LOCKED');
  if (c.superseded_by) throw conflict('Bu sözleşme sürümü eskidi', 'CONTRACT_SUPERSEDED');
}

/** AI reads the supplier's contract (text / PDF / image); the draft is updated (version+1, audit keeps history). */
export async function parseContract(ctx: Ctx, id: string, input: { text?: string; file?: UploadedFile }): Promise<Contract> {
  const c = await getContractRow(ctx, id, true);
  assertEditable(c);
  let text = input.text;
  let file;
  if (input.file) {
    const conv = await fileToAiInput(input.file);
    text = conv.text ?? text;
    file = conv.file;
  }
  if (!text && !file) throw badRequest('Metin veya dosya gerekli', undefined, 'NO_INPUT');
  const result = await ctx.deps.ai.parseContract({ text, file, today: isoDate(ctx.now()) });
  await logAiAction(ctx, { actionType: 'document_reading', result, projectId: c.project_id, entityType: 'contract', entityId: id, inputSummary: { kind: 'contract', fileName: input.file?.filename ?? null } });
  const { rows } = await ctx.db.query(
    `UPDATE contracts SET fields = $2, extraction_confidence = $3, source_text = $4, template = 'supplier', status = 'draft', diff = '[]',
       version = version + 1, approved_by = NULL, approved_at = NULL WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(result.data), result.confidence, text ?? null],
  );
  await expireDecisionsFor(ctx, 'contract', id);
  return mapContract(rows[0]);
}

export async function compareContract(ctx: Ctx, id: string): Promise<Contract> {
  const rules = await ctx.rules();
  const c = await getContractRow(ctx, id, true);
  assertEditable(c);
  const p = await getProjectRow(ctx, c.project_id);
  const snap = await quoteSnapshot(ctx, c.project_id, c.supplier_id, c.service_item_ids);
  const fields = c.fields as ContractFields;
  // agency template: fields we filled from project data are refreshed when they were empty and the project now has them
  // (e.g. billing info added later in the project Overview) — the supplier's own contract text is never rewritten.
  if (c.template === 'agency' && !fields.billingInfo && snap.snapshot.billingInfo) {
    fields.billingInfo = snap.snapshot.billingInfo;
    await ctx.db.query('UPDATE contracts SET fields = $2 WHERE id = $1', [id, JSON.stringify(fields)]);
  }
  const diff = diffContractVsQuote(fields, snap.snapshot);
  const clean = isContractClean(diff);
  const fx = await currentFx(ctx.db);
  const supplierTotalEur = fields.totalAmount != null && fields.currency
    ? toEur(fx, fields.totalAmount, fields.currency) : toEur(fx, snap.supplierTotal, snap.supplierCurrency);
  const customer = p.customer_id ? mapCustomer((await ctx.db.query('SELECT * FROM customers WHERE id = $1', [p.customer_id])).rows[0]) : null;
  const risk = conditionRisk({
    supplierTotalEur, supplierPrepaymentRate: fields.prepaymentRate ?? snap.prepaymentRate ?? 0,
    customerTotalEur: snap.customerTotalEur, customerDepositRate: customer?.rules.depositRate ?? 0,
  });
  await logAiAction(ctx, {
    actionType: 'diff_report', projectId: p.id, entityType: 'contract', entityId: id,
    result: { confidence: c.extraction_confidence != null ? Number(c.extraction_confidence) : 1, model: 'domain', data: { diff, risk } },
  });
  const lowConfidence = c.extraction_confidence != null && Number(c.extraction_confidence) < rules.aiConfidenceThreshold;
  const status = clean && !lowConfidence ? 'clean' : 'diff_pending';
  const riskAccepted = risk.riskEur > 0 && c.condition_risk_accepted_by && Number(c.condition_risk_eur) === risk.riskEur;
  await ctx.db.query(
    `UPDATE contracts SET diff = $2, condition_risk_eur = $3, condition_risk_note = $4, status = $5,
       condition_risk_accepted_by = CASE WHEN $6::boolean THEN condition_risk_accepted_by ELSE NULL END WHERE id = $1`,
    [id, JSON.stringify(diff), risk.riskEur, risk.note, status, !!riskAccepted]);
  await expireDecisionsFor(ctx, 'contract', id);
  const supplier = (await ctx.db.query('SELECT name, email, contact_name FROM suppliers WHERE id = $1', [c.supplier_id])).rows[0];

  if (status === 'diff_pending') {
    const problems = diff.filter((d) => d.kind !== 'value_add');
    const draft = await aiDraft(ctx, {
      kind: 'revision_request', language: 'tr', recipientName: supplier?.contact_name ?? supplier?.name,
      facts: { projectCode: await supplierRef(ctx, p.code), differences: problems.map((d) => d.message), lowConfidence },
    }, { projectId: p.id, to: supplier?.email ?? null, status: 'pending_approval', requiresApproval: true, fromUserId: p.owner_id ?? ctx.user?.id ?? null, entityType: 'contract', entityId: id });
    await aiGate(ctx, 'revision_request', {
      projectId: p.id, kind: 'contract_diff', badge: diff.some((d) => d.severity === 'error') ? 'critical' : 'suggestion',
      summary: `${p.code}: ${supplier?.name ?? ''} sözleşmesinde ${problems.length} fark — sözleşme temiz olana kadar imzaya geçilmez`,
      detail: { contractId: id, diff, draftId: draft.id, extractionConfidence: c.extraction_confidence, lowConfidence },
      aiNote: problems.slice(0, 3).map((d) => d.message).join(' · ') || (lowConfidence ? 'Okuma güveni düşük — elle kontrol edin' : null),
      requiredRole: 'admin', entityType: 'contract', entityId: id, draft: { subject: draft.subject, body: draft.body }, aiActionId: draft.ai_action_id,
    });
  }
  if (risk.riskEur > 0 && !riskAccepted) {
    await createDecision(ctx, {
      projectId: p.id, kind: 'condition_risk', badge: 'critical', urgent: true,
      summary: `${p.code}: karşılıklı koşul riski ${Math.round(risk.riskEur).toLocaleString('tr-TR')} EUR`,
      detail: { contractId: id, riskEur: risk.riskEur, note: risk.note, supplierPrepaymentRate: fields.prepaymentRate ?? snap.prepaymentRate, customerDepositRate: customer?.rules.depositRate ?? 0 },
      aiNote: risk.note, requiredRole: 'admin', entityType: 'contract', entityId: id, primaryActionLabel: 'Riski kabul et',
    });
  }
  if (status === 'clean' && (risk.riskEur <= 0 || riskAccepted)) await requestContractApproval(ctx, id);
  return mapContract(await getContractRow(ctx, id));
}

/** Clean contract → admin approval card (biometric). */
export async function requestContractApproval(ctx: Ctx, id: string): Promise<void> {
  const c = await getContractRow(ctx, id, true);
  if (c.status !== 'clean') return;
  const p = await getProjectRow(ctx, c.project_id);
  const supplier = (await ctx.db.query('SELECT name FROM suppliers WHERE id = $1', [c.supplier_id])).rows[0];
  await ctx.db.query(`UPDATE contracts SET status = 'pending_approval' WHERE id = $1`, [id]);
  await createDecision(ctx, {
    projectId: p.id, kind: 'contract_approval', badge: (c.diff ?? []).length ? 'critical' : 'within_rules',
    summary: `${p.code}: ${supplier?.name ?? ''} sözleşmesi temiz — imzaya onay`,
    detail: { contractId: id, totalAmount: c.fields?.totalAmount, currency: c.fields?.currency, diffInfo: c.diff, conditionRiskEur: c.condition_risk_eur },
    requiredRole: 'admin', entityType: 'contract', entityId: id,
  });
}

export async function approveContract(ctx: Ctx, id: string, adminId: string | null): Promise<string[]> {
  const c = await getContractRow(ctx, id, true);
  if (c.status !== 'pending_approval') return [`contract_not_pending:${c.status}`];
  await ctx.db.query(`UPDATE contracts SET status = 'approved', approved_by = $2, approved_at = $3 WHERE id = $1`, [id, adminId, ctx.now()]);
  return ['contract_approved'];
}

export async function acceptConditionRisk(ctx: Ctx, id: string, adminId: string | null): Promise<string[]> {
  const c = await getContractRow(ctx, id, true);
  if (c.locked) return ['contract_locked'];
  await ctx.db.query('UPDATE contracts SET condition_risk_accepted_by = $2 WHERE id = $1', [id, adminId]);
  const out = ['condition_risk_accepted'];
  if (c.status === 'clean') {
    await requestContractApproval(ctx, id);
    out.push('contract_approval_requested');
  }
  return out;
}

export async function signContract(ctx: Ctx, id: string, input: { signedBy: string; scanFileName?: string }): Promise<Contract> {
  const user = requireUser(ctx);
  // §6: contract signature is FORBIDDEN for AI — only a human actor path can reach this
  if (ctx.actor.type !== 'user') assertAiMayExecute('contract_signature');
  if (!(user.role === 'admin' || user.canSign || roleCan(user.role, 'sign_contract'))) throw forbidden('Sözleşme imza kaydı yetkiniz yok', 'SIGN_FORBIDDEN');
  const signer = (await ctx.db.query('SELECT * FROM users WHERE id = $1 AND active', [input.signedBy])).rows[0];
  if (!signer) throw notFound('İmzalayan kullanıcı');
  if (!(signer.role === 'admin' || signer.can_sign)) throw forbidden('Bu kişi imza yetkilisi değil (kurucular + yetkilendirilmiş ekip)', 'NOT_SIGNATORY');
  const c = await getContractRow(ctx, id, true);
  if (c.locked) throw conflict('Sözleşme zaten imzalı', 'CONTRACT_LOCKED');
  if (c.status !== 'approved') throw conflict('İmza için yönetici onayı gerekli (sözleşme temiz ve onaylı olmalı)', 'CONTRACT_NOT_APPROVED');
  if (Number(c.condition_risk_eur ?? 0) > 0 && !c.condition_risk_accepted_by) throw conflict('Koşul riski yönetici tarafından kabul edilmedi', 'CONDITION_RISK_OPEN');
  const supplier = (await ctx.db.query('SELECT * FROM suppliers WHERE id = $1', [c.supplier_id])).rows[0];
  if (supplier.status !== 'accredited') throw conflict('Tedarikçi akredite değil', 'SUPPLIER_NOT_ACCREDITED');
  const now = ctx.now();
  await ctx.db.query(
    `UPDATE contracts SET status = 'signed', locked = true, signed_at = $2, signed_by = $3, scan_file_name = $4 WHERE id = $1`,
    [id, now, input.signedBy, input.scanFileName ?? null]);

  // §7 Adım 5 taahhüt kaydı: payable (supplier) + receivable (customer) at commitment time — finance does not wait for invoices
  const p = await getProjectRow(ctx, c.project_id);
  const customer = p.customer_id ? mapCustomer((await ctx.db.query('SELECT * FROM customers WHERE id = $1', [p.customer_id])).rows[0]) : null;
  const snap = await quoteSnapshot(ctx, c.project_id, c.supplier_id, c.service_item_ids);
  const fx = await currentFx(ctx.db);
  const fields = c.fields as ContractFields;
  const supCur = (fields.currency ?? snap.supplierCurrency) as Currency;
  const supTotal = fields.totalAmount ?? snap.supplierTotal;
  const prepay = fields.prepaymentRate ?? snap.prepaymentRate ?? 0;
  const today = isoDate(now);
  const eventDate = p.start_date ?? today;
  const entries: { kind: 'payable' | 'receivable'; amount: number; currency: Currency; due: string; part: string }[] = [];
  if (prepay > 0) {
    entries.push({ kind: 'payable', amount: supTotal * prepay, currency: supCur, due: addDaysIso(today, 7), part: 'prepayment' });
    entries.push({ kind: 'payable', amount: supTotal * (1 - prepay), currency: supCur, due: eventDate, part: 'balance' });
  } else {
    entries.push({ kind: 'payable', amount: supTotal, currency: supCur, due: eventDate, part: 'full' });
  }
  const deposit = customer?.rules.depositRate ?? 0;
  if (deposit > 0) {
    entries.push({ kind: 'receivable', amount: snap.customerTotalQuoteCurrency * deposit, currency: snap.quoteCurrency, due: addDaysIso(today, 7), part: 'deposit' });
    entries.push({ kind: 'receivable', amount: snap.customerTotalQuoteCurrency * (1 - deposit), currency: snap.quoteCurrency, due: eventDate, part: 'balance' });
  } else {
    entries.push({ kind: 'receivable', amount: snap.customerTotalQuoteCurrency, currency: snap.quoteCurrency, due: eventDate, part: 'full' });
  }
  for (const e of entries) {
    const amount = Math.round(e.amount * 100) / 100;
    await ctx.db.query(
      `INSERT INTO finance_entries (tenant_id, project_id, supplier_id, contract_id, kind, amount, currency, fx_rate, amount_eur, due_date, status, reference, meta, created_by)
       VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,$11,$12)`,
      [p.id, e.kind === 'payable' ? c.supplier_id : null, id, e.kind, amount, e.currency, fx.rates[e.currency], Math.round(toEur(fx, amount, e.currency) * 100) / 100,
        e.due, `${p.code}`, JSON.stringify({ part: e.part, serviceItemIds: c.service_item_ids, source: 'contract_signature' }), user.id],
    );
  }
  for (const itemId of c.service_item_ids as string[]) {
    await ctx.db.query(
      `INSERT INTO reservations (tenant_id, project_id, service_item_id, supplier_id, contract_id, status) VALUES (app_tenant_id(), $1,$2,$3,$4,'pending')`,
      [p.id, itemId, c.supplier_id, id]);
  }
  // supplier confirmation: DRAFT only — a human with 'confirm_supplier' sends it (§6: AI may never confirm)
  await aiDraft(ctx, {
    kind: 'supplier_confirmation', language: 'tr', recipientName: supplier.contact_name ?? supplier.name,
    facts: { projectCode: await supplierRef(ctx, p.code), fields: { startDate: fields.startDate, endDate: fields.endDate, pax: fields.pax, rooms: fields.rooms, totalAmount: supTotal, currency: supCur } },
  }, { projectId: p.id, to: supplier.email, status: 'draft', requiresApproval: false, fromUserId: p.owner_id ?? user.id, entityType: 'contract', entityId: id });

  const pending = (await ctx.db.query(
    `SELECT count(*)::int AS n FROM contracts WHERE project_id = $1 AND superseded_by IS NULL AND status <> 'signed'`, [p.id])).rows[0].n;
  await setStep(ctx, p.id, pending === 0 ? 6 : 5);
  return mapContract(await getContractRow(ctx, id));
}

/** Human sent the supplier confirmation draft → reservations confirmed, items confirmed. */
export async function onSupplierConfirmationSent(ctx: Ctx, contractId: string): Promise<void> {
  const user = requireUser(ctx);
  await ctx.db.query(
    `UPDATE reservations SET status = 'confirmed', confirmed_at = $2, confirmed_by = $3 WHERE contract_id = $1 AND status = 'pending'`,
    [contractId, ctx.now(), user.id]);
  await ctx.db.query(
    `UPDATE service_items SET status = 'confirmed' WHERE id = ANY((SELECT service_item_ids FROM contracts WHERE id = $1)::uuid[])`, [contractId]);
}

/** Ek protokol: a signed contract is never edited; an amendment row is created and triggers the change flow (§7 Adım 6). */
export async function amendContract(ctx: Ctx, id: string, input: { changes: Partial<ContractFields>; reason: string }): Promise<Contract> {
  const user = requireUser(ctx);
  if (!input.reason?.trim()) throw badRequest('Ek protokol gerekçesi zorunludur', undefined, 'REASON_REQUIRED');
  const c = await getContractRow(ctx, id, true);
  if (!c.locked || c.status !== 'signed') throw conflict('Yalnızca imzalı sözleşmeye ek protokol yapılır; taslağı düzenleyin', 'CONTRACT_NOT_SIGNED');
  const fields = { ...(c.fields as ContractFields), ...input.changes };
  const row = (await ctx.db.query(
    `INSERT INTO contracts (tenant_id, project_id, supplier_id, quote_id, service_item_ids, version, template, status, fields, amendment_of, amendment_reason, created_by)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10) RETURNING *`,
    [c.project_id, c.supplier_id, c.quote_id, c.service_item_ids, c.version + 1, c.template, JSON.stringify(fields), id, input.reason, user.id],
  )).rows[0];
  await ctx.db.query(`UPDATE contracts SET status = 'amended', superseded_by = $2 WHERE id = $1`, [id, row.id]);
  // change flow: cost/sale/margin impact
  const rules = await ctx.rules();
  const fx = await currentFx(ctx.db);
  const oldF = c.fields as ContractFields;
  const before = oldF.totalAmount != null && oldF.currency ? toEur(fx, oldF.totalAmount, oldF.currency) : 0;
  const after = fields.totalAmount != null && fields.currency ? toEur(fx, fields.totalAmount, fields.currency) : before;
  // sale = NET (ex VAT / accommodation tax) sale of the contract's items in the accepted option — same basis as the supplier
  // contract total, so margin (Kâr÷Satış) is not overstated by the VAT inside the receivable
  const sale = (await ctx.db.query(
    `SELECT COALESCE(sum(ql.unit_price_eur * ql.quantity * GREATEST(COALESCE(ql.nights, 1), 1)), 0) AS s FROM quote_lines ql JOIN quotes q ON q.id = ql.quote_id
      WHERE q.id = $1 AND ql.option_no = q.accepted_option_no AND ql.service_item_id = ANY($2::uuid[])`, [c.quote_id, c.service_item_ids])).rows[0].s;
  const impact = changeImpact({ costEur: before, saleEur: Number(sale) }, { costEur: after, saleEur: Number(sale) }, rules.targetMarginMin);
  const p = await getProjectRow(ctx, c.project_id);
  await ctx.db.query(
    `INSERT INTO tasks (tenant_id, project_id, assignee_id, kind, title, source, origin_key, entity_type, entity_id)
     VALUES (app_tenant_id(), $1, $2, 'change_flow', $3, 'rule', $4, 'contract', $5) ON CONFLICT (tenant_id, origin_key) DO NOTHING`,
    [p.id, p.owner_id, `${p.code}: ek protokol (${input.reason}) — maliyet farkı ${Math.round(impact.deltaCostEur)} EUR, yeni marj %${Math.round(impact.newMargin * 100)}; müşteriye yansıtma kararı`, `contract:${row.id}:change_flow`, row.id]);
  if (impact.belowTarget) {
    await createDecision(ctx, {
      projectId: p.id, kind: 'condition_risk', badge: 'critical', urgent: true,
      summary: `${p.code}: ek protokol sonrası marj hedefin altına düştü (%${Math.round(impact.newMargin * 100)})`,
      detail: { contractId: row.id, amendmentOf: id, impact, reason: input.reason }, requiredRole: 'admin', entityType: 'contract', entityId: row.id,
      primaryActionLabel: 'Gördüm',
    });
  }
  return mapContract(row);
}

export async function listContracts(ctx: Ctx, projectId: string): Promise<Contract[]> {
  const { rows } = await ctx.db.query('SELECT * FROM contracts WHERE project_id = $1 ORDER BY created_at', [projectId]);
  return rows.map(mapContract);
}
