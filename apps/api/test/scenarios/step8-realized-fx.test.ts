// Senaryolar — ürün sahibi kararı Q5: kanıtlı gerçekleşen kur (EUR + TL), TCMB valör günü kuru (docs/10-senaryolar.md S8-06…S8-10)
import { afterEach, describe, expect, it } from 'vitest';
import { makeWorld, ownerSql, P, scenarioSuite, type World } from './_scenario.js';
import { setIntegrationFetch } from '../../src/services/integrations-http.js';

const S = scenarioSuite();
afterEach(() => setIntegrationFetch(null));

const tcmbXml = (date: string, eurBuy: number, eurSell: number) => {
  const [y, m, d] = date.split('-');
  return `<?xml version="1.0" encoding="UTF-8"?><Tarih_Date Tarih="${d}.${m}.${y}" Date="${m}/${d}/${y}" Bulten_No="1">
  <Currency Kod="USD" CurrencyCode="USD"><Unit>1</Unit><ForexBuying>34.5</ForexBuying><ForexSelling>34.6</ForexSelling><BanknoteBuying>34.4</BanknoteBuying><BanknoteSelling>34.7</BanknoteSelling></Currency>
  <Currency Kod="EUR" CurrencyCode="EUR"><Unit>1</Unit><ForexBuying>${eurBuy}</ForexBuying><ForexSelling>${eurSell}</ForexSelling><BanknoteBuying>${eurBuy - 0.1}</BanknoteBuying><BanknoteSelling>${eurSell + 0.1}</BanknoteSelling></Currency>
</Tarih_Date>`;
};

/** finance requests → admin approves (Face ID) → finance marks paid with the payment record body */
async function pay(w: World, entryId: string, body: Record<string, unknown>) {
  await w.finance.post('/api/finance/payment-requests', { entryId });
  await w.decide(await w.card('payment_approval', { entityId: entryId }), 'approve');
  const r = await w.finance.post(`/api/finance/entries/${entryId}/mark-paid`, body);
  if (r.status !== 200) throw new Error(`mark-paid ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
const rfx = async (w: World, p: P) => (await p.detail('finance')).profit.realizedFx;

describe('Q5 — kanıtlı gerçekleşen kâr (EUR + TL)', () => {
  it('S8-06 sözleşme imzası sonrası, fatura / ödeme yokken gerçekleşen kâr "—": hareket yok, eksi kâr / −%100 markup gösterilmez', async () => {
    const w = await makeWorld(S, 'fx1');
    const p = await w.flow().signed();
    const d = await p.detail('finance');
    expect(d.profit.realized).toBeNull();
    expect(d.profit.realizedFx).toMatchObject({ status: 'none', profit: { eur: null, try: null }, markup: { eur: null, try: null }, evidence: [] });
    expect(d.profit.realizedFx.reasons[0].code).toBe('no_movements');
    // only a supplier invoice: partial — cost shown, profit / margin / markup not computed
    await w.finance.post('/api/finance/supplier-invoices', { projectId: p.id, supplierId: w.supplier('moda'), invoiceNo: 'MSO-FX1', amount: 5300, currency: 'EUR', issueDate: '2026-11-20' });
    const r = await rfx(w, p);
    expect(r.status).toBe('partial');
    expect(r.cost.eur).toBe(5300);
    expect(r.profit.eur).toBeNull();
    expect(r.markup.eur).toBeNull();
    expect(r.reasons.map((x: any) => x.code)).toContain('no_revenue');
  });

  it('S8-07 kapanan projede kâr tahsilat / ödeme kurlarından EUR ve TL olarak kanıtlı hesaplanır (TL tahsilat → banka kuru, TL ödeme → ödeme kaydı)', async () => {
    const w = await makeWorld(S, 'fx2');
    const p = await w.flow().signed();
    const rec = (await p.finance('receivable'))[0];
    expect(rec.currency).toBe('EUR');
    const payables = await p.finance('payable');
    const prep = payables.find((e) => e.meta.part === 'prepayment');
    const bal = payables.find((e) => e.meta.part === 'balance');
    const supTotal = Math.round((prep.amount + bal.amount) * 100) / 100;
    // supplier invoice (EUR, e-Fatura-like rate 36) and customer invoice (EUR, rate 36.2 entered from the invoice)
    const si = await w.finance.post('/api/finance/supplier-invoices', { projectId: p.id, supplierId: w.supplier('moda'), invoiceNo: 'MSO-FX2', amount: supTotal, currency: 'EUR', issueDate: '2026-11-20', eurTryRate: 36 });
    expect(si.body.entry.fxEvidence).toMatchObject({ eurTryRate: 36, rateSource: 'invoice', valueDate: '2026-11-20' });
    const ci = await w.finance.post('/api/finance/customer-invoices', { projectId: p.id, invoiceNo: 'SF-FX2', amount: rec.amount, currency: 'EUR', issueDate: '2026-11-20', eurTryRate: 36.2 });
    // prepayment paid in TL: 37 TL per EUR (TL amount → derived rate); balance paid in TL with an explicit rate 38
    const pp = await pay(w, prep.id, { paidAt: '2026-11-21T10:00:00+03:00', paidCurrency: 'TRY', tryAmount: Math.round(prep.amount * 37 * 100) / 100 });
    expect(pp.fxEvidence.paid).toMatchObject({ currency: 'TRY', eurTryRate: 37, rateSource: 'payment_record' });
    await pay(w, bal.id, { paidAt: '2026-11-25T10:00:00+03:00', paidCurrency: 'TRY', paidAmount: Math.round(bal.amount * 38 * 100) / 100, eurTryRate: 38 });
    // collection: TL bank line manually matched to the EUR customer invoice → rate = TL ÷ EUR (banka)
    const tl = Math.round(rec.amount * 37.5 * 100) / 100;
    await w.finance.post('/api/finance/bank-statements', { csv: `Tarih;Açıklama;Tutar;Döviz\n24.11.2026;Havale gelen;${tl.toFixed(2).replace('.', ',')};TRY` });
    const tx = (await w.finance.get('/api/finance/bank-transactions')).body.items.find((t: any) => t.currency === 'TRY');
    expect((await w.finance.post(`/api/finance/bank-transactions/${tx.id}/match`, { entryId: ci.body.id })).body).toMatchObject({ status: 'matched', eurTryRate: 37.5, rateSource: 'bank_derived' });

    const r = await rfx(w, p);
    expect(r.status).toBe('complete');
    expect(r.revenue.eur).toBeCloseTo(rec.amount, 2);
    expect(r.revenue.try).toBeCloseTo(tl, 2);
    expect(r.cost.eur).toBeCloseTo(supTotal, 1);
    expect(r.cost.try).toBeCloseTo(prep.amount * 37 + bal.amount * 38, 1);
    expect(r.profit.try).toBeCloseTo(tl - (prep.amount * 37 + bal.amount * 38), 1);
    expect(r.margin.eur).not.toBe(r.markup.eur); // margin and markup separately, in both currencies
    expect(r.margin.try).toBeCloseTo(r.profit.try / r.revenue.try, 6);
    expect(r.markup.try).toBeCloseTo(r.profit.try / r.cost.try, 6);
    expect(r.avgCollectionRate).toBeCloseTo(37.5, 4);
    expect(r.avgPaymentRate).toBeCloseTo((prep.amount * 37 + bal.amount * 38) / supTotal, 3);
    expect(r.projectAvgRate).toBeGreaterThan(37);
    expect(r.collectionVsPaymentFx.try).toBeCloseTo(supTotal * 37.5 - (prep.amount * 37 + bal.amount * 38), 0);
    // evidence: every number provable (bank line, two payment records; invoices replaced by their cash)
    const src = r.evidence.map((e: any) => `${e.type}:${e.usage}:${e.rateSource}`).sort();
    expect(src).toEqual(['collection:cash:bank_derived', 'customer_invoice:settled:invoice', 'payment:cash:payment_record', 'payment:cash:payment_record', 'supplier_invoice:settled:invoice']);
    // closing check: plan vs actual carries the realized EUR + TL and the planned TL at the quote rate
    const cc = (await w.finance.get(`/api/projects/${p.id}/closing-check`)).body;
    expect(cc.planVsActual.realizedFx.profit.try).toBeCloseTo(r.profit.try, 2);
    expect(cc.planVsActual.plannedTry).not.toBeNull();
    // field role (fieldRoleCanSeeFinancials=false): no money in the closing check, no realized FX
    const fc = (await w.field.get(`/api/projects/${p.id}/closing-check`)).body;
    expect(fc.planVsActual).toMatchObject({ planned: null, actual: null, realizedFx: null });
    expect((await w.field.get(`/api/projects/${p.id}/realized-fx`)).status).toBe(403);
    expect((await p.detail('field')).profit).toEqual({ expected: null, realized: null });
  });

  it('S8-08 EUR borç EUR ödendi → TL maliyet ödeme günü TCMB kuruyla (hafta sonu → önceki bülten; kural ile kur türü; kur yoksa kanıt eksiği)', async () => {
    const w = await makeWorld(S, 'fx3');
    const p = await w.flow().signed();
    const prep = (await p.finance('payable')).find((e) => e.meta.part === 'prepayment');
    // TCMB bulletin of Friday 20.11.2026 via the (mocked) network; the archive URL is used
    const urls: string[] = [];
    setIntegrationFetch(async (url) => { urls.push(url); return new Response(tcmbXml('2026-11-20', 37.2, 37.3), { status: 200 }); });
    const imp = await w.finance.post('/api/fx/tcmb-import', { date: '2026-11-20' });
    expect(imp.body).toMatchObject({ date: '2026-11-20', inserted: 8 }); // 4 types × (TRY, USD)
    expect(urls).toEqual(['https://www.tcmb.gov.tr/kurlar/202611/20112026.xml']);
    expect((await w.finance.post('/api/fx/tcmb-import', { date: '2026-11-20' })).body.inserted).toBe(0); // idempotent
    setIntegrationFetch(async () => new Response('', { status: 404 }));
    expect((await w.finance.post('/api/fx/tcmb-import', { date: '2026-11-21' })).body.error.code).toBe('TCMB_NO_BULLETIN');
    // the internal (system) rate is NOT changed by TCMB rows
    expect((await ownerSql(`SELECT count(*)::int AS n FROM fx_rates WHERE tenant_id = $1 AND rate_type IS NULL AND rate = 37.2`, [w.t.tenantId]))[0].n).toBe(0);

    // EUR paid in EUR on Saturday (no conversion, no rate entered)
    await pay(w, prep.id, { paidAt: '2026-11-21T11:00:00+03:00', reference: 'EFT-EUR' });
    let r = await rfx(w, p);
    const ev = r.evidence.find((e: any) => e.type === 'payment');
    expect(ev).toMatchObject({ currency: 'EUR', eurTryRate: 37.2, rateSource: 'tcmb', rateNote: 'TCMB 2026-11-20 döviz alış' });
    expect(r.cost.try).toBeCloseTo(prep.amount * 37.2, 2);
    // rule fxRateTypeForReporting → döviz satış
    expect((await w.admin.patch('/api/rules', { fxRateTypeForReporting: 'tcmb_forex_selling' })).status).toBe(200);
    expect((await w.admin.patch('/api/rules', { fxRateTypeForReporting: 'yesterday_guess' })).body.error.code).toBe('INVALID_RULE_VALUE');
    r = await rfx(w, p);
    expect(r.cost.try).toBeCloseTo(prep.amount * 37.3, 2);
    expect(r.evidence.find((e: any) => e.type === 'payment').rateNote).toBe('TCMB 2026-11-20 döviz satış');
    // manual / CSV entry; a payment with no rate within the window → evidence gap, partial, no guessing
    const man = await w.finance.post('/api/fx/rates', { csv: 'Tarih;Para birimi;Tür;Kur\n25.11.2026;TRY;tcmb_forex_selling;37,90\n26.11.2026;XXX;;1' });
    expect(man.body).toMatchObject({ inserted: 1, rejected: [{ line: 3 }] });
    expect((await w.clerk.post('/api/fx/rates', { rows: [{ rateDate: '2026-11-25', currency: 'TRY', rate: 1 }] })).status).toBe(403);
    await ownerSql(`DELETE FROM fx_rates WHERE tenant_id = $1 AND rate_type IS NOT NULL`, [w.t.tenantId]);
    r = await rfx(w, p);
    expect(r.status).toBe('partial');
    expect(r.missingRates).toEqual([expect.objectContaining({ type: 'payment', currency: 'EUR', need: ['TRY'] })]);
    expect(r.reasons.map((x: any) => x.code)).toContain('rate_missing');
  });

  it('S8-09 kapanış kontrolü ve P&L belgesi: iki para birimi, ortalama kurlar, kur farkı sapma nedeni, kanıt tablosu', async () => {
    const w = await makeWorld(S, 'fx4');
    const p = await w.flow().signed();
    const rec = (await p.finance('receivable'))[0];
    await w.finance.post('/api/finance/supplier-invoices', { projectId: p.id, supplierId: w.supplier('moda'), invoiceNo: 'MSO-FX4', amount: 360000, currency: 'TRY', issueDate: '2026-11-20', eurTryRate: 36 });
    await w.finance.post('/api/finance/customer-invoices', { projectId: p.id, invoiceNo: 'SF-FX4', amount: rec.amount, currency: 'EUR', issueDate: '2026-11-20', eurTryRate: 36 });
    const cc = (await w.finance.get(`/api/projects/${p.id}/closing-check`)).body;
    expect(cc.planVsActual.realizedFx.status).toBe('partial');
    expect(cc.planVsActual.realizedFx.reasons.map((x: any) => x.code)).toContain('unsettled_invoices');
    // TRY supplier invoice at 36 vs quote-time rate → evidence-based FX deviation reason
    const dev = cc.planVsActual.deviations.find((d: any) => /Kur farkı/.test(d.reason));
    expect(dev.reason).toMatch(/kanıtlı/);
    expect(dev.amountEur).toBeCloseTo(cc.planVsActual.realizedFx.fxGainLoss.eur, 2);
    const quote = (await w.admin.get(`/api/quotes?projectId=${p.id}`)).body.items.find((q: any) => q.status === 'accepted');
    const pnl = await w.admin.post(`/api/quotes/${quote.id}/documents`, { kind: 'pnl' });
    expect(pnl.status).toBe(200);
    expect(pnl.body.content.realized.realizedFx.evidence).toHaveLength(2);
    expect(pnl.body.content.realized.plannedTry.sale).toBeGreaterThan(0);
  });
});
