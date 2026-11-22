// Senaryolar — ürün sahibi kararları Q6–Q9 (docs/10-senaryolar.md "Ürün sahibi kararları"): aday tedarikçi için akreditasyon
// talebi, kaybedilen projenin açık kararları + ekip performansı raporu, PO numarası ≠ proje kodu, hızlı revizyon (Rev.N).
import { describe, expect, it } from 'vitest';
import { makeWorld, ownerSql, REQUEST_TEXT, scenarioSuite, setClock, type World } from './_scenario.js';

const S = scenarioSuite();
const OFFERS = { accommodation: { moda: 105, kalamis: 150 }, hall: { moda: 1300 } };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** A period that surely contains both the test clock and the DB wall clock (audit_log.at = now()). */
function widePeriod(): { from: string; to: string } {
  const a = new Date('2026-11-20T07:00:00Z').getTime();
  const b = Date.now();
  return { from: ymd(new Date(Math.min(a, b) - 30 * 86_400_000)), to: ymd(new Date(Math.max(a, b) + 30 * 86_400_000)) };
}

describe('Q6 — aday tedarikçi: "Akreditasyon iste"', () => {
  it('Q6-01 bloklu teklifte satış akreditasyon ister (idempotent); kart yalnız yöneticide; akredite olunca revizyon geçer', async () => {
    const w = await makeWorld(S, 'q6');
    setClock('2026-11-20T10:00');
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' })
      .offers({ accommodation: { galata: 100 }, hall: { moda: 1300 } }).quote();
    expect(p.quote.status).toBe('blocked');
    expect(p.quote.blockReasons.some((r: string) => /aday/.test(r))).toBe(true);
    const galata = w.supplier('galata');

    const r1 = await w.clerk.post(`/api/suppliers/${galata}/request-accreditation`, { reason: 'Teklif bu otel yüzünden bloklu', projectId: p.id });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ created: true, supplierId: galata, status: 'candidate' });
    const r2 = await w.ops.post(`/api/suppliers/${galata}/request-accreditation`, {});
    expect(r2.body).toMatchObject({ created: false, decisionId: r1.body.decisionId }); // reuses the open card
    expect((await w.field.post(`/api/suppliers/${galata}/request-accreditation`, {})).status).toBe(403);
    expect((await w.finance.post(`/api/suppliers/${galata}/request-accreditation`, {})).status).toBe(403);

    const cards = await w.cards({ kind: 'supplier_accreditation', entityId: galata });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ requiredRole: 'admin', projectId: null });
    expect(cards[0].detail).toMatchObject({ projectCode: p.code, reason: 'Teklif bu otel yüzünden bloklu', source: 'quote_blocked' });
    // admin-only decision (invariant 5): the requester cannot decide it
    expect((await w.decide(cards[0], 'approve', { who: 'clerk' })).status).toBe(403);
    expect((await w.decide(cards[0], 'approve')).status).toBe(200);
    expect((await w.admin.get(`/api/suppliers/${galata}`)).body.status).toBe('accredited');
    expect((await w.clerk.post(`/api/suppliers/${galata}/request-accreditation`, {})).body.error.code).toBe('ALREADY_ACCREDITED');

    // the same quote, revised (Q9) without changes, now passes
    const rev = await w.clerk.post(`/api/quotes/${p.quote.id}/revise`, {});
    expect(rev.status).toBe(200);
    expect(rev.body.version).toBe(2);
    expect(['approved', 'pending_approval']).toContain(rev.body.status);
  });
});

describe('Q7 — kaybedilen proje + ekip performansı', () => {
  it('Q7-01 proje kaybedilince açık kararları "expired" + nedenle kapanır; silinmez, geçmişte görünür, denetim izi var', async () => {
    const w = await makeWorld(S, 'q7a');
    setClock('2026-11-20T10:00');
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).offers(OFFERS).quote();
    expect(p.quote.status).toBe('pending_approval');
    const card = await w.card('quote_approval', { entityId: p.quote.id });
    // a supplier-level accreditation request stays open (not project-bound)
    const acc = await w.clerk.post(`/api/suppliers/${w.supplier('galata')}/request-accreditation`, { projectId: p.id });
    await p.flow().lost('Rakip acenta daha ucuz');

    expect((await w.cards({ projectId: p.id })).length).toBe(0);
    const expired = await w.cards({ projectId: p.id, status: 'expired' });
    const e = expired.find((d) => d.id === card.id);
    expect(e).toBeTruthy();
    expect(e.status).toBe('expired');
    expect((await ownerSql('SELECT reason FROM decisions WHERE id = $1', [card.id]))[0].reason).toBe('proje kaybedildi: Rakip acenta daha ucuz');
    const audit = await ownerSql(`SELECT before->>'status' AS b, after->>'status' AS a FROM audit_log WHERE entity = 'decisions' AND entity_id = $1 AND action = 'update'`, [card.id]);
    expect(audit).toContainEqual({ b: 'open', a: 'expired' });
    expect((await w.cards({ kind: 'supplier_accreditation' })).map((d) => d.id)).toContain(acc.body.decisionId);
    // an expired card can no longer be decided
    expect((await w.decide(card, 'approve')).body.error.code).toBe('DECISION_CLOSED');
  });

  it('Q7-02 ekip performansı: talep / gönderilen / kazanılan / kaybedilen, kayıp nedenleri, süre, marj ≠ markup, düzeltme, onaylı vs serbest, geçmiş proje', async () => {
    const w = await makeWorld(S, 'q7b');
    setClock('2026-11-16T10:00');
    const clerkId = w.user('clerk').id;
    // A: clerk's quote → admin rejects (correction) → Rev.2 → approved → sent → accepted with PO → won
    const a = await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).assign('clerk').offers(OFFERS).quote();
    expect(a.quote.status).toBe('pending_approval');
    expect((await w.decide(await w.card('quote_approval', { entityId: a.quote.id }), 'reject', { reason: 'Marj düşük' })).status).toBe(200);
    const rev = await w.clerk.post(`/api/quotes/${a.quote.id}/revise`, {});
    expect(rev.body).toMatchObject({ version: 2, status: 'pending_approval' });
    a.quote = rev.body;
    setClock('2026-11-17T15:00');
    await a.flow().approveQuote().send().accept(1, { poNumber: 'PO-A-1' });
    expect((await a.project()).outcome).toBe('won');
    // B: owned by clerk, quote authored by the admin (free) → sent → lost
    const b = await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).assign('clerk').offers(OFFERS).as('admin').quote().send().as('clerk').lost('Fiyat yüksek');
    // C: lost without a quote
    await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).assign('clerk').lost('Fiyat yüksek');
    // historical imported project with a known owner (won, closed)
    const seq = (await ownerSql('SELECT COALESCE(max(seq), 0) + 1 AS s FROM projects WHERE tenant_id = $1', [w.t.tenantId]))[0].s;
    await ownerSql(
      `INSERT INTO projects (tenant_id, seq, code, title, customer_name, step, outcome, received_at, start_date, end_date, historical, historical_cost_eur, historical_sale_eur, owner_id, closed_at, source_ref)
       VALUES ($1, $2, $3, 'Geçmiş bayi toplantısı', 'Eski Müşteri', 8, 'closed', '2026-06-10', '2026-06-10', '2026-06-11', true, 8000, 10000, $4, '2026-06-12', $3)`,
      [w.t.tenantId, seq, `GEC-${seq}`, clerkId]);

    expect((await w.clerk.get('/api/reports/team-performance')).status).toBe(403);
    const r = await w.admin.get(`/api/reports/team-performance?${new URLSearchParams(widePeriod())}`);
    if (r.status !== 200) console.log(JSON.stringify(r.body));
    expect(r.status).toBe(200);
    expect(r.body.financialsVisible).toBe(true);
    const c = r.body.rows.find((x: any) => x.userId === clerkId);
    expect(c).toMatchObject({
      requests: 4, historicalProjects: 1, quotesSent: 1, won: 2, lost: 2, winRate: 0.5,
      quotesBuilt: 2, quotesReviewed: 2, quotesCorrected: 1, correctionRate: 0.5, approvalRequiredQuotes: 2, freeQuotes: 0,
    });
    expect(c.lostReasons).toEqual([{ reason: 'Fiyat yüksek', count: 2 }]);
    expect(c.lostProjects.map((l: any) => l.code).sort()).toContain(b.code);
    expect(c.avgQuoteBusinessHours).toBeGreaterThan(0);
    expect(c.quoteTargetBusinessHours).toBeGreaterThan(0);
    // planned margin (Kâr÷Satış) and markup (Kâr÷Alış) separately — accepted option of A + historical 2000/10000
    const qa = (await w.admin.get(`/api/quotes/${a.quote.id}`)).body;
    const t = qa.options.find((o: any) => o.optionNo === qa.acceptedOptionNo).totals;
    expect(c.avgPlannedMargin).toBeCloseTo((t.margin + 0.2) / 2, 2);
    expect(c.avgPlannedMarkup).toBeCloseTo((t.markup + 0.25) / 2, 2);
    expect(c.avgPlannedMargin).not.toBe(c.avgPlannedMarkup);
    // realized: only the historical project has final figures (A not invoiced yet); TRY only with FX evidence
    expect(c.realizedProfitEur).toBe(2000);
    expect(c.realizedProjects).toBe(1);
    expect(c.realizedTryMissing + (c.realizedProfitTry != null ? 1 : 0)).toBe(1);
    // the admin authored B's quote (free, within own authority) — quote-quality data goes to the author
    const ad = r.body.rows.find((x: any) => x.userId === w.user('admin').id);
    expect(ad).toMatchObject({ quotesBuilt: 1, freeQuotes: 1, approvalRequiredQuotes: 0, won: 0 });
    expect(r.body.totals).toMatchObject({ won: 2, lost: 2, quotesBuilt: 3 });

    // rolling default period = last 12 months up to the (test) clock date; an empty past window → zeros
    setClock('2026-11-20T10:00');
    const d = await w.admin.get('/api/reports/team-performance');
    expect(d.body).toMatchObject({ from: '2025-11-21', to: '2026-11-20' });
    const empty = await w.admin.get('/api/reports/team-performance?from=2020-01-01&to=2020-12-31');
    expect(empty.body.rows.find((x: any) => x.userId === clerkId)).toMatchObject({ requests: 0, won: 0, lost: 0, winRate: null });
    expect((await w.admin.get('/api/reports/team-performance?from=2026-12-01&to=2026-01-01')).body.error.code).toBe('INVALID_PERIOD');
  });
});

describe('Q8 — PO numarası müşterinin kendi satın alma numarası', () => {
  it('Q8-01 PO ≠ proje kodu; teklif yanıtında PO/onaylayan/kesin onay; PO ile proje aranır; PDF\'de "Referans" = proje kodu', async () => {
    const w = await makeWorld(S, 'q8');
    setClock('2026-11-20T10:00');
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).offers(OFFERS).as('admin').quote().send()
      .accept(1, { approverName: 'Selin Kaya' });
    let q = (await w.admin.get(`/api/quotes/${p.quote.id}`)).body;
    expect(q).toMatchObject({ poNumber: null, acceptedByName: 'Selin Kaya', firmApprovedAt: null, awaitingSignedForm: true });
    q = (await w.admin.post(`/api/quotes/${p.quote.id}/firm-approval`, { poNumber: '4500012345' })).body;
    expect(q).toMatchObject({ poNumber: '4500012345', awaitingSignedForm: false });
    expect(q.firmApprovedAt).toBeTruthy();
    expect(q.poNumber).not.toBe(p.code);
    const found = (await w.clerk.get('/api/projects?q=4500012345')).body.items;
    expect(found.map((x: any) => x.id)).toEqual([p.id]);
    const doc = (await w.admin.get(`/api/projects/${p.id}/documents`)).body.items.find((d: any) => d.kind === 'quote');
    expect(doc.content).toMatchObject({ reference: p.code, projectCode: p.code });
  });
});

describe('Q9 — hızlı revizyon (Rev.N, aynı teklif dosyası)', () => {
  it('Q9-01 fiyatı etkileyen değişiklik → "Yeniden üret" yerine revize; gönderilen Rev.1 salt okunur kalır; kapılar yeniden işler', async () => {
    const w: World = await makeWorld(S, 'q9');
    setClock('2026-11-20T10:00');
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS).as('admin').quote().send();
    const v1 = p.quote;
    expect(v1.status).toBe('sent');
    await w.admin.patch(`/api/projects/${p.id}`, { pax: 90, reason: 'Müşteri 90 kişi dedi' });
    const stale = (await w.admin.get(`/api/projects/${p.id}/documents`)).body.items.find((d: any) => d.kind === 'quote' && d.status === 'stale');
    const regen = await w.admin.post(`/api/documents/${stale.id}/regenerate`);
    expect(regen.body.error).toMatchObject({ code: 'QUOTE_REBUILD_REQUIRED', details: { quoteId: v1.id, action: 'revise' } });

    // revise: only the markup of option 1 / accommodation changes; everything else is reused from Rev.1
    const opts = v1.options.map((o: any) => ({
      title: o.title,
      lines: o.lines.map((l: any) => (l.valueAdd ? { serviceItemId: l.serviceItemId, offerId: null, unitPriceEur: l.unitPriceEur }
        : { serviceItemId: l.serviceItemId, offerId: l.offerId, markup: o.optionNo === 1 && l.kind === 'accommodation' ? 0.3 : l.markup })),
    }));
    const r = await w.admin.post(`/api/quotes/${v1.id}/revise`, { options: opts });
    expect(r.status).toBe(200);
    const v2 = r.body;
    expect(v2).toMatchObject({ projectId: p.id, version: 2, status: 'approved' });
    expect(v2.options.map((o: any) => o.title)).toEqual(v1.options.map((o: any) => o.title));
    expect(v2.options[0].lines.find((l: any) => l.kind === 'accommodation').markup).toBeCloseTo(0.3, 4);
    expect(v2.options[1].totals.saleEur).toBeCloseTo(v1.options[1].totals.saleEur, 0); // unchanged option reused
    // Rev.1 stays as the customer saw it: superseded, read-only, still listed with its send time
    const old = (await w.admin.get(`/api/quotes/${v1.id}`)).body;
    expect(old).toMatchObject({ status: 'superseded', supersededBy: v2.id, sentAt: v1.sentAt });
    expect(old.options[0].totals.saleEur).toBe(v1.options[0].totals.saleEur);
    expect((await w.pub.get(`/api/public/quotes/${p.quoteToken}`)).body.error.code).toBe('QUOTE_SUPERSEDED');
    const list = (await w.admin.get(`/api/projects/${p.id}/quotes`)).body.items;
    expect(list.map((q: any) => q.version)).toEqual([2, 1]);
    // documents regenerated automatically for Rev.2 (current), so it can be sent right away
    const doc2 = (await w.admin.get(`/api/projects/${p.id}/documents`)).body.items.find((d: any) => d.kind === 'quote' && d.content?.revision === 2);
    expect(doc2.status).toBe('current');
    expect((await w.admin.post(`/api/quotes/${v2.id}/send`)).status).toBe(200);
    // only the latest revision can be revised
    expect((await w.admin.post(`/api/quotes/${v1.id}/revise`, {})).body.error.code).toBe('QUOTE_NOT_LATEST');
    // validation gate still applies: below-target markup → Rev.3 blocked (margin override card for the admin)
    const low = opts.map((o: any) => ({ ...o, lines: o.lines.map((l: any) => (l.offerId ? { ...l, markup: 0.01 } : l)) }));
    const v3 = (await w.clerk.post(`/api/quotes/${v2.id}/revise`, { options: low })).body;
    expect(v3).toMatchObject({ version: 3, status: 'blocked' });
    expect((await w.cards({ kind: 'margin_override', entityId: v3.id })).length).toBe(1);
    // approval gate: a clerk revision for a customer outside the clerk's authority waits for approval
    const n = await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).offers(OFFERS).as('admin').quote();
    const nr = (await w.clerk.post(`/api/quotes/${n.quote.id}/revise`, {})).body;
    expect(nr).toMatchObject({ version: 2, status: 'pending_approval' });
    // an accepted quote is not revised here
    n.quote = nr;
    await n.flow().as('admin').approveQuote().send().accept(1, { poNumber: 'PO-9' });
    expect((await w.admin.post(`/api/quotes/${nr.id}/revise`, {})).body.error.code).toBe('QUOTE_ACCEPTED');
  });
});
