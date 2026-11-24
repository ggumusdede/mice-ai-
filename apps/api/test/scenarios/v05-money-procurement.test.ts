// v0.5-A — para ve tedarik çekirdeği (docs/12-v05-kararlar.md: S-19, S-03, S-06, S-07, D-1). Uçtan uca API senaryoları.
import { describe, expect, it } from 'vitest';
import { BIO, makeWorld, ownerSql, REQUEST_TEXT, scenarioSuite, type World } from './_scenario.js';

const S = scenarioSuite();
const EUR_TRY = 48.5; // seed: 1 EUR = 48.5 TRY = 1.08 USD
const EUR_USD = 1.08;

/** Admin requests + approves (Face ID) the agency base currency change. */
async function setBase(w: World, currency: string): Promise<void> {
  const r = await w.admin.post('/api/settings/base-currency', { currency, reason: 'Acenta yurtiçi çalışıyor' });
  expect(r.status).toBe(200);
  const c = await w.card('base_currency_change');
  expect(c.requiresBiometric).toBe(true);
  expect((await w.decide(c, 'approve')).status).toBe(200);
  expect((await w.admin.get('/api/settings')).body.baseCurrency).toBe(currency);
}

const OFFERS = { accommodation: { moda: 105, kalamis: 150 }, hall: { moda: 1300 } };

describe('v0.5-A — para ve tedarik çekirdeği', () => {
  it('M-01 S-19 ana para birimi: yalnız yönetici, gerekçe + Face ID karar kartıyla değişir; yalnız yeni projeleri etkiler; proje para birimi DB\'de sabit', async () => {
    const w = await makeWorld(S, 'ParaBir');
    expect((await w.admin.get('/api/settings')).body).toMatchObject({ baseCurrency: 'EUR', pendingBaseCurrency: null });
    const old = await w.flow().intake();
    expect((await old.project()).baseCurrency).toBe('EUR');
    // clerk cannot; reason required; unknown currency refused
    expect((await w.clerk.post('/api/settings/base-currency', { currency: 'TRY', reason: 'x' })).status).toBe(403);
    expect((await w.admin.post('/api/settings/base-currency', { currency: 'GBP', reason: 'x' })).body.error.code).toBe('INVALID_CURRENCY');
    expect((await w.admin.post('/api/settings/base-currency', { currency: 'EUR', reason: 'x' })).body.error.code).toBe('SAME_CURRENCY');
    await w.admin.post('/api/settings/base-currency', { currency: 'TRY', reason: 'Acenta yurtiçi çalışıyor' });
    expect((await w.admin.get('/api/settings')).body.pendingBaseCurrency).toMatchObject({ currency: 'TRY' });
    const c = await w.card('base_currency_change');
    // Face ID step-up is mandatory
    expect((await w.decide(c, 'approve', { bio: false })).status).toBeGreaterThanOrEqual(400);
    expect((await w.decide(c, 'approve')).status).toBe(200);
    expect((await w.admin.get('/api/settings')).body.baseCurrency).toBe('TRY');
    // the earlier project keeps EUR, a new one takes TRY
    expect((await old.project()).baseCurrency).toBe('EUR');
    const fresh = await w.flow().intake();
    expect((await fresh.project()).baseCurrency).toBe('TRY');
    // fixed for life — even the owner role cannot change it
    await expect(ownerSql(`UPDATE projects SET base_currency = 'USD' WHERE id = $1`, [fresh.id])).rejects.toThrow(/sabittir/);
    // audited: the tenants row change is in the audit log
    const audit = await ownerSql(`SELECT after->>'base_currency' AS b FROM audit_log WHERE entity = 'tenants' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [w.t.tenantId]);
    expect(audit[0]?.b).toBe('TRY');
  });

  it('M-02 S-19 TL ana para birimli acenta: normalizasyon, teklif, marj/markup, P&L ve gerçekleşen kâr TL; EUR acentayla aynı oranlar', async () => {
    const eur = await makeWorld(S, 'ParaEur');
    const tl = await makeWorld(S, 'ParaTl');
    await setBase(tl, 'TRY');
    const pe = await eur.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS).as('admin').quote(undefined, { currency: 'EUR' }).send().accept();
    const pt = await tl.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS).as('admin').quote(undefined, { currency: 'TRY' }).send().accept();
    expect(pt.quote).toMatchObject({ baseCurrency: 'TRY', currency: 'TRY', fxRate: 1 });
    expect(pt.quote.fxPolicy).toMatchObject({ bufferPct: 0, rateSource: expect.any(String), validUntil: pt.quote.optionUntil });
    const le = pe.quote.options[0].lines[0];
    const lt = pt.quote.options[0].lines[0];
    expect(lt.unitCostEur).toBeCloseTo(le.unitCostEur * EUR_TRY, 1);
    // per-line rounding (2 decimals in each base) → relative check
    expect(Math.abs(pt.quote.options[0].totals.saleEur / (pe.quote.options[0].totals.saleEur * EUR_TRY) - 1)).toBeLessThan(1e-4);
    expect(pt.quote.options[0].totals.margin).toBeCloseTo(pe.quote.options[0].totals.margin, 4);
    expect(pt.quote.options[0].totals.markup).toBeCloseTo(pe.quote.options[0].totals.markup, 4);
    // comparison in TRY
    const cmp = (await tl.admin.get(`/api/items/${pt.item('accommodation')}/comparison`)).body;
    const ev = cmp.evaluations.find((e: any) => e.offerId === pt.offer('accommodation', 'moda'));
    expect(ev.normalized.baseCurrency).toBe('TRY');
    expect(ev.normalized.perRoomNightEur).toBeGreaterThan(1000);
    // internal P&L document in TRY; deprecated EUR columns keep the EUR equivalent
    const docs = (await tl.admin.get(`/api/projects/${pt.id}/documents`)).body.items;
    const pnl = docs.find((d: any) => d.kind === 'pnl');
    expect(pnl.content.baseCurrency).toBe('TRY');
    const ql = await ownerSql('SELECT unit_cost_base, unit_cost_eur FROM quote_lines WHERE quote_id = $1 ORDER BY sort LIMIT 1', [pt.quote.id]);
    expect(Number(ql[0].unit_cost_eur)).toBeCloseTo(Number(ql[0].unit_cost_base) / EUR_TRY, 2);
    // realized profit: TRY invoices → TL base figures equal the TL column
    const sale = Math.round(pt.quote.options[0].totals.saleEur);
    expect((await tl.finance.post('/api/finance/supplier-invoices', { projectId: pt.id, supplierId: tl.supplier('moda'), invoiceNo: 'TL-1', amount: 200000, currency: 'TRY', issueDate: '2026-11-20' })).status).toBe(200);
    expect((await tl.finance.post('/api/finance/customer-invoices', { projectId: pt.id, invoiceNo: 'TL-S1', amount: sale, currency: 'TRY', issueDate: '2026-11-20' })).status).toBe(200);
    const fin = (await tl.finance.get(`/api/finance/entries?projectId=${pt.id}`)).body.items;
    expect(fin.find((e: any) => e.invoiceNo === 'TL-1')).toMatchObject({ amountEur: 200000, baseCurrency: 'TRY' });
    const rf = (await tl.admin.get(`/api/projects/${pt.id}/realized-fx`)).body;
    expect(rf.base).toMatchObject({ currency: 'TRY', revenue: sale, cost: 200000, profit: sale - 200000 });
    const detail = (await tl.admin.get(`/api/projects/${pt.id}`)).body;
    expect(detail.profit.realized.profitEur).toBeCloseTo(sale - 200000, 2);
  });

  it('M-03 S-19 USD ana para birimi: EUR teklif + %3 kur payı (müşteriye gizli, içeride ayrı satır) → USD gerçekleşen kâr, her hareket kendi kuruyla', async () => {
    const w = await makeWorld(S, 'ParaUsd');
    await setBase(w, 'USD');
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS).as('admin')
      .step('quote with fx policy', async (_w, pp) => {
        const lines = ['accommodation', 'hall'].map((k) => ({ serviceItemId: pp.item(k), offerId: pp.offer(k, 'moda'), markup: 0.2 }));
        const r = await w.admin.post(`/api/projects/${pp.id}/quotes`, { currency: 'EUR', options: [{ title: 'A', lines }, { title: 'B', lines: lines.map((l) => ({ ...l, markup: 0.25 })) }], fxPolicy: { bufferPct: 0.03 } });
        expect(r.status).toBe(200);
        pp.quote = r.body;
      }).send().accept();
    const q = p.quote;
    expect(q).toMatchObject({ baseCurrency: 'USD', currency: 'EUR' });
    const market = 1 / EUR_USD;
    expect(q.fxPolicy.marketRate).toBeCloseTo(market, 6);
    expect(q.fxRate).toBeCloseTo(market * 1.03, 5);
    const o = q.options[0];
    expect(o.fxBufferEur).toBeCloseTo(o.totals.saleEur * 0.03, 1);
    expect(o.grandTotalCustomerCurrency).toBeCloseTo((o.totals.saleEur + o.vatEur + o.accommodationTaxEur) * q.fxRate, 0);
    // customer-facing document: buffer hidden (no rate printed); internal P&L shows it
    const docs = (await w.admin.get(`/api/projects/${p.id}/documents`)).body.items;
    expect(docs.find((d: any) => d.kind === 'quote').content.fxDisclosure).toMatch(/sabit/);
    expect(docs.find((d: any) => d.kind === 'pnl').content.options[0].fxBufferEur).toBeGreaterThan(0);
    // buffer above the rule maximum is refused
    expect((await w.admin.post(`/api/quotes/${q.id}/revise`, { fxPolicy: { bufferPct: 0.4 } })).body.error.code).toBe('FX_POLICY_INVALID');
    // realized: customer pays in USD (exact), supplier invoice in EUR valued at the TCMB EUR/USD of its date (1.10)
    await ownerSql(`INSERT INTO fx_rates (tenant_id, currency, rate, source, rate_date, rate_type) VALUES ($1, 'USD', 1.10, 'TCMB', '2026-11-20', 'tcmb_forex_buying')`, [w.t.tenantId]);
    expect((await w.finance.post('/api/finance/supplier-invoices', { projectId: p.id, supplierId: w.supplier('moda'), invoiceNo: 'US-1', amount: 5000, currency: 'EUR', issueDate: '2026-11-20' })).status).toBe(200);
    expect((await w.finance.post('/api/finance/customer-invoices', { projectId: p.id, invoiceNo: 'US-S1', amount: 8000, currency: 'USD', issueDate: '2026-11-20' })).status).toBe(200);
    const rf = (await w.admin.get(`/api/projects/${p.id}/realized-fx`)).body;
    expect(rf.base).toMatchObject({ currency: 'USD', revenue: 8000, cost: 5500, profit: 2500, missing: 0 });
    // agency-level team report: in the agency's current base with the rate source
    const team = (await w.admin.get('/api/reports/team-performance')).body;
    expect(team.baseCurrency).toBe('USD');
    expect(team.fxNote).toMatch(/1 EUR = 1.08 USD/);
  });

  it('M-04 S-03 kontrat fiyatı kıyasta çıpa: değerlendirmede "kontrat fiyatı" görünür; üstündeki teklif risk satırı alır; arşivlenen fiyat kullanılmaz', async () => {
    const w = await makeWorld(S, 'Kontrat');
    const cr = await w.clerk.post('/api/contract-rates', { supplierId: w.supplier('moda'), kind: 'accommodation', validFrom: '2027-01-01', validTo: '2027-12-31', price: 90, currency: 'EUR', conditions: 'Yıllık anlaşma, BB' });
    expect(cr.status).toBe(200);
    expect((await w.field.post('/api/contract-rates', { supplierId: w.supplier('moda'), kind: 'accommodation', validFrom: '2027-01-01', validTo: '2027-12-31', price: 100, currency: 'EUR' })).status).toBe(403);
    const p = await w.flow().intake().offers({ accommodation: { moda: 105 } });
    const ev = (await w.admin.get(`/api/items/${p.item('accommodation')}/comparison`)).body.evaluations[0];
    // offer ≈ 96.8 EUR / room-night (DBL 105, SGL 90) vs contract 90
    expect(ev.contractBenchmark).toMatchObject({ contractRateId: cr.body.id, price: 90, basis: 'room_night' });
    expect(ev.contractBenchmark.advantage).toBeLessThan(0);
    expect(['contract', 'channel']).toContain(ev.benchmark.type); // channel data (seed) still decides the class when it exists
    expect(ev.risks.join(' ')).toMatch(/kontrat fiyatının/);
    expect((await w.clerk.post(`/api/contract-rates/${cr.body.id}/archive`)).body.status).toBe('archived');
    const ev2 = (await w.admin.get(`/api/items/${p.item('accommodation')}/comparison`)).body.evaluations[0];
    expect(ev2.contractBenchmark ?? null).toBeNull();
    expect((await w.admin.get('/api/contract-rates')).body.items).toHaveLength(0);
  });

  it('M-05 S-03 allotment: pickup, T-x release kartı tahmini cezayla; karar insan verir, tedarikçi bildirimi onaylı taslak; otomatik release yok', async () => {
    const w = await makeWorld(S, 'Allotment');
    const p = await w.flow().intake();
    const b = (await w.ops.post('/api/allotments', {
      projectId: p.id, supplierId: w.supplier('moda'), roomType: 'DBL', dateFrom: '2027-03-12', dateTo: '2027-03-13', roomsPerNight: 50,
      ratePerRoomNight: 120, currency: 'EUR', releaseDate: '2026-11-27', attritionPct: 0.1, penaltyTerms: '%10 tolerans, altı tam ücret',
    })).body;
    expect(b.summary).toMatchObject({ contractedRoomNights: 100, pickedUpRoomNights: 0, daysToRelease: 7, stage: 'release_window' });
    const after = (await w.ops.post(`/api/allotments/${b.id}/pickup`, { rooms: 30 })).body;
    expect(after.summary).toMatchObject({ pickedUpRoomNights: 60, releasableRooms: 20, penaltyIfHold: 3600, penaltyIfRelease: 0 });
    expect(await w.worker('2026-11-21T10:00')).toContain('allotment_release_card');
    expect(await w.worker('2026-11-21T11:00')).not.toContain('allotment_release_card'); // idempotent
    const c = await w.card('allotment_release', { entityId: b.id });
    expect(c.summary).toMatch(/3600 EUR/);
    // still nothing released by the system
    expect((await w.ops.get(`/api/allotments?projectId=${p.id}`)).body.items[0].releasedRooms).toBe(0);
    expect((await w.decide(c, 'approve')).body.effects).toEqual(['allotment_released', 'release_notice_drafted']);
    const blk = (await w.ops.get(`/api/allotments?projectId=${p.id}`)).body.items[0];
    expect(blk).toMatchObject({ releasedRooms: 20, summary: { penaltyIfHold: 0 } });
    const notice = await w.card('outbound_message', { projectId: p.id });
    expect(notice.draft.body).toMatch(/release/);
    expect(notice.draft.body).not.toContain('Anadolu'); // supplier-safe reference
  });

  it('M-06 S-03 opsiyon: 1./2. opsiyon sırası, T-3 "uzat / bırak / konfirme" kartı, uzatma taslağı insan onaylı; uzatılınca müşteri teklifi eskir ve revize ile yeni opsiyon tarihi', async () => {
    const w = await makeWorld(S, 'Opsiyon');
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' })
      .offers({ accommodation: { moda: { price: 105, optionUntil: '2026-11-24' } }, hall: { moda: 1300 } }).as('admin').quote();
    expect(p.quote.optionUntil).toBe('2026-11-24');
    const o1 = (await w.clerk.post(`/api/projects/${p.id}/options`, { serviceItemId: p.item('accommodation'), supplierId: w.supplier('moda'), offerId: p.offer('accommodation', 'moda'), optionUntil: '2026-11-24' })).body;
    expect(o1).toMatchObject({ rank: 1, status: 'active', warning: null });
    const o2 = (await w.clerk.post(`/api/projects/${p.id}/options`, { serviceItemId: p.item('accommodation'), supplierId: w.supplier('moda'), optionUntil: '2026-11-30' })).body;
    expect(o2).toMatchObject({ rank: 2 });
    expect(o2.warning).toMatch(/2\. opsiyon/);
    expect(await w.worker('2026-11-21T10:00')).toContain('supplier_option_card');
    const card = await w.card('supplier_option_expiry', { entityId: o1.id });
    expect(card.summary).toMatch(/T-3/);
    expect((await w.decide(card, 'approve')).body.effects).toContain('option_extension_drafted');
    const ext = await w.card('outbound_message', { projectId: p.id });
    expect(ext.detail.optionId).toBe(o1.id);
    expect((await w.clerk.get(`/api/projects/${p.id}/options`)).body.items.find((x: any) => x.id === o1.id).status).toBe('extension_requested');
    // supplier agreed → extended; the customer quote document becomes stale and cannot be sent as is
    expect((await w.clerk.post(`/api/options/${o1.id}/extended`, { optionUntil: '2026-11-20' })).body.error.code).toBe('INVALID_EXTENSION');
    const done = (await w.clerk.post(`/api/options/${o1.id}/extended`, { optionUntil: '2026-12-15' })).body;
    expect(done).toMatchObject({ optionUntil: '2026-12-15', status: 'active', extensions: [{ from: '2026-11-24', to: '2026-12-15' }] });
    expect((await w.admin.post(`/api/quotes/${p.quote.id}/send`)).body.error.code).toBe('DOCUMENT_STALE');
    const rev = (await w.admin.post(`/api/quotes/${p.quote.id}/revise`, {})).body;
    expect(rev.optionUntil > '2026-11-24').toBe(true);
    // released / confirmed are human statuses
    expect((await w.clerk.post(`/api/options/${o2.id}/status`, { status: 'released' })).body.status).toBe('released');
  });

  it('M-07 S-06 kapora önce: müşteri kaporası tahsil edilmeden ön ödeme talebi uyarı + zorunlu gerekçe + Face ID istisna; acenta "blok" seçebilir', async () => {
    const w = await makeWorld(S, 'Kapora');
    const p = await w.flow().signed({ customer: 'deposit' });
    const fin = (await w.finance.get(`/api/finance/entries?projectId=${p.id}`)).body.items;
    const prepay = fin.find((e: any) => e.kind === 'payable' && e.meta.part === 'prepayment');
    expect(prepay).toBeTruthy();
    await w.rules({ depositFirstMode: 'block' });
    expect((await w.finance.post('/api/finance/payment-requests', { entryId: prepay.id, depositFirstReason: 'x' })).body.error.code).toBe('DEPOSIT_FIRST_BLOCKED');
    await w.rules({ depositFirstMode: 'warn' });
    const noReason = await w.finance.post('/api/finance/payment-requests', { entryId: prepay.id });
    expect(noReason.status).toBe(409);
    expect(noReason.body.error.code).toBe('DEPOSIT_FIRST_REASON_REQUIRED');
    const ok = await w.finance.post('/api/finance/payment-requests', { entryId: prepay.id, depositFirstReason: 'Otel Cuma 17:00\'de blokeyi bırakacak; müşteri PO\'su yolda' });
    expect(ok.status).toBe(200);
    expect(ok.body.meta.depositFirstException).toMatchObject({ reason: expect.stringContaining('Otel') });
    const c = await w.card('payment_approval', { entityId: prepay.id });
    expect(c).toMatchObject({ badge: 'critical', requiresBiometric: true });
    expect(c.summary).toMatch(/KAPORA ÖNCE/);
    expect((await w.decide(c, 'approve', { bio: false })).status).toBeGreaterThanOrEqual(400);
    expect((await w.decide(c, 'approve')).status).toBe(200);
    // a customer without a deposit agreement: no warning
    const t = await w.flow().signed({ customer: 'trusted' });
    const tp = (await w.finance.get(`/api/finance/entries?projectId=${t.id}`)).body.items.find((e: any) => e.kind === 'payable' && e.meta.part === 'prepayment');
    expect((await w.finance.post('/api/finance/payment-requests', { entryId: tp.id })).status).toBe(200);
  });

  it('M-08 D-1 kabul edilmiş teklif revize edilir: Rev.N yeni link ve müşteri onayı ister; o ana kadar kabul edilen geçerli; imzalı sözleşme varsa ek protokol görevi', async () => {
    const w = await makeWorld(S, 'Revizyon');
    const p = await w.flow().signed();
    const accepted = p.quote;
    const rev = await w.admin.post(`/api/quotes/${accepted.id}/revise`, {});
    expect(rev.status).toBe(200);
    expect(rev.body).toMatchObject({ version: 2, revisesAcceptedQuoteId: accepted.id });
    // the accepted version stays in force until the customer accepts the revision
    expect((await w.admin.get(`/api/quotes/${accepted.id}`)).body.status).toBe('accepted');
    p.quote = rev.body;
    const q2 = await p.flow().as('admin').approveQuote().send();
    expect(q2.quoteToken).toBeTruthy();
    await q2.flow().accept(1, { poNumber: 'PO-2' });
    expect((await w.admin.get(`/api/quotes/${accepted.id}`)).body).toMatchObject({ status: 'superseded', supersededBy: rev.body.id });
    expect((await w.admin.get(`/api/quotes/${rev.body.id}`)).body.status).toBe('accepted');
    const tasks = (await w.admin.get(`/api/tasks?projectId=${p.id}`)).body.items;
    expect(tasks.find((t: any) => t.kind === 'contract_amendment')?.title).toMatch(/ek protokol/);
    void BIO;
  });
});
