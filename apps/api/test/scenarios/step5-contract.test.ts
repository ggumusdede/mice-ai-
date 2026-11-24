// Senaryolar — §7 Adım 5 Konfirmasyon ve sözleşme (onay kapısı), §17.8 (docs/10-senaryolar.md S5-xx)
import { describe, expect, it } from 'vitest';
import { makeWorld, ownerSql, REQUEST_TEXT, scenarioSuite, type World } from './_scenario.js';

const S = scenarioSuite();
let w: World;
const world = async () => (w ??= await makeWorld(S, 's5'));
const OFFERS = { accommodation: { moda: 105, kalamis: 150 }, hall: { moda: 1300 } };
const won = (w: World, customer: 'trusted' | 'new' | 'deposit' | null = 'trusted', text = REQUEST_TEXT) =>
  w.flow().intake(text, { customer }).offers(OFFERS).as('admin').quote().send().accept();
const SUPPLIER_TEXT = `KONAKLAMA VE TOPLANTI SÖZLEŞMESİ\nOtel: Moda Sahil Otel\nMüşteri: Marmara Teknoloji A.Ş.\nGiriş: 13.03.2027  Çıkış: 14.03.2027\nKatılımcı: 90 kişi, garanti 75 kişi\n25 DBL oda x 2 gece x 115 EUR (BB)\n30 SGL oda x 2 gece x 90 EUR (BB)\nSalon kirası: 1.300 EUR\nFiyatlar KDV hariçtir.\nÖdeme: %50 ön ödeme imzada.\nİptal: 45 günden az kalan iptallerde %100.`;

describe('Adım 5 — sözleşme', () => {
  it('S5-01 §7.5 karşılıklı koşul riski: tedarikçi %30 ön ödeme, müşteriden kapora yok → risk tutarıyla yöneticiye', async () => {
    const w = await world();
    const p = await won(w).contract('moda');
    expect(p.contract.diff.filter((d: any) => d.severity !== 'info')).toEqual([]);
    expect(Number(p.contract.conditionRiskEur)).toBeCloseTo(13250 * 0.3, 0);
    const risk = await w.card('condition_risk', { entityId: p.contract.id });
    expect(risk.urgent).toBe(true);
    expect(risk.aiNote).toMatch(/%30 ön ödeme.*kapora yok/);
    expect((await w.admin.post(`/api/contracts/${p.contract.id}/sign`, { signedBy: w.user('admin').id })).body.error.code).toBe('CONTRACT_NOT_APPROVED');
  });

  it('S5-02 §17.2 kaporalı müşteri (%30) → risk karşılanır; taahhüt kaydı kapora + bakiye alacak, ön ödeme + bakiye borç', async () => {
    const w = await world();
    const p = await won(w, 'deposit').contract('moda');
    expect(Number(p.contract.conditionRiskEur)).toBe(0);
    expect(await w.cards({ kind: 'condition_risk', entityId: p.contract.id })).toHaveLength(0);
    await p.flow().approveContract().sign();
    const fin = await p.finance();
    expect(fin.filter((e) => e.kind === 'receivable').map((e) => e.meta.part).sort()).toEqual(['balance', 'deposit']);
    expect(fin.filter((e) => e.kind === 'payable').map((e) => e.meta.part).sort()).toEqual(['balance', 'prepayment']);
    expect(fin.filter((e) => e.kind === 'receivable').every((e) => e.currency === 'TRY')).toBe(true);
  });

  it('S5-03 §7.5 tedarikçi sözleşmesi alan alan karşılaştırılır (tarih, kişi, birim fiyat, ödeme) → fark kartı + revizyon taslağı; temiz olana kadar imza yok', async () => {
    const w = await world();
    const p = await won(w).contract('moda', { template: 'supplier', text: SUPPLIER_TEXT });
    const fields = p.contract.diff.map((d: any) => d.field);
    expect(p.contract.status).toBe('diff_pending');
    expect(fields).toEqual(expect.arrayContaining(['startDate', 'pax']));
    expect(p.contract.diff.some((d: any) => /115|DBL/.test(d.message))).toBe(true);
    const c = await w.card('contract_diff', { entityId: p.contract.id });
    expect(c.badge).toBe('critical');
    expect(c.draft.body).not.toMatch(/MARMARATEK/);
    expect((await w.decide(c, 'reject')).body.effects).toContain('diff_dismissed');
    expect((await w.admin.post(`/api/contracts/${p.contract.id}/sign`, { signedBy: w.user('admin').id })).status).toBe(409);
  });

  it('S5-04 §7.5 boş müşteri / fatura alanı hata sayılır; fatura bilgisi projeye girilince yeniden karşılaştırma temiz', async () => {
    const w = await world();
    const p = await won(w, null, REQUEST_TEXT.replace('Anadolu İlaç', 'Yıldız Enerji A.Ş.')).contract('moda');
    const billing = p.contract.diff.find((d: any) => d.field === 'billingInfo');
    expect(billing.severity).toBe('error');
    await w.admin.patch(`/api/projects/${p.id}`, { billingInfo: 'Yıldız Enerji A.Ş., Ataşehir VD 1234567890' });
    const again = await w.admin.post(`/api/contracts/${p.contract.id}/compare`);
    expect(again.body.diff.find((d: any) => d.field === 'billingInfo')).toBeUndefined();
  });

  it('S5-05 §17.4 katma değer kalemi sözleşme kontrolünde hata sayılmaz, "katma değer" olarak işaretlenir', async () => {
    const w = await world();
    const lines = [{ kind: 'accommodation' }, { kind: 'hall' }, { kind: 'technical:valueAdd', unitPriceEur: 500 }];
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS)
      .addItem('technical', { description: 'Ses-ışık (otelden ücretsiz)', valueAdd: true })
      .as('admin').quote([{ lines }, { lines }]).send().accept().contract('moda', { kinds: ['accommodation', 'hall'] });
    const va = p.contract.diff.find((d: any) => d.kind === 'value_add');
    expect(va?.severity).toBe('info');
    expect(p.contract.diff.filter((d: any) => d.severity !== 'info')).toEqual([]);
  });

  it('S5-06 §7.5 akreditasyon kilidi: aday tedarikçiyle sözleşme açılmaz; onaydan sonra pasife alınan tedarikçi imzalanamaz', async () => {
    const w = await world();
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers({ ...OFFERS, accommodation: { moda: 105, galata: 90 } }).as('admin')
      .quote([{ lines: [{ kind: 'accommodation' }, { kind: 'hall' }] }, { lines: [{ kind: 'accommodation', markup: 0.25 }, { kind: 'hall' }] }]).send().accept();
    expect((await w.admin.post(`/api/projects/${p.id}/contracts`, { supplierId: w.supplier('galata'), serviceItemIds: [p.item('accommodation')] })).body.error.code).toBe('SUPPLIER_NOT_ACCREDITED');
    await p.flow().contract('moda').approveContract();
    await ownerSql(`UPDATE suppliers SET status = 'passive' WHERE id = $1`, [w.supplier('moda')]);
    expect((await w.admin.post(`/api/contracts/${p.contracts.moda}/sign`, { signedBy: w.user('admin').id })).body.error.code).toBe('SUPPLIER_NOT_ACCREDITED');
    await ownerSql(`UPDATE suppliers SET status = 'accredited' WHERE id = $1`, [w.supplier('moda')]);
  });

  it('S5-07 §17.8 imza yetkisi: yalnız kurucu / yetkilendirilmiş kişi, yönetici onayından sonra; clerk imza kaydedemez', async () => {
    const w = await world();
    const p = await won(w).contract('moda').approveContract();
    const id = p.contracts.moda;
    expect((await w.admin.post(`/api/contracts/${id}/sign`, { signedBy: w.user('ops').id })).body.error.code).toBe('NOT_SIGNATORY');
    expect((await w.clerk.post(`/api/contracts/${id}/sign`, { signedBy: w.user('admin').id })).status).toBe(403);
    await w.admin.patch(`/api/users/${w.user('ops').id}`, { canSign: true });
    await w.relogin('ops');
    const s = await w.admin.post(`/api/contracts/${id}/sign`, { signedBy: w.user('ops').id, scanFileName: 'islak-imza.pdf' });
    expect(s.body).toMatchObject({ status: 'signed', locked: true });
  });

  it('S5-08 §7.5 imzalı sürüm kilitli → ek protokol; maliyet artışı marjı hedefin altına düşürürse yönetici kararı', async () => {
    const w = await world();
    const p = await won(w).contract('moda').approveContract().sign();
    await expect(ownerSql(`UPDATE contracts SET fields = '{}' WHERE id = $1`, [p.contracts.moda])).rejects.toThrow(/kilitli/);
    expect((await w.admin.post(`/api/contracts/${p.contracts.moda}/amend`, { changes: { pax: 90 }, reason: ' ' })).status).toBe(400);
    await p.flow().amend({ totalAmount: 16500, pax: 90 }, 'Oda sayısı arttı, satış güncellenmedi');
    expect((await p.tasks('change_flow')).length).toBe(1);
    const c = (await w.cards({ kind: 'condition_risk', projectId: p.id })).find((x) => x.detail.amendmentOf === p.contracts.moda);
    expect(c.detail.impact.belowTarget).toBe(true);
    expect((await w.decide(c)).body.effects).toContain('acknowledged');
    expect((await w.admin.post(`/api/contracts/${p.last.id}/amend`, { changes: {}, reason: 'x' })).body.error.code).toBe('CONTRACT_NOT_SIGNED');
  });

  it('S5-09 §6 tedarikçi konfirmasyonu yalnız taslak: yetkisiz gönderemez, yönetici gönderince rezervasyon konfirme', async () => {
    const w = await world();
    const p = await won(w).contract('moda').approveContract().sign();
    const d = (await p.drafts('supplier_confirmation'))[0];
    expect(d.status).toBe('draft');
    expect((await w.ops.post(`/api/drafts/${d.id}/send`)).status).toBe(403);
    expect((await w.admin.post(`/api/drafts/${d.id}/send`)).body.status).toBe('sent');
    expect((await ownerSql('SELECT DISTINCT status FROM reservations WHERE contract_id = $1', [p.contracts.moda]))[0].status).toBe('confirmed');
  });

  it('S5-10 §14 düşük güvenli sözleşme okuması fark olmasa da imzaya geçmez (insan kontrolü)', async () => {
    const w = await world();
    const p = await won(w).contract('moda', { template: 'supplier', text: 'Sözleşme taranmış, okunaksız sayfa.' });
    expect(p.contract.status).toBe('diff_pending');
    expect((await w.card('contract_diff', { entityId: p.contract.id })).detail.lowConfidence).toBe(true);
  });
});
