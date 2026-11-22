// Senaryolar — §3.8 çok kiracılı izolasyon (paralel iki acenta) ve §4 / §17.1 roller (docs/10-senaryolar.md MT-xx, R-xx)
import { describe, expect, it } from 'vitest';
import { advanceHours, clock } from '../helpers.js';
import { makeWorld, REQUEST_TEXT, scenarioSuite } from './_scenario.js';
import { runFollowupsOnce } from '../../src/worker.js';

const S = scenarioSuite();
const OFFERS = { accommodation: { moda: 105, kalamis: 150 }, hall: { moda: 1300 } };

describe('Çok kiracılı izolasyon', () => {
  it('MT-01 §3.8 iki acenta aynı senaryoyu paralel koşar: kodlar kendi sırasında, listeler / kararlar / id ile erişim ayrık', async () => {
    const [A, B] = await Promise.all([makeWorld(S, 'mta'), makeWorld(S, 'mtb')]);
    const [pa, pb] = await Promise.all([A, B].map((w) => w.flow().signed()));
    expect(pa.code.slice(0, 8)).toBe('PRJ-0001');
    expect(pb.code.slice(0, 8)).toBe('PRJ-0001');
    expect((await B.admin.get(`/api/projects/${pa.id}`)).status).toBe(404);
    expect((await B.admin.get(`/api/contracts/${pa.contracts.moda}`)).status).toBe(404);
    expect((await B.admin.get('/api/projects')).body.items.map((x: any) => x.id)).toEqual([pb.id]);
    expect((await B.finance.get('/api/finance/entries')).body.items.every((e: any) => e.projectId === pb.id)).toBe(true);
    const cardA = (await A.cards({ projectId: pa.id }))[0];
    if (cardA) expect((await B.decide(cardA, 'approve')).status).toBe(404);
    expect((await B.finance.post('/api/finance/supplier-invoices', { projectId: pa.id, supplierId: B.supplier('moda'), invoiceNo: 'X', amount: 1, currency: 'EUR' })).status).toBe(404);
  });

  it('MT-02 §3.8 public linkler ve webhook\'lar kiracıya bağlı: A\'nın linki yalnız A verisini açar; B\'nin imzası A anahtarında geçmez', async () => {
    const [A, B] = await Promise.all([makeWorld(S, 'mtc'), makeWorld(S, 'mtd')]);
    const pa = await A.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).rfqs('accommodation', ['moda', 'kalamis', 'bomonti']).approveRfqs('accommodation');
    const view = await A.pub.get(`/api/public/rfq/${pa.rfqTokens.accommodation.moda}`);
    expect(view.body.agencyName).toBe('Test mtc');
    await A.inboundEmail({ from: 'x@y.example.com', subject: 'test', text: 'merhaba', messageId: '<a1@x>' });
    await B.inboundEmail({ from: 'x@y.example.com', subject: 'test', text: 'merhaba', messageId: '<b1@x>' });
    const cross = await A.inboundEmail({ from: 'x@y.example.com', subject: 'x', text: 'x', messageId: '<c1@x>' }, { secret: B.secret! });
    expect(cross.status).toBe(401);
  });

  it('MT-03 §3.8 worker tüm kiracıları ayrı işler: hatırlatmalar her acentanın kendi kullanıcısından ve kendi tedarikçisine', async () => {
    const [A, B] = await Promise.all([makeWorld(S, 'mte'), makeWorld(S, 'mtf')]);
    for (const w of [A, B]) await w.flow().intake().rfqs('hall', ['moda', 'kalamis', 'bomonti']).approveRfqs('hall');
    const before = A.mails.length;
    advanceHours(25);
    await runFollowupsOnce(A.T.app.deps, clock.now);
    const rem = A.mailsSince(before).filter((m) => m.autonomous);
    for (const w of [A, B]) {
      const mine = rem.filter((m) => m.tenantId === w.t.tenantId);
      expect(mine).toHaveLength(3);
      expect(mine.every((m) => m.from === w.user('clerk').email)).toBe(true);
    }
  });
});

describe('Roller', () => {
  it('R-01 [Ürün kararı] fieldRoleCanSeeFinancials: kapalıyken saha kâr / teklif / finans göremez; açılınca görür', async () => {
    const w = await makeWorld(S, 'r1');
    const p = await w.flow().signed();
    const d = await p.detail('field');
    expect(d.profit).toMatchObject({ expected: null, realized: null });
    expect((await w.field.get(`/api/quotes/${p.quote.id}`)).body.error.code).toBe('FINANCIALS_HIDDEN');
    expect((await w.field.get('/api/finance/entries')).status).toBe(403);
    await w.rules({ fieldRoleCanSeeFinancials: true });
    expect((await w.field.get(`/api/quotes/${p.quote.id}`)).status).toBe(200);
    expect((await p.detail('field')).profit.expected).not.toBeNull();
  });

  it('R-02 §17.1 clerk onay kartlarını göremez / veremez; finans ödeme onaylayamaz; ops teklif gönderemez', async () => {
    const w = await makeWorld(S, 'r2');
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).offers(OFFERS).quote();
    const c = await w.card('quote_approval', { entityId: p.quote.id });
    expect((await w.cards({ who: 'clerk' })).some((x) => x.id === c.id)).toBe(false);
    expect((await w.decide(c, 'approve', { who: 'clerk' })).status).toBe(403);
    expect((await w.decide(c, 'approve', { who: 'finance' })).status).toBe(403);
    await w.decide(c, 'approve');
    expect((await w.ops.post(`/api/quotes/${p.quote.id}/send`)).status).toBe(403);
    expect((await w.finance.post(`/api/projects/${p.id}/field-extras`, { description: 'x', amountTry: 10 })).status).toBe(403);
  });

  it('R-03 §4 / G-17 rol veya yetki değişikliği eski oturumları sonlandırır; yönetici kendini düşüremez', async () => {
    const w = await makeWorld(S, 'r3');
    expect((await w.admin.patch(`/api/users/${w.user('finance').id}`, { role: 'clerk_ops' })).status).toBe(200);
    expect((await w.finance.get('/api/auth/me')).status).toBe(401);
    const fresh = await w.relogin('finance');
    expect((await fresh.get('/api/auth/me')).body.user.role).toBe('clerk_ops');
    expect((await w.admin.patch(`/api/users/${w.user('admin').id}`, { role: 'finance' })).body.error.code).toBe('SELF_DEMOTION');
  });

  it('R-04 §3.3 taslağı yalnız sahibi veya yönetici gönderir; saha başkasının taslağını göremez', async () => {
    const w = await makeWorld(S, 'r4');
    const p = await w.flow().intake('Mayıs 2027 Sarıyer 40 kişi toplantı', { fromAddress: 'ik@musteri.example.com' });
    const d = p.intake.questionDraft;
    expect((await w.ops.post(`/api/drafts/${d.id}/send`)).body.error.code).toBe('DRAFT_NOT_OWNER');
    expect((await w.field.get(`/api/drafts?projectId=${p.id}`)).body.items).toHaveLength(0);
    expect((await w.admin.post(`/api/drafts/${d.id}/send`)).body.status).toBe('sent');
  });
});
