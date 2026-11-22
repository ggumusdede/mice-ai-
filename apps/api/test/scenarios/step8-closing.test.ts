// Senaryolar — §7 Adım 8 Kapanış ve öğrenme (docs/10-senaryolar.md S8-xx)
import { describe, expect, it } from 'vitest';
import { makeWorld, ownerSql, P, REQUEST_TEXT, scenarioSuite, type World } from './_scenario.js';

const S = scenarioSuite();

/** Invoices + customer invoice + collection + commission → closing check green. */
async function settle(w: World, p: P): Promise<void> {
  await w.finance.post('/api/finance/supplier-invoices', { projectId: p.id, supplierId: w.supplier('moda'), invoiceNo: `MSO-${p.code.slice(4, 8)}`, amount: 13250, currency: 'EUR', vatAmount: 1585 });
  const rec = (await p.finance('receivable'))[0];
  await w.finance.post('/api/finance/customer-invoices', { projectId: p.id, invoiceNo: `SF-${p.code.slice(4, 8)}`, amount: rec.amount, currency: rec.currency });
  await w.finance.post('/api/finance/bank-statements', { csv: `Tarih;Açıklama;Tutar;Döviz\n16.03.2027;SF-${p.code.slice(4, 8)} tahsilat ${p.code};${String(rec.amount).replace('.', ',')};${rec.currency}` });
  const com = (await w.finance.get(`/api/finance/commissions?projectId=${p.id}`)).body.items[0];
  await w.finance.post(`/api/finance/commissions/${com.id}/reconcile`, { invoiceNo: 'KOM' });
}
const check = async (w: World, p: P) => Object.fromEntries((await w.finance.get(`/api/projects/${p.id}/closing-check`)).body.items.map((i: any) => [i.key, i.ok]));

describe('Adım 8 — kapanış ve öğrenme', () => {
  it('S8-01 §7.8 kapanış tüm koşullar sağlanana kadar bloklu (fatura, müşteri faturası, tahsilat, komisyon); clerk kapatamaz', async () => {
    const w = await makeWorld(S, 's8a');
    const p = await w.flow().signed();
    expect(await check(w, p)).toMatchObject({ supplier_invoices: false, customer_invoice: false, collections: false });
    expect((await w.admin.post(`/api/projects/${p.id}/close`, {})).body.error.code).toBe('CLOSING_BLOCKED');
    await settle(w, p);
    expect(Object.values(await check(w, p)).every(Boolean)).toBe(true);
    expect((await w.clerk.post(`/api/projects/${p.id}/close`, {})).status).toBe(403);
    expect((await w.finance.post(`/api/projects/${p.id}/close`, {})).body.outcome).toBe('closed');
  });

  it('S8-02 §7.8 fatura edilmemiş ödeme kapanışı bloklar (ödenmiş borç, fatura yok)', async () => {
    const w = await makeWorld(S, 's8b');
    const p = await w.flow().signed();
    const prep = (await p.finance('payable')).find((e) => e.meta.part === 'prepayment');
    await w.finance.post('/api/finance/payment-requests', { entryId: prep.id });
    await w.decide(await w.card('payment_approval', { entityId: prep.id }), 'approve');
    await w.finance.post(`/api/finance/entries/${prep.id}/mark-paid`, {});
    expect((await check(w, p)).unbilled_payments).toBe(false);
  });

  it('S8-03 §7.8 kapanış yan etkileri: gerçekleşen fiyat → fiyat geçmişi, tedarikçi skoru (düşük → yönetici kararı), anket, "neyi geç öğrendik" → kontrol listesi önerisi → sonraki talepte soru', async () => {
    const w = await makeWorld(S, 's8c');
    await w.rules({ lowSupplierScore: 95 });
    const p = await w.flow().signed();
    await w.field.post(`/api/projects/${p.id}/field-issues`, { description: 'Oda temizliği geç', severity: 'high', supplierId: w.supplier('moda') });
    await settle(w, p);
    const closed = await w.admin.post(`/api/projects/${p.id}/close`, { lessonsLearned: 'Katılımcıların otopark ihtiyacını çok geç öğrendik.' });
    expect(closed.body.surveyUrl).toMatch(/^\/survey\//);
    expect((await ownerSql(`SELECT count(*)::int AS n FROM price_history WHERE project_id = $1 AND price_type = 'realized'`, [p.id]))[0].n).toBeGreaterThan(0);
    const low = await w.card('low_supplier_score', { entityId: w.supplier('moda') });
    expect(low.summary).toMatch(/eşik 95/);
    const q = await w.card('checklist_question', { projectId: p.id });
    expect(q.summary).toMatch(/Otopark/i);
    await w.decide(q, 'approve');
    const next = await w.flow().intake(REQUEST_TEXT);
    expect(next.intake.missingQuestions.join(' ')).toMatch(/Otopark/i);
    const tok = closed.body.surveyUrl.split('/survey/')[1];
    expect((await w.pub.get(`/api/public/survey/${tok}`)).body.questions).toHaveLength(3);
  });

  it('S8-04 §7.8 / §17.10 kapanış süresi: etkinlik bitişi + 30 gün içinde uyarı yok, aşılınca yöneticiye uyarı (bir kez)', async () => {
    const w = await makeWorld(S, 's8d');
    const p = await w.flow().signed(); // bitiş 2027-03-14 → event_ended 2027-03-15 00:00
    await w.worker('2027-03-16T09:00');
    await w.worker('2027-04-13T23:00'); // 29,9 gün
    expect(await w.cards({ kind: 'closing_overdue', projectId: p.id })).toHaveLength(0);
    await w.worker('2027-04-14T09:00'); // 30 günü geçti
    expect(await w.cards({ kind: 'closing_overdue', projectId: p.id })).toHaveLength(1);
    await w.worker('2027-04-20T09:00');
    expect(await w.cards({ kind: 'closing_overdue', projectId: p.id })).toHaveLength(1);
  });

  it('S8-05 §4 ekip kaydı: kişi bazlı yetki verisi (teklif sayısı, düzeltilen, kazanma oranı) yöneticiye görünür', async () => {
    const w = await makeWorld(S, 's8e');
    const won = await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).assign().offers({ accommodation: { moda: 105, kalamis: 150 }, hall: { moda: 1300 } }).quote();
    await w.decide(await w.card('quote_approval', { entityId: won.quote.id }), 'edit', { edits: { note: 'marj' } });
    const lost = await w.flow().intake(REQUEST_TEXT.replace('12-14 Mart', '1-3 Nisan')).assign().lost('Bütçe');
    void lost;
    await w.admin.post(`/api/projects/${won.id}/outcome`, { outcome: 'won' });
    const s = (await w.admin.get(`/api/users/${w.user('clerk').id}/stats`)).body;
    expect(s).toMatchObject({ quotesTotal: 1, quotesCorrected: 1, won: 1, lost: 1, winRate: 0.5 });
  });
});

