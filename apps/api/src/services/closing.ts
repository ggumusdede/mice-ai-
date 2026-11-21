// §7 Adım 8 Kapanış ve öğrenme: closing check (blocks closing), plan vs actual with deviation reasons, realized prices →
// price history, supplier performance score (low → admin warning), "neyi geç öğrendik?" → checklist question suggestions,
// 3-question customer survey. Also the customer invoice DRAFT document (contract + approved extras; accounting issues it in Mikro).
import type { ClosingCheck, OfferLine, Project, ProfitSummary, PublicSurveySubmit, PublicSurveyView } from '@mice/shared';
import { closingCheck, lineMultiplier, profitSummary, splitLine, supplierScore } from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { isoDate } from '../lib/dates.js';
import { newPublicToken } from '../lib/crypto.js';
import { mapProject, type Row } from '../lib/mappers.js';
import { logAiAction } from './ai-log.js';
import { aiGate } from './automation.js';
import { createDecision } from './decisions.js';
import { registerDocumentGenerator } from './documents.js';
import { currentFx, toEur } from './fx.js';
import { getProjectRow } from './projects.js';
import { loadQuotes } from './quotes.js';
import { money, pct, renderPdf } from './pdf.js';

const r2 = (n: number) => Math.round(n * 100) / 100;

async function plannedProfit(ctx: Ctx, projectId: string): Promise<ProfitSummary | null> {
  const quotes = await loadQuotes(ctx, { projectId });
  const q = quotes.find((x) => x.status === 'accepted' && x.acceptedOptionNo != null);
  if (!q) return null;
  return q.options.find((o) => o.optionNo === q.acceptedOptionNo)?.totals ?? null;
}

async function actualProfit(ctx: Ctx, projectId: string): Promise<ProfitSummary | null> {
  const fin = (await ctx.db.query(
    `SELECT kind, sum(amount_eur) AS s FROM finance_entries WHERE project_id = $1 AND status <> 'cancelled' AND kind IN ('supplier_invoice','customer_invoice') GROUP BY kind`, [projectId])).rows;
  const cost = fin.find((r) => r.kind === 'supplier_invoice')?.s;
  const sale = fin.find((r) => r.kind === 'customer_invoice')?.s;
  return cost != null || sale != null ? profitSummary(Number(cost ?? 0), Number(sale ?? 0)) : null;
}

export async function computeClosingCheck(ctx: Ctx, projectId: string): Promise<ClosingCheck> {
  const p = await getProjectRow(ctx, projectId);
  const fx = await currentFx(ctx.db);
  const contracted = (await ctx.db.query(
    `SELECT DISTINCT supplier_id FROM contracts WHERE project_id = $1 AND superseded_by IS NULL AND status = 'signed'`, [projectId])).rows.map((r) => r.supplier_id);
  const invoiced = new Set((await ctx.db.query(
    `SELECT DISTINCT supplier_id FROM finance_entries WHERE project_id = $1 AND kind = 'supplier_invoice' AND status <> 'cancelled'`, [projectId])).rows.map((r) => r.supplier_id));
  const custInv = (await ctx.db.query(`SELECT * FROM finance_entries WHERE project_id = $1 AND kind = 'customer_invoice' AND status <> 'cancelled'`, [projectId])).rows;
  // collections: customer invoices (else the commitment receivables) not yet matched to an incoming payment
  const collectBase = custInv.length ? custInv : (await ctx.db.query(`SELECT * FROM finance_entries WHERE project_id = $1 AND kind = 'receivable' AND status <> 'cancelled'`, [projectId])).rows;
  const receivablesOpenEur = collectBase.filter((e) => !['matched', 'paid'].includes(e.status)).reduce((s, e) => s + Number(e.amount_eur), 0);
  // unbilled payments: supplier payments made (paid / matched payable) for a supplier with no invoice in this project
  const paidPayables = (await ctx.db.query(
    `SELECT supplier_id FROM finance_entries WHERE project_id = $1 AND kind = 'payable' AND status IN ('paid','matched')`, [projectId])).rows;
  const unbilledPayments = paidPayables.filter((r) => !invoiced.has(r.supplier_id)).length;
  const commissionsUnreconciled = Number((await ctx.db.query(
    `SELECT count(*)::int AS n FROM finance_entries WHERE project_id = $1 AND kind = 'commission' AND status NOT IN ('matched','paid','cancelled')`, [projectId])).rows[0].n);

  const planned = await plannedProfit(ctx, projectId);
  const actual = await actualProfit(ctx, projectId);
  const deviations: { reason: string; amountEur: number }[] = [];
  const extras = (await ctx.db.query(`SELECT amount_try, reflected_to_customer FROM field_extras WHERE project_id = $1 AND admin_status <> 'rejected'`, [projectId])).rows;
  const extrasEur = r2(extras.reduce((s, e) => s + toEur(fx, Number(e.amount_try), 'TRY'), 0));
  const unreflectedEur = r2(extras.filter((e) => e.reflected_to_customer === false).reduce((s, e) => s + toEur(fx, Number(e.amount_try), 'TRY'), 0));
  if (unreflectedEur) deviations.push({ reason: 'Müşteriye yansıtılmayan farklar (saha ekstraları)', amountEur: -unreflectedEur });
  if (extrasEur) deviations.push({ reason: 'Saha ekstraları (toplam)', amountEur: extrasEur });
  // FX difference: supplier invoices in foreign currency at today's rate vs the rate recorded on the contract payable
  const fxRows = (await ctx.db.query(
    `SELECT i.amount, i.currency, i.amount_eur, (SELECT fx_rate FROM finance_entries pe WHERE pe.project_id = i.project_id AND pe.supplier_id = i.supplier_id AND pe.kind = 'payable' ORDER BY created_at LIMIT 1) AS contract_rate
       FROM finance_entries i WHERE i.project_id = $1 AND i.kind = 'supplier_invoice' AND i.currency <> 'EUR' AND i.status <> 'cancelled'`, [projectId])).rows;
  const fxDiff = r2(fxRows.reduce((s, r) => (r.contract_rate ? s + (Number(r.amount_eur) - Number(r.amount) / Number(r.contract_rate)) : s), 0));
  if (fxDiff) deviations.push({ reason: 'Kur farkı', amountEur: -fxDiff });
  const amendDelta = (await ctx.db.query(`SELECT detail FROM decisions WHERE project_id = $1 AND kind = 'condition_risk' AND detail ? 'impact'`, [projectId])).rows
    .reduce((s, r) => s + Number(r.detail.impact?.deltaCostEur ?? 0), 0);
  if (amendDelta) deviations.push({ reason: 'Değişiklik / ek protokol maliyet farkı', amountEur: -r2(amendDelta) });
  if (planned && actual) {
    const costDev = r2(actual.costEur - planned.costEur);
    if (costDev) deviations.push({ reason: 'Gerçekleşen maliyet − planlanan maliyet', amountEur: -costDev });
  }

  if (p.outcome === 'lost' || p.outcome === 'cancelled') {
    return closingCheck({
      supplierInvoicesExpected: 0, supplierInvoicesReceived: 0, customerInvoiceIssued: true, receivablesOpenEur: 0, unbilledPayments: 0, commissionsUnreconciled: 0,
      lostReasonMissing: !p.lost_reason?.trim(), planned, actual, deviations,
    });
  }
  return closingCheck({
    supplierInvoicesExpected: contracted.length, supplierInvoicesReceived: contracted.filter((s) => invoiced.has(s)).length,
    customerInvoiceIssued: custInv.length > 0, receivablesOpenEur: r2(receivablesOpenEur), unbilledPayments, commissionsUnreconciled,
    lostReasonMissing: false, planned, actual, deviations,
  });
}

// ------------------------------------------------------------------ close
export const SURVEY_QUESTIONS: PublicSurveyView['questions'] = [
  { id: 'overall', text: 'Etkinlikten genel memnuniyetiniz (1–5)?', type: 'rating' },
  { id: 'recommend', text: 'Bizi bir başka etkinlik için tavsiye eder misiniz (1–5)?', type: 'rating' },
  { id: 'improve', text: 'Neyi daha iyi yapabilirdik?', type: 'text' },
];

export async function closeProject(ctx: Ctx, projectId: string, input: { lessonsLearned?: string }): Promise<Project & { surveyUrl: string | null; effects: string[] }> {
  const user = requireUser(ctx);
  if (!['admin', 'finance'].includes(user.role)) throw forbidden('Kapanışı yönetici veya finans yapar', 'FORBIDDEN');
  const p = await getProjectRow(ctx, projectId, true);
  if (p.closed_at) throw conflict('Proje zaten kapandı', 'ALREADY_CLOSED');
  if (p.outcome === 'open') throw conflict('Açık (karar verilmemiş) proje kapatılamaz; önce kazanıldı / kaybedildi işaretleyin', 'PROJECT_OPEN');
  if (p.outcome === 'lost' && !p.lost_reason?.trim()) throw badRequest('Kaybedilen proje için kayıp nedeni zorunlu', undefined, 'LOST_REASON_REQUIRED');
  const check = await computeClosingCheck(ctx, projectId);
  if (!check.ok) throw conflict('Kapanış kontrolü tamamlanmadı', 'CLOSING_BLOCKED', check);
  const now = ctx.now();
  const effects: string[] = [];
  const lessons = input.lessonsLearned?.trim() || null;
  await ctx.db.query(
    `UPDATE projects SET closed_at = $2, lessons_learned = $3, step = 8, outcome = CASE WHEN outcome = 'won' THEN 'closed' ELSE outcome END WHERE id = $1`,
    [projectId, now, lessons]);

  let surveyUrl: string | null = null;
  if (p.outcome === 'won') {
    effects.push(...(await writeRealizedPrices(ctx, p)));
    effects.push(...(await updateSupplierScores(ctx, p)));
    const { token, hash } = newPublicToken();
    await ctx.db.query(`INSERT INTO surveys (tenant_id, project_id, token_hash, questions, created_by) VALUES (app_tenant_id(), $1, $2, $3, $4)`,
      [projectId, hash, JSON.stringify(SURVEY_QUESTIONS), user.id]);
    surveyUrl = `${ctx.deps.config.publicBaseUrl}/survey/${token}`;
    effects.push('survey_created');
  }
  if (lessons) effects.push(...(await lessonsToChecklist(ctx, p, lessons)));
  const fresh = await getProjectRow(ctx, projectId);
  return { ...mapProject(fresh), surveyUrl, effects };
}

/** Realized prices → price_history ('realized'): selected offer lines scaled by invoice / contract ratio per supplier. */
async function writeRealizedPrices(ctx: Ctx, p: Row): Promise<string[]> {
  const rules = await ctx.rules();
  const fx = await currentFx(ctx.db);
  const items = (await ctx.db.query(
    `SELECT si.*, o.lines, o.currency, o.supplier_id, o.id AS offer_id, o.cancellation_terms FROM service_items si JOIN supplier_offers o ON o.id = si.selected_offer_id
      WHERE si.project_id = $1 AND si.status <> 'cancelled'`, [p.id])).rows;
  let n = 0;
  for (const it of items) {
    const invoicedEur = Number((await ctx.db.query(
      `SELECT COALESCE(sum(amount_eur), 0) AS s FROM finance_entries WHERE project_id = $1 AND supplier_id = $2 AND kind = 'supplier_invoice' AND status <> 'cancelled'`, [p.id, it.supplier_id])).rows[0].s);
    const contractEur = Number((await ctx.db.query(
      `SELECT COALESCE(sum(amount_eur), 0) AS s FROM finance_entries WHERE project_id = $1 AND supplier_id = $2 AND kind = 'payable' AND status <> 'cancelled'`, [p.id, it.supplier_id])).rows[0].s);
    const factor = invoicedEur > 0 && contractEur > 0 ? invoicedEur / contractEur : 1;
    const supplier = (await ctx.db.query('SELECT * FROM suppliers WHERE id = $1', [it.supplier_id])).rows[0];
    for (const line of (it.lines ?? []) as OfferLine[]) {
      const mult = lineMultiplier(line);
      if (!(mult > 0) || !(line.unitPrice > 0)) continue;
      const unitNet = (splitLine(line, rules.accommodationTaxRate).netExVat / mult) * factor;
      let unitEur: number;
      try {
        unitEur = toEur(fx, unitNet, it.currency);
      } catch {
        continue;
      }
      await ctx.db.query(
        `INSERT INTO price_history (tenant_id, supplier_id, project_id, service_item_id, offer_id, kind, description, city, district, segment, service_date, pax,
           room_type, board, unit, price_type, unit_price, currency, unit_price_eur, verified)
         VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'realized',$15,$16,$17,true)`,
        [it.supplier_id, p.id, it.id, it.offer_id, line.kind ?? it.kind, line.description, p.city ?? supplier?.city, p.district ?? supplier?.district, supplier?.segment ?? null,
          it.date_from ?? p.start_date, p.pax, line.roomType ?? null, line.board ?? null, line.unit, r2(unitNet), it.currency, r2(unitEur)]);
      n++;
    }
  }
  return [`realized_prices:${n}`];
}

/** Supplier performance score (response time, contract errors, field issues, invoice mismatches) across their projects. */
async function updateSupplierScores(ctx: Ctx, p: Row): Promise<string[]> {
  const rules = await ctx.rules();
  const suppliers = (await ctx.db.query(`SELECT DISTINCT supplier_id FROM contracts WHERE project_id = $1`, [p.id])).rows.map((r) => r.supplier_id);
  const out: string[] = [];
  for (const sid of suppliers) {
    const s = (await ctx.db.query('SELECT * FROM suppliers WHERE id = $1', [sid])).rows[0];
    const projects = Number((await ctx.db.query(`SELECT count(DISTINCT project_id)::int AS n FROM contracts WHERE supplier_id = $1`, [sid])).rows[0].n);
    const contractErrors = Number((await ctx.db.query(
      `SELECT COALESCE(sum((SELECT count(*) FROM jsonb_array_elements(c.diff) x WHERE x->>'severity' = 'error')), 0)::int AS n FROM contracts c WHERE c.supplier_id = $1`, [sid])).rows[0].n);
    const fieldIssues = Number((await ctx.db.query(`SELECT count(*)::int AS n FROM field_issues WHERE supplier_id = $1`, [sid])).rows[0].n);
    const invoiceMismatches = Number((await ctx.db.query(
      `SELECT count(*)::int AS n FROM finance_entries WHERE supplier_id = $1 AND kind = 'supplier_invoice' AND (meta->>'mismatch')::boolean`, [sid])).rows[0].n);
    const resp = (await ctx.db.query(
      `SELECT avg(EXTRACT(EPOCH FROM (o.created_at - r.sent_at)) / 3600) AS h FROM rfqs r JOIN supplier_offers o ON o.rfq_id = r.id AND o.version = 1 WHERE r.supplier_id = $1 AND r.sent_at IS NOT NULL`, [sid])).rows[0].h;
    const avgResponseHours = resp != null ? Number(resp) : s.avg_response_hours != null ? Number(s.avg_response_hours) : null;
    const score = supplierScore({ avgResponseHours, contractErrors, fieldIssues, invoiceMismatches, projects });
    await ctx.db.query('UPDATE suppliers SET performance_score = $2, avg_response_hours = COALESCE($3, avg_response_hours) WHERE id = $1', [sid, score, avgResponseHours != null ? r2(avgResponseHours) : null]);
    out.push(`supplier_score:${sid}:${score}`);
    if (score < rules.lowSupplierScore) {
      await createDecision(ctx, {
        projectId: p.id, kind: 'low_supplier_score', badge: 'critical',
        summary: `${s.name}: performans skoru ${score} (eşik ${rules.lowSupplierScore}) — akreditasyon kararı sizde`,
        detail: { supplierId: sid, score, avgResponseHours, contractErrors, fieldIssues, invoiceMismatches, projects },
        aiNote: 'Pasife almak için "Düzelt" ile {"status":"passive"} seçin; onay yalnızca uyarıyı kapatır.',
        requiredRole: 'admin', entityType: 'supplier', entityId: sid, primaryActionLabel: 'Gördüm',
      });
      out.push(`low_supplier_score:${sid}`);
    }
  }
  return out;
}

/** "Bu projede neyi geç öğrendik?" → AI question suggestions → admin decision per question (§7 Adım 8). */
async function lessonsToChecklist(ctx: Ctx, p: Row, lessons: string): Promise<string[]> {
  const existing = (await ctx.db.query(`SELECT question FROM checklist_questions WHERE status <> 'rejected'`)).rows.map((r) => r.question);
  const r = await ctx.deps.ai.suggestChecklistQuestions(lessons, p.event_type, existing);
  const aiActionId = await logAiAction(ctx, { actionType: 'checklist_new_question', result: r, projectId: p.id, inputSummary: { lessonsLength: lessons.length } });
  const out: string[] = [];
  for (const q of r.data) {
    const row = (await ctx.db.query(
      `INSERT INTO checklist_questions (tenant_id, event_type, question, field, status, source) VALUES (app_tenant_id(), $1, $2, $3, 'suggested', 'closing') RETURNING id`,
      [p.event_type, q.question, q.field])).rows[0];
    const gate = await aiGate(ctx, 'checklist_new_question', {
      projectId: p.id, kind: 'checklist_question', badge: 'suggestion', summary: `Kontrol listesine yeni soru: "${q.question}"`,
      detail: { checklistQuestionId: row.id, question: q.question, field: q.field, eventType: p.event_type, lessons },
      aiNote: `${p.code} kapanışında "neyi geç öğrendik?" cevabından önerildi.`, requiredRole: 'admin', entityType: 'checklist_question', entityId: row.id,
      draft: { question: q.question }, aiActionId,
    });
    await ctx.db.query('UPDATE checklist_questions SET decision_id = $2 WHERE id = $1', [row.id, gate.decision.id]);
    out.push(`checklist_question_suggested:${row.id}`);
  }
  return out;
}

// ------------------------------------------------------------------ survey (public)
export async function publicSurveyView(ctx: Ctx, surveyId: string): Promise<PublicSurveyView> {
  const s = (await ctx.db.query('SELECT s.*, p.code FROM surveys s JOIN projects p ON p.id = s.project_id WHERE s.id = $1', [surveyId])).rows[0];
  if (!s) throw notFound('Anket');
  const agency = (await ctx.db.query('SELECT name FROM tenants WHERE id = $1', [ctx.tenantId])).rows[0]?.name ?? '';
  return { agencyName: agency, projectCode: s.code, submitted: !!s.answered_at, questions: (s.questions?.length ? s.questions : SURVEY_QUESTIONS) };
}

export async function publicSurveySubmit(ctx: Ctx, surveyId: string, body: PublicSurveySubmit): Promise<{ ok: true }> {
  const view = await publicSurveyView(ctx, surveyId);
  if (view.submitted) throw conflict('Anket zaten yanıtlandı', 'ALREADY_SUBMITTED');
  const answers: Record<string, number | string> = {};
  for (const q of view.questions) {
    const v = body.answers[q.id];
    if (v == null || v === '') continue;
    if (q.type === 'rating') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw badRequest(`${q.id}: 1–5 arası puan`, undefined, 'INVALID_RATING');
      answers[q.id] = n;
    } else answers[q.id] = String(v).slice(0, 4000);
  }
  if (!Object.keys(answers).length) throw badRequest('En az bir soruyu yanıtlayın', undefined, 'EMPTY_SURVEY');
  // conditional update: two concurrent submits cannot both win (replay / double-submit)
  const upd = await ctx.db.query('UPDATE surveys SET answers = $2, answered_at = $3 WHERE id = $1 AND answered_at IS NULL', [surveyId, JSON.stringify(answers), ctx.now()]);
  if (!upd.rowCount) throw conflict('Anket zaten yanıtlandı', 'ALREADY_SUBMITTED');
  return { ok: true };
}

// ------------------------------------------------------------------ customer invoice draft (document)
export function registerClosingDocuments(): void {
  registerDocumentGenerator('customer_invoice_draft', null, async (ctx, { projectId }) => {
    const p = await getProjectRow(ctx, projectId);
    const rules = await ctx.rules();
    const fx = await currentFx(ctx.db);
    const quotes = await loadQuotes(ctx, { projectId });
    const q = quotes.find((x) => x.status === 'accepted' && x.acceptedOptionNo != null);
    if (!q) throw conflict('Kabul edilmiş teklif yok — müşteri faturası taslağı sözleşme/teklif verisinden üretilir', 'NO_ACCEPTED_QUOTE');
    const opt = q.options.find((o) => o.optionNo === q.acceptedOptionNo)!;
    const cur = q.currency;
    const rate = q.fxRate;
    const customer = p.customer_id ? (await ctx.db.query('SELECT * FROM customers WHERE id = $1', [p.customer_id])).rows[0] : null;
    const m = (l: { quantity: number; nights: number | null }) => l.quantity * (l.nights && l.nights > 0 ? l.nights : 1);
    const lines = opt.lines.map((l) => ({ description: l.description, quantity: m(l), unitPrice: r2(l.unitPriceEur * rate), net: r2(l.unitPriceEur * m(l) * rate), vatRate: l.vatRate, source: 'contract' as const }));
    const accTax = r2(opt.lines.filter((l) => l.kind === 'accommodation').reduce((s, l) => s + l.unitPriceEur * m(l) * rate * rules.accommodationTaxRate, 0));
    // approved extras: customer approved in writing AND the team decided to reflect them
    const extras = (await ctx.db.query(
      `SELECT * FROM field_extras WHERE project_id = $1 AND customer_approved_at IS NOT NULL AND reflected_to_customer = true AND admin_status <> 'rejected' ORDER BY created_at`, [projectId])).rows;
    for (const e of extras) {
      const amt = cur === 'TRY' ? Number(e.amount_try) : r2(toEur(fx, Number(e.amount_try), 'TRY') * rate);
      lines.push({ description: `Ek hizmet: ${e.description} (onay: ${e.customer_approver_name}, ${isoDate(new Date(e.customer_approved_at))})`, quantity: 1, unitPrice: amt, net: amt, vatRate: rules.vatRates.service, source: 'contract' as const });
    }
    const net = r2(lines.reduce((s, l) => s + l.net, 0));
    const vatByRate = new Map<number, number>();
    for (const l of lines) vatByRate.set(l.vatRate, (vatByRate.get(l.vatRate) ?? 0) + l.net * l.vatRate);
    const vat = [...vatByRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate_, amount]) => ({ rate: rate_, amount: r2(amount) }));
    const total = r2(net + vat.reduce((s, v) => s + v.amount, 0) + accTax);
    const content = {
      projectCode: p.code, customer: customer ? { name: customer.name, taxOffice: customer.tax_office, taxNumber: customer.tax_number, address: customer.billing_address } : { name: p.customer_name },
      currency: cur, fxRate: rate, quoteId: q.id, quoteVersion: q.version, lines, netTotal: net, vat, accommodationTax: accTax, grandTotal: total,
      extrasIncluded: extras.map((e) => e.id), note: 'TASLAK — fatura muhasebe tarafından Mikro\'da kesilir.',
    };
    const tenantName = (await ctx.db.query('SELECT name FROM tenants WHERE id = $1', [ctx.tenantId])).rows[0]?.name ?? '';
    const pdf = await renderPdf({
      header: {
        agencyName: tenantName, title: `Müşteri faturası TASLAĞI — ${p.code}`, subtitle: 'Muhasebe Mikro\'da keser',
        meta: [['Müşteri', customer?.name ?? p.customer_name ?? '-'], ['Vergi dairesi / no', `${customer?.tax_office ?? '-'} / ${customer?.tax_number ?? '-'}`], ['Adres', customer?.billing_address ?? '-'], ['Tarih', isoDate(ctx.now())], ['Para birimi', cur]],
      },
      sections: [{
        kind: 'table', table: {
          columns: [{ label: 'Açıklama', width: 260 }, { label: 'Miktar', width: 60, align: 'right' }, { label: 'Birim', width: 95, align: 'right' }, { label: 'Tutar', width: 100, align: 'right' }],
          rows: lines.map((l) => [l.description, String(l.quantity), money(l.unitPrice, cur), money(l.net, cur)]),
          footer: [{ label: 'Matrah', value: money(net, cur) }, ...vat.map((v) => ({ label: `KDV ${pct(v.rate)}`, value: money(v.amount, cur) })),
            ...(accTax ? [{ label: `Konaklama vergisi ${pct(rules.accommodationTaxRate)}`, value: money(accTax, cur) }] : []), { label: 'Genel toplam', value: money(total, cur), bold: true }],
        },
      }],
      footerNote: 'Bu belge taslaktır; resmî fatura değildir.',
    });
    return {
      content, pdf, fileName: `${p.code}-musteri-faturasi-taslak.pdf`,
      // only the quote is a row-precise dependency; contract / finance / field-extra changes stale the draft project-wide
      deps: [{ type: 'quote', id: q.id }],
    };
  });
}

