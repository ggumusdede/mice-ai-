// §7 Adım 7 Fatura, ödeme ve tahsilat (onay kapısı). Supplier invoices are read (AI) and linked to project / contract items
// with an amount-mismatch alarm; every payment request goes to the admin individually with Face ID; the system NEVER moves
// money (§6) — a human marks a payment as paid. Bank statement upload → matching (high confidence automatic, low confidence
// as an AI suggestion through aiGate), unmatched outgoing payments → daily reminder + 7-day escalation (worker).
import { createHash, randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { BankTransaction, Currency, FinanceEntry, SupplierInvoiceInput } from '@mice/shared';
import { matchBankTransaction, parseBankCsv, roleCan, slugTr } from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { isoDate } from '../lib/dates.js';
import { mapFinance, type Row } from '../lib/mappers.js';
import { logAiAction, recordCorrection } from './ai-log.js';
import { aiGate } from './automation.js';
import { createDecision, expireDecisionsFor } from './decisions.js';
import { currentFx, rateFor, toEur } from './fx.js';
import { fileToAiInput, xlsxToCsv, type UploadedFile } from './offers.js';
import { getProjectRow } from './projects.js';
import { notify } from './notifications.js';
import { applyUblInvoice, isUblUpload, summary as ublSummary, type UblApplied } from './einvoice.js';

const r2 = (n: number) => Math.round(n * 100) / 100;
export const MAX_BANK_ROWS = 5000;

function assertFinance(ctx: Ctx): void {
  const u = requireUser(ctx);
  if (!roleCan(u.role, 'match_invoices') && u.role !== 'admin') throw forbidden('Bu işlem finans yetkisi gerektirir', 'FORBIDDEN');
}

export async function listEntries(ctx: Ctx, f: { projectId?: string; kind?: string; status?: string }): Promise<FinanceEntry[]> {
  const { rows } = await ctx.db.query(
    `SELECT * FROM finance_entries WHERE ($1::uuid IS NULL OR project_id = $1) AND ($2::text IS NULL OR kind = $2) AND ($3::text IS NULL OR status = $3)
     ORDER BY due_date NULLS LAST, created_at LIMIT 1000`, [f.projectId ?? null, f.kind ?? null, f.status ?? null]);
  return rows.map(mapFinance);
}

async function getEntry(ctx: Ctx, id: string, forUpdate = false): Promise<Row> {
  const r = (await ctx.db.query(`SELECT * FROM finance_entries WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id])).rows[0];
  if (!r) throw notFound('Finans kaydı');
  return r;
}

// ------------------------------------------------------------------ supplier invoices
export interface InvoiceRequest extends Partial<SupplierInvoiceInput> { text?: string; file?: UploadedFile }

/** `amount` = invoice NET amount (matrah, VAT excluded); `vatAmount` separate. Compared with the contract payable total. */
export async function recordSupplierInvoice(ctx: Ctx, input: InvoiceRequest): Promise<{ entry: FinanceEntry; alarms: string[] }> {
  assertFinance(ctx);
  const user = requireUser(ctx);
  const rules = await ctx.rules();
  const alarms: string[] = [];
  const data: Partial<SupplierInvoiceInput> = { ...input };
  let readConfidence: number | null = null;
  let aiActionId: string | null = null;
  // e-Fatura UBL-TR XML: deterministic reader, no AI (confidence 1.0) — services/einvoice.ts
  let ubl: UblApplied | null = null;
  if (isUblUpload(input.file)) {
    ubl = await applyUblInvoice(ctx, input.file!, data);
    readConfidence = 1;
    alarms.push(...ubl.alarms);
  } else if (input.file || input.text) {
    let text = input.text;
    let file;
    if (input.file) {
      const conv = await fileToAiInput(input.file);
      text = conv.text ?? text;
      file = conv.file;
    }
    const r = await ctx.deps.ai.parseInvoice({ text, file, today: isoDate(ctx.now()) });
    aiActionId = await logAiAction(ctx, { actionType: 'document_reading', result: r, projectId: input.projectId ?? null, inputSummary: { kind: 'supplier_invoice', fileName: input.file?.filename ?? null } });
    readConfidence = r.confidence;
    const d = r.data;
    data.invoiceNo ??= d.invoiceNo ?? undefined;
    data.currency ??= d.currency ?? undefined;
    data.vatAmount ??= d.vatAmount ?? undefined;
    data.amount ??= d.netAmount ?? (d.totalAmount != null && d.vatAmount != null ? r2(d.totalAmount - d.vatAmount) : d.totalAmount) ?? undefined;
    data.issueDate ??= d.issueDate ?? undefined;
    data.dueDate ??= d.dueDate ?? undefined;
    if (!data.supplierId && d.supplierName) {
      const s = (await ctx.db.query(`SELECT id FROM suppliers WHERE lower(name) = lower($1) LIMIT 1`, [d.supplierName])).rows[0];
      if (s) data.supplierId = s.id;
    }
    if (r.confidence < rules.aiConfidenceThreshold) alarms.push(`Fatura okuma güveni düşük (%${Math.round(r.confidence * 100)}) — alanları kontrol edin`);
  }
  if (!data.projectId || !data.supplierId) throw badRequest('Proje ve tedarikçi gerekli', undefined, 'INVOICE_LINK_REQUIRED');
  if (!data.invoiceNo || data.amount == null || !data.currency) throw badRequest('Fatura no, tutar ve para birimi gerekli (okunamadıysa elle girin)', { read: data }, 'INVOICE_FIELDS_MISSING');
  const p = await getProjectRow(ctx, data.projectId);
  const supplier = (await ctx.db.query('SELECT * FROM suppliers WHERE id = $1', [data.supplierId])).rows[0];
  if (!supplier) throw notFound('Tedarikçi');
  const dup = (await ctx.db.query(`SELECT id FROM finance_entries WHERE kind = 'supplier_invoice' AND supplier_id = $1 AND invoice_no = $2 AND status <> 'cancelled'`, [supplier.id, data.invoiceNo])).rows[0];
  if (dup) throw conflict(`Bu fatura zaten kayıtlı (${data.invoiceNo})`, 'DUPLICATE_INVOICE');
  const fx = await currentFx(ctx.db);
  const currency = data.currency as Currency;
  const amountEur = r2(toEur(fx, data.amount, currency));

  // link: signed (latest) contract(s) of this supplier in the project, the service items and the open payables
  const contracts = (await ctx.db.query(
    `SELECT * FROM contracts WHERE project_id = $1 AND supplier_id = $2 AND superseded_by IS NULL AND status IN ('signed','amended') ORDER BY created_at DESC`,
    [p.id, supplier.id])).rows;
  const contract = contracts[0] ?? null;
  let itemIds = data.serviceItemIds?.length ? data.serviceItemIds : (contract?.service_item_ids ?? []);
  if (data.serviceItemIds?.length) {
    const ok = (await ctx.db.query('SELECT id FROM service_items WHERE id = ANY($1) AND project_id = $2', [data.serviceItemIds, p.id])).rows;
    if (ok.length !== new Set(data.serviceItemIds).size) throw badRequest('Kalemler bu projeye ait değil', undefined, 'INVALID_ITEM');
    itemIds = data.serviceItemIds;
  }
  const payables = (await ctx.db.query(
    `SELECT * FROM finance_entries WHERE project_id = $1 AND supplier_id = $2 AND kind = 'payable' AND status <> 'cancelled'`, [p.id, supplier.id])).rows;
  const expectedEur = payables.length ? r2(payables.reduce((s, e) => s + Number(e.amount_eur), 0)) : null;
  const prevInvoicedEur = Number((await ctx.db.query(
    `SELECT COALESCE(sum(amount_eur), 0) AS s FROM finance_entries WHERE project_id = $1 AND supplier_id = $2 AND kind = 'supplier_invoice' AND status <> 'cancelled'`, [p.id, supplier.id])).rows[0].s);
  let mismatch = false;
  if (!contract) {
    alarms.push(`${supplier.name} için imzalı sözleşme yok — fatura sözleşme kalemine bağlanamadı`);
    mismatch = true;
  } else if (expectedEur != null) {
    const invoicedTotal = prevInvoicedEur + amountEur;
    const diff = r2(invoicedTotal - expectedEur);
    const tol = Math.max(1, expectedEur * 0.005);
    if (Math.abs(diff) > tol) {
      mismatch = true;
      alarms.push(`Tutar farkı: faturalanan ${r2(invoicedTotal)} EUR, sözleşme/borç ${expectedEur} EUR (fark ${diff > 0 ? '+' : ''}${diff} EUR)`);
    }
  }
  if (contract && (contract.fields?.currency ?? null) && contract.fields.currency !== currency) alarms.push(`Para birimi farklı: sözleşme ${contract.fields.currency}, fatura ${currency}`);

  const row = (await ctx.db.query(
    `INSERT INTO finance_entries (tenant_id, project_id, service_item_id, supplier_id, contract_id, kind, amount, currency, fx_rate, amount_eur, due_date, status,
       reference, invoice_no, meta, created_by)
     VALUES (app_tenant_id(), $1,$2,$3,$4,'supplier_invoice',$5,$6,$7,$8,$9,'open',$10,$11,$12,$13) RETURNING *`,
    [p.id, itemIds[0] ?? null, supplier.id, contract?.id ?? null, data.amount, currency, rateFor(fx, currency), amountEur, data.dueDate ?? null, p.code, data.invoiceNo,
      JSON.stringify({ vatAmount: data.vatAmount ?? null, issueDate: data.issueDate ?? isoDate(ctx.now()), serviceItemIds: itemIds, expectedEur, mismatch, alarms,
        readConfidence, aiActionId, payableIds: payables.map((e) => e.id), source: ubl ? 'ubl_xml' : input.file ? 'file' : input.text ? 'text' : 'manual',
        ...(ubl ? { ubl: ublSummary(ubl.ubl) } : {}) }),
      user.id])).rows[0];
  if (ubl?.ubl.uuid) await ctx.db.query('UPDATE finance_entries SET ubl_uuid = $2 WHERE id = $1', [row.id, ubl.ubl.uuid]);
  if (aiActionId) await ctx.db.query('UPDATE ai_actions SET entity_type = $2, entity_id = $3 WHERE id = $1', [aiActionId, 'finance_entry', row.id]);

  // separately billed supplier commission (§7 Adım 7 komisyon mutabakatı): expected commission receivable
  const com = supplier.commission as { rate?: number; vatIncluded?: boolean; billedSeparately?: boolean } | null;
  if (com?.billedSeparately && com.rate && com.rate > 0) {
    const commission = r2(data.amount * com.rate);
    await ctx.db.query(
      `INSERT INTO finance_entries (tenant_id, project_id, supplier_id, contract_id, kind, amount, currency, fx_rate, amount_eur, status, reference, invoice_no, meta, created_by)
       VALUES (app_tenant_id(), $1,$2,$3,'commission',$4,$5,$6,$7,'open',$8,NULL,$9,$10)`,
      [p.id, supplier.id, contract?.id ?? null, commission, currency, rateFor(fx, currency), r2(toEur(fx, commission, currency)), p.code,
        JSON.stringify({ rate: com.rate, vatIncluded: com.vatIncluded ?? false, vatNote: com.vatIncluded ? 'KDV dahil' : 'KDV ayrı', baseInvoiceId: row.id, baseAmount: data.amount }), user.id]);
  }

  if (mismatch || alarms.length) {
    await ctx.db.query(
      `INSERT INTO tasks (tenant_id, project_id, assignee_id, kind, title, due_at, source, origin_key, entity_type, entity_id)
       VALUES (app_tenant_id(), $1,$2,'invoice_mismatch',$3,$4,'ai',$5,'finance_entry',$6) ON CONFLICT (tenant_id, origin_key) DO NOTHING`,
      [p.id, user.id, `${p.code}: ${supplier.name} faturası ${data.invoiceNo} — ${alarms[0]}`, ctx.now(), `invoice:${row.id}:alarm`, row.id]);
    await logAiAction(ctx, { actionType: 'internal_alarm_task', projectId: p.id, entityType: 'finance_entry', entityId: row.id, result: { confidence: 1, model: 'rules', data: { alarms } } });
    if (mismatch) await notify(ctx, { roles: ['admin'], priority: 'routine', title: `${p.code}: fatura tutar farkı — ${supplier.name} ${data.invoiceNo}`, body: alarms.join('\n'), projectId: p.id, entityType: 'finance_entry', entityId: row.id });
  }
  return { entry: mapFinance(row), alarms };
}

// ------------------------------------------------------------------ customer invoice (issued in Mikro; recorded here)
export async function recordCustomerInvoice(ctx: Ctx, input: { projectId: string; invoiceNo: string; amount: number; currency: Currency; vatAmount?: number; issueDate?: string; dueDate?: string }): Promise<FinanceEntry> {
  assertFinance(ctx);
  const p = await getProjectRow(ctx, input.projectId);
  const fx = await currentFx(ctx.db);
  const row = (await ctx.db.query(
    `INSERT INTO finance_entries (tenant_id, project_id, kind, amount, currency, fx_rate, amount_eur, due_date, status, reference, invoice_no, meta, created_by)
     VALUES (app_tenant_id(), $1,'customer_invoice',$2,$3,$4,$5,$6,'open',$7,$8,$9,$10) RETURNING *`,
    [p.id, input.amount, input.currency, rateFor(fx, input.currency), r2(toEur(fx, input.amount, input.currency)), input.dueDate ?? null, p.code, input.invoiceNo,
      JSON.stringify({ vatAmount: input.vatAmount ?? null, issueDate: input.issueDate ?? isoDate(ctx.now()), customerId: p.customer_id }), ctx.user!.id])).rows[0];
  return mapFinance(row);
}

// ------------------------------------------------------------------ payment requests (finance creates, admin approves EACH one)
export async function createPaymentRequest(ctx: Ctx, entryId: string): Promise<FinanceEntry> {
  const user = requireUser(ctx);
  if (!roleCan(user.role, 'create_payment_request')) throw forbidden('Ödeme talebini finans oluşturur', 'FORBIDDEN');
  const e = await getEntry(ctx, entryId, true);
  if (!['payable', 'supplier_invoice'].includes(e.kind)) throw badRequest('Yalnızca tedarikçi borcu / faturası için ödeme talebi açılır', undefined, 'NOT_PAYABLE');
  if (e.status !== 'open') throw conflict(`Kayıt durumu uygun değil: ${e.status}`, 'ENTRY_NOT_OPEN');
  const p = e.project_id ? await getProjectRow(ctx, e.project_id) : null;
  const supplier = e.supplier_id ? (await ctx.db.query('SELECT name FROM suppliers WHERE id = $1', [e.supplier_id])).rows[0] : null;
  const daysToDue = e.due_date ? (Date.parse(e.due_date) - Date.parse(isoDate(ctx.now()))) / 86_400_000 : null;
  const urgent = daysToDue != null && daysToDue <= 2;
  const d = await createDecision(ctx, {
    projectId: e.project_id, kind: 'payment_approval', badge: urgent ? 'critical' : 'within_rules', urgent,
    summary: `${p?.code ?? ''}: ödeme onayı — ${supplier?.name ?? ''} ${Number(e.amount).toLocaleString('tr-TR')} ${e.currency}${e.due_date ? ` (vade ${e.due_date})` : ''}`,
    detail: { entryId: e.id, kind: e.kind, amount: Number(e.amount), currency: e.currency, amountEur: Number(e.amount_eur), dueDate: e.due_date, invoiceNo: e.invoice_no, supplier: supplier?.name ?? null, requestedBy: user.fullName, part: e.meta?.part ?? null },
    aiNote: 'Onay ödemeyi yapmaz: ödeme bankada insan tarafından yapılır ve "ödendi" olarak işaretlenir (§6).',
    requiredRole: 'admin', requiresBiometric: true, entityType: 'finance_entry', entityId: e.id,
  });
  const row = (await ctx.db.query(
    `UPDATE finance_entries SET status = 'pending_approval', payment_decision_id = $2, requested_by = $3, requested_at = $4 WHERE id = $1 RETURNING *`,
    [e.id, d.id, user.id, ctx.now()])).rows[0];
  return mapFinance(row);
}

/** Decision effect: approve → entry 'approved' (never moves money); reject → back to 'open'. AI can never run this. */
export async function paymentDecisionEffect(ctx: Ctx, entryId: string, action: 'approve' | 'edit' | 'reject', decidedBy: string | null, auto?: boolean): Promise<string[]> {
  if (auto || !decidedBy || ctx.actor.type !== 'user') throw forbidden('Ödeme onayı yapay zekâ tarafından verilemez (§6 money_movement)', 'AI_FORBIDDEN_ACTION');
  const e = await getEntry(ctx, entryId, true);
  if (action === 'reject') {
    await ctx.db.query(`UPDATE finance_entries SET status = 'open', payment_decision_id = NULL WHERE id = $1 AND status = 'pending_approval'`, [entryId]);
    if (e.requested_by) await notify(ctx, { userIds: [e.requested_by], priority: 'routine', title: `Ödeme talebi reddedildi: ${e.invoice_no ?? e.reference ?? ''} ${e.amount} ${e.currency}`, projectId: e.project_id, entityType: 'finance_entry', entityId: entryId });
    return ['payment_rejected'];
  }
  // §17.1 "Finance ödeme talebi oluşturur, onaylamaz": four-eyes — a delegate never approves a payment they requested
  if (e.requested_by && e.requested_by === decidedBy && ctx.user?.role !== 'admin') {
    throw forbidden('Kendi oluşturduğunuz ödeme talebini onaylayamazsınız (dört göz ilkesi)', 'SELF_APPROVAL_FORBIDDEN');
  }
  if (e.status !== 'pending_approval') return [`payment_not_pending:${e.status}`];
  await ctx.db.query(`UPDATE finance_entries SET status = 'approved', approved_by = $2, approved_at = $3 WHERE id = $1`, [entryId, decidedBy, ctx.now()]);
  if (e.requested_by) await notify(ctx, { userIds: [e.requested_by], priority: 'critical', title: `Ödeme onaylandı — bankadan ödeyip "ödendi" işaretleyin: ${e.amount} ${e.currency}`, projectId: e.project_id, entityType: 'finance_entry', entityId: entryId });
  return ['payment_approved'];
}

/** A human records that the approved payment was made (the system itself never pays). */
export async function markPaid(ctx: Ctx, entryId: string, input: { paidAt?: string; reference?: string }): Promise<FinanceEntry> {
  const user = requireUser(ctx);
  if (!roleCan(user.role, 'create_payment_request')) throw forbidden('Ödeme kaydını finans / yönetici girer', 'FORBIDDEN');
  const e = await getEntry(ctx, entryId, true);
  if (e.status !== 'approved') throw conflict('Yalnızca onaylı ödeme "ödendi" işaretlenebilir (önce yönetici onayı)', 'PAYMENT_NOT_APPROVED');
  const row = (await ctx.db.query(
    `UPDATE finance_entries SET status = 'paid', paid_by = $2, paid_at = $3, meta = meta || $4 WHERE id = $1 RETURNING *`,
    [entryId, user.id, input.paidAt ? new Date(input.paidAt) : ctx.now(), JSON.stringify({ paymentReference: input.reference ?? null })])).rows[0];
  return mapFinance(row);
}

// ------------------------------------------------------------------ bank statements
function mapTx(r: Row): BankTransaction {
  return {
    id: r.id, tenantId: r.tenant_id, bookedAt: r.booked_at, amount: Number(r.amount), currency: r.currency, description: r.description,
    counterparty: r.counterparty, matchedEntryId: r.matched_entry_id, matchConfidence: r.match_confidence != null ? Number(r.match_confidence) : null,
    status: r.status, payerUserId: r.payer_user_id,
  };
}

export async function listBankTransactions(ctx: Ctx, status?: string): Promise<BankTransaction[]> {
  const { rows } = await ctx.db.query(`SELECT * FROM bank_transactions WHERE ($1::text IS NULL OR status = $1) ORDER BY booked_at DESC, created_at DESC LIMIT 1000`, [status ?? null]);
  return rows.map(mapTx);
}

const OUT_KINDS = ['payable', 'supplier_invoice'];
const IN_KINDS = ['receivable', 'customer_invoice', 'commission'];

async function matchCandidates(ctx: Ctx) {
  const { rows } = await ctx.db.query(
    `SELECT e.*, s.name AS supplier_name, p.customer_name FROM finance_entries e LEFT JOIN suppliers s ON s.id = e.supplier_id LEFT JOIN projects p ON p.id = e.project_id
      WHERE e.status IN ('open','pending_approval','approved','paid') AND e.kind = ANY($1)`, [[...OUT_KINDS, ...IN_KINDS]]);
  return rows.map((e) => ({
    id: e.id as string, amount: Number(e.amount), currency: e.currency as string, reference: e.reference as string | null, invoiceNo: e.invoice_no as string | null,
    counterpartyName: (OUT_KINDS.includes(e.kind) || e.kind === 'commission' ? e.supplier_name : e.customer_name) as string | null,
    dueDate: e.due_date as string | null, direction: (OUT_KINDS.includes(e.kind) ? 'out' : 'in') as 'in' | 'out',
  }));
}

/** Sets the match (tx matched + entry matched). `auto` = high-confidence autonomous match. */
async function applyMatch(ctx: Ctx, txId: string, entryId: string, confidence: number | null): Promise<void> {
  await ctx.db.query(`UPDATE bank_transactions SET status = 'matched', matched_entry_id = $2, match_confidence = $3 WHERE id = $1`, [txId, entryId, confidence]);
  await ctx.db.query(`UPDATE finance_entries SET status = 'matched', matched_bank_transaction_id = $2 WHERE id = $1`, [entryId, txId]);
}

async function bankFileToRows(file: UploadedFile): Promise<ReturnType<typeof parseBankCsv>> {
  const name = file.filename.toLowerCase();
  if (name.endsWith('.xlsx') || file.mimetype.includes('spreadsheetml')) {
    // exceljs → CSV text (first sheet lines prefixed "# sheet" are ignored by the parser) → same Turkish-bank parser
    const csv = (await xlsxToCsv(file.buffer)).split('\n').filter((l) => !l.startsWith('# ')).join('\n');
    return parseBankCsv(csv);
  }
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.mimetype.startsWith('text/') || file.mimetype === 'application/vnd.ms-excel') {
    return parseBankCsv(file.buffer.toString('utf8'));
  }
  throw badRequest('Ekstre CSV veya XLSX olmalı', { mimetype: file.mimetype }, 'UNSUPPORTED_FILE');
}

export async function importBankStatement(ctx: Ctx, file: UploadedFile): Promise<{ imported: number; matched: number; suggested: number; unmatched: number; duplicates: number }> {
  assertFinance(ctx);
  const user = requireUser(ctx);
  const rules = await ctx.rules();
  const rows = await bankFileToRows(file);
  if (!rows.length) throw badRequest('Ekstrede okunabilir hareket bulunamadı', undefined, 'EMPTY_STATEMENT');
  // every row is matched inside ONE transaction: bound the work (DoS) — split larger statements by date range
  if (rows.length > MAX_BANK_ROWS) throw badRequest(`Ekstre en fazla ${MAX_BANK_ROWS} hareket içerebilir (${rows.length}); dönemi bölün`, undefined, 'STATEMENT_TOO_LARGE');
  await logAiAction(ctx, { actionType: 'document_reading', result: { confidence: 1, model: 'parser', data: { rows: rows.length } }, inputSummary: { kind: 'bank_statement', fileName: file.filename } });
  const batch = randomUUID();
  const seen = new Map<string, number>();
  const out = { imported: 0, matched: 0, suggested: 0, unmatched: 0, duplicates: 0 };
  const candidates = await matchCandidates(ctx);
  const taken = new Set<string>();
  for (const t of rows) {
    const base = `${t.bookedAt}|${t.amount}|${t.currency}|${t.description}|${t.counterparty ?? ''}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const hash = createHash('sha256').update(`${base}|${n}`).digest('hex');
    const ins = (await ctx.db.query(
      `INSERT INTO bank_transactions (tenant_id, booked_at, amount, currency, description, counterparty, import_batch_id, row_hash, payer_user_id)
       VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id, row_hash) DO NOTHING RETURNING *`,
      [t.bookedAt, t.amount, t.currency, t.description || '-', t.counterparty, batch, hash, t.amount < 0 ? user.id : null])).rows[0];
    if (!ins) {
      out.duplicates++;
      continue;
    }
    out.imported++;
    const ranked = matchBankTransaction({ amount: t.amount, currency: t.currency, description: t.description, counterparty: t.counterparty, bookedAt: t.bookedAt },
      candidates.filter((c) => !taken.has(c.id)));
    const top = ranked[0];
    if (top && top.confidence >= rules.aiConfidenceThreshold) {
      await applyMatch(ctx, ins.id, top.entryId, top.confidence);
      taken.add(top.entryId);
      await logAiAction(ctx, { actionType: 'comparison', entityType: 'bank_transaction', entityId: ins.id, result: { confidence: top.confidence, model: 'domain', data: { entryId: top.entryId, reasons: top.reasons } } });
      out.matched++;
    } else if (top && top.confidence >= 0.3) {
      await ctx.db.query(`UPDATE bank_transactions SET status = 'suggested', matched_entry_id = $2, match_confidence = $3 WHERE id = $1`, [ins.id, top.entryId, top.confidence]);
      const aiActionId = await logAiAction(ctx, { actionType: 'low_confidence_payment_match', entityType: 'bank_transaction', entityId: ins.id, result: { confidence: top.confidence, model: 'domain', data: { candidates: ranked.slice(0, 3) } } });
      const entry = await getEntry(ctx, top.entryId);
      const gate = await aiGate(ctx, 'low_confidence_payment_match', {
        projectId: entry.project_id, kind: 'low_confidence_review', badge: 'suggestion',
        summary: `Banka hareketi ${t.bookedAt} ${t.amount} ${t.currency} → ${entry.invoice_no ?? entry.reference ?? entry.kind} (güven %${Math.round(top.confidence * 100)})`,
        detail: { type: 'payment_match', bankTransactionId: ins.id, entryId: top.entryId, confidence: top.confidence, reasons: top.reasons, alternatives: ranked.slice(1, 3) },
        aiNote: top.reasons.join(' · '), requiredRole: 'finance', entityType: 'bank_transaction', entityId: ins.id, aiActionId,
        draft: { entryId: top.entryId }, primaryActionLabel: 'Eşleştir',
      });
      if (gate.mode === 'auto') {
        taken.add(top.entryId);
        out.matched++;
      } else out.suggested++;
    } else {
      out.unmatched++;
    }
  }
  return out;
}

/** Decision effect for a low-confidence payment match suggestion. */
export async function paymentMatchEffect(ctx: Ctx, txId: string, suggestedEntryId: string, action: 'approve' | 'edit' | 'reject', edits?: Record<string, unknown>): Promise<string[]> {
  const tx = (await ctx.db.query('SELECT * FROM bank_transactions WHERE id = $1 FOR UPDATE', [txId])).rows[0];
  if (!tx) return ['bank_transaction_missing'];
  if (tx.status === 'matched') return ['already_matched'];
  if (action === 'reject') {
    await ctx.db.query(`UPDATE bank_transactions SET status = 'unmatched', matched_entry_id = NULL, match_confidence = NULL WHERE id = $1`, [txId]);
    return ['payment_match_rejected'];
  }
  const entryId = action === 'edit' && typeof edits?.entryId === 'string' ? edits.entryId : suggestedEntryId;
  await getEntry(ctx, entryId);
  await applyMatch(ctx, txId, entryId, action === 'approve' ? Number(tx.match_confidence) : 1);
  return [`payment_matched:${entryId}`];
}

/** Manual match by a human (correction of an AI suggestion = learning data). */
export async function manualMatch(ctx: Ctx, txId: string, entryId: string): Promise<BankTransaction> {
  assertFinance(ctx);
  const tx = (await ctx.db.query('SELECT * FROM bank_transactions WHERE id = $1 FOR UPDATE', [txId])).rows[0];
  if (!tx) throw notFound('Banka hareketi');
  if (tx.status === 'matched') throw conflict('Hareket zaten eşleşmiş', 'ALREADY_MATCHED');
  const e = await getEntry(ctx, entryId, true);
  if (['matched', 'cancelled'].includes(e.status)) throw conflict('Finans kaydı zaten kapalı', 'ENTRY_CLOSED');
  const dirOut = Number(tx.amount) < 0;
  if (dirOut !== OUT_KINDS.includes(e.kind)) throw badRequest('Yön uyuşmuyor (giden ödeme ↔ tedarikçi; gelen ↔ müşteri/komisyon)', undefined, 'DIRECTION_MISMATCH');
  if (tx.status === 'suggested') {
    const d = (await ctx.db.query(`SELECT * FROM decisions WHERE status = 'open' AND entity_type = 'bank_transaction' AND entity_id = $1`, [txId])).rows[0];
    if (d?.ai_action_id && tx.matched_entry_id !== entryId) await recordCorrection(ctx, d.ai_action_id, { suggested: tx.matched_entry_id, chosen: entryId }, 'edited');
    await expireDecisionsFor(ctx, 'bank_transaction', txId);
  }
  await applyMatch(ctx, txId, entryId, 1);
  await ctx.db.query(`UPDATE tasks SET status = 'done', completed_by = $2, completed_at = $3 WHERE entity_type = 'bank_transaction' AND entity_id = $1 AND status = 'open'`, [txId, ctx.user!.id, ctx.now()]);
  return mapTx((await ctx.db.query('SELECT * FROM bank_transactions WHERE id = $1', [txId])).rows[0]);
}

export async function listCommissions(ctx: Ctx, projectId?: string): Promise<FinanceEntry[]> {
  return listEntries(ctx, { projectId, kind: 'commission' });
}

/** Commission reconciliation: mark a commission as reconciled (status matched) with the supplier's commission invoice no. */
export async function reconcileCommission(ctx: Ctx, entryId: string, input: { invoiceNo?: string; amount?: number }): Promise<FinanceEntry> {
  assertFinance(ctx);
  const e = await getEntry(ctx, entryId, true);
  if (e.kind !== 'commission') throw badRequest('Komisyon kaydı değil', undefined, 'NOT_COMMISSION');
  const row = (await ctx.db.query(
    `UPDATE finance_entries SET status = 'matched', invoice_no = COALESCE($2, invoice_no), meta = meta || $3 WHERE id = $1 RETURNING *`,
    [entryId, input.invoiceNo ?? null, JSON.stringify({ reconciledAmount: input.amount ?? Number(e.amount), reconciledBy: ctx.user!.id, reconciledAt: ctx.now().toISOString(),
      difference: input.amount != null ? r2(input.amount - Number(e.amount)) : 0 })])).rows[0];
  return mapFinance(row);
}

// ------------------------------------------------------------------ Mikro Yazılım export (§17.8)
/**
 * Excel for Mikro (e-portal) import. ASSUMPTIONS (to be confirmed with the accountant / Mikro "Excel'den fatura aktarımı" template):
 *  - one row per invoice; columns: Evrak Tipi, Cari Kod, Cari Ünvan, Belge No, Tarih (GG.AA.YYYY), Vade, Tutar (matrah, KDV hariç),
 *    KDV, Toplam, Döviz, Kur (1 EUR = kur), Açıklama;
 *  - cari kod: customers 120.<shortCode>, suppliers 320.<SUPPLIERSLUG(12)> (TDHP alıcılar / satıcılar);
 *  - supplier invoices = "Alış Faturası", customer invoices = "Satış Faturası", commission invoices = "Satış Faturası (komisyon)";
 *  - date filter on the invoice date (meta.issueDate, else created_at); rows sorted newest → oldest (ürün sahibi kararı).
 */
export async function mikroExport(ctx: Ctx, from?: string, to?: string): Promise<{ fileName: string; data: Buffer; rows: number }> {
  assertFinance(ctx);
  const { rows } = await ctx.db.query(
    `SELECT e.*, s.name AS supplier_name, c.name AS customer_name, c.short_code, p.code AS project_code
       FROM finance_entries e LEFT JOIN suppliers s ON s.id = e.supplier_id LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN customers c ON c.id = p.customer_id
      WHERE e.kind IN ('supplier_invoice','customer_invoice','commission') AND e.status <> 'cancelled' AND e.invoice_no IS NOT NULL
        AND ($1::date IS NULL OR COALESCE((e.meta->>'issueDate')::date, e.created_at::date) >= $1::date)
        AND ($2::date IS NULL OR COALESCE((e.meta->>'issueDate')::date, e.created_at::date) <= $2::date)
      ORDER BY COALESCE((e.meta->>'issueDate')::date, e.created_at::date) DESC, e.created_at DESC, e.invoice_no /* ürün sahibi kararı v0.4 S-Q3: yeniden eskiye */`, [from ?? null, to ?? null]);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MICE AI Operations OS';
  const ws = wb.addWorksheet('Mikro Aktarım');
  ws.columns = [
    { header: 'Evrak Tipi', key: 'type', width: 22 }, { header: 'Cari Kod', key: 'cari', width: 22 }, { header: 'Cari Ünvan', key: 'unvan', width: 32 },
    { header: 'Belge No', key: 'no', width: 18 }, { header: 'Tarih', key: 'date', width: 12 }, { header: 'Vade', key: 'due', width: 12 },
    { header: 'Tutar', key: 'net', width: 14 }, { header: 'KDV', key: 'vat', width: 12 }, { header: 'Toplam', key: 'total', width: 14 },
    { header: 'Döviz', key: 'cur', width: 8 }, { header: 'Kur', key: 'rate', width: 10 }, { header: 'Açıklama', key: 'desc', width: 40 },
  ];
  const dmy = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');
  for (const e of rows) {
    const issue = e.meta?.issueDate ?? isoDate(new Date(e.created_at));
    const vat = e.meta?.vatAmount != null ? Number(e.meta.vatAmount) : 0;
    const isSupplier = e.kind === 'supplier_invoice';
    const cari = isSupplier ? `320.${slugTr(e.supplier_name ?? '').slice(0, 12)}` : e.kind === 'commission' ? `120.K.${slugTr(e.supplier_name ?? '').slice(0, 10)}` : `120.${e.short_code ?? 'MUSTERI'}`;
    ws.addRow({
      type: isSupplier ? 'Alış Faturası' : e.kind === 'commission' ? 'Satış Faturası (komisyon)' : 'Satış Faturası',
      cari, unvan: isSupplier || e.kind === 'commission' ? e.supplier_name : e.customer_name, no: e.invoice_no, date: dmy(issue), due: dmy(e.due_date),
      net: Number(e.amount), vat, total: r2(Number(e.amount) + vat), cur: e.currency, rate: e.fx_rate != null ? Number(e.fx_rate) : null,
      desc: `${e.project_code ?? ''} ${isSupplier ? 'tedarikçi faturası' : e.kind === 'commission' ? 'komisyon' : 'müşteri faturası'}`.trim(),
    });
  }
  ws.getRow(1).font = { bold: true };
  const data = Buffer.from(await wb.xlsx.writeBuffer());
  return { fileName: `mikro-aktarim-${from ?? 'baslangic'}-${to ?? isoDate(ctx.now())}.xlsx`, data, rows: rows.length };
}

// ------------------------------------------------------------------ worker: unbilled payments
/** Unbilled payment reminder to the payer as a push (in addition to the worker's daily task). */
export async function notifyUnbilledPayment(ctx: Ctx, txId: string, userId: string | null): Promise<void> {
  if (!userId) return;
  const t = (await ctx.db.query('SELECT * FROM bank_transactions WHERE id = $1', [txId])).rows[0];
  if (!t) return;
  await notify(ctx, { userIds: [userId], priority: 'routine', title: `Bu ödeme nereye fatura edildi? ${t.booked_at} ${t.amount} ${t.currency} — ${t.description}`, entityType: 'bank_transaction', entityId: txId });
}
