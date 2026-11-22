// Senaryolar — yönetişim: §17.1 vekâlet, §6 yasak liste (DB), §16 otomasyon terfisi / örneklem / geri dönüş, §16.5 kural
// önerisi, §16.6 haftalık rapor sayıları (docs/10-senaryolar.md G-xx)
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { APP_URL } from '../helpers.js';
import { makeWorld, ownerSql, REQUEST_TEXT, rng, scenarioSuite, setClock, type World } from './_scenario.js';

const S = scenarioSuite();
const OFFERS = { accommodation: { moda: 105, kalamis: 150 }, hall: { moda: 1300 } };

/** Runs SQL as mice_app with an AI actor (RLS + DB guards apply). */
async function asAi(tenantId: string, sql: string, params: unknown[]): Promise<unknown> {
  const c = new pg.Client({ connectionString: APP_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_type', 'ai', true)`, [tenantId]);
    return await c.query(sql, params);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
}

describe('Yönetişim', () => {
  it('G-01 §17.1 vekâlet penceresi: başlamadan önce ve bittikten sonra vekil karar veremez; süre içinde verir ve "vekil" işaretlenir', async () => {
    const w = await makeWorld(S, 'g1');
    const del = await w.admin.post('/api/delegations', { delegateId: w.user('ops').id, startsAt: '2026-11-23T06:00:00Z', endsAt: '2026-11-25T15:00:00Z' });
    expect(del.status).toBe(200);
    const p = await w.flow().intake();
    const c = await w.card('assignment', { projectId: p.id });
    expect((await w.decide(c, 'approve', { who: 'ops' })).status).toBe(403); // Cuma: henüz başlamadı
    setClock('2026-11-26T10:00');
    expect((await w.decide(c, 'approve', { who: 'ops' })).status).toBe(403); // bitti
    setClock('2026-11-24T10:00');
    const ok = await w.decide(c, 'approve', { who: 'ops' });
    expect(ok.body.decision.viaDelegation).toBe(true);
  });

  it('G-02 §17.1 vekil akreditasyon, kural / eşik / yetki değişikliği, otomasyon terfisi ve kontrol listesi kararı veremez; düşük skor (akreditasyon kararı) da yöneticide', async () => {
    const w = await makeWorld(S, 'g2');
    await w.admin.post('/api/delegations', { delegateId: w.user('ops').id, startsAt: '2026-11-19T00:00:00Z', endsAt: '2026-12-31T00:00:00Z' });
    expect((await w.ops.patch('/api/rules', { targetMarginMin: 0.05 })).body.error.code).toBe('ADMIN_ONLY');
    expect((await w.ops.patch(`/api/users/${w.user('clerk').id}`, { authorityLevel: 'full' })).status).toBe(403);
    await w.clerk.patch(`/api/suppliers/${w.supplier('galata')}`, { status: 'accredited', reason: 'x' });
    const acc = await w.card('supplier_accreditation', { entityId: w.supplier('galata') });
    expect((await w.decide(acc, 'approve', { who: 'ops' })).status).toBe(403);
    for (const kind of ['automation_promotion', 'checklist_question', 'rule_suggestion', 'low_supplier_score']) {
      const id = (await ownerSql(`INSERT INTO decisions (tenant_id, kind, badge, summary, detail, required_role, entity_type, entity_id, primary_action_label)
        VALUES ($1, $2, 'suggestion', 'test', $3, 'admin', 'supplier', $4, 'Onayla') RETURNING id`, [w.t.tenantId, kind, JSON.stringify({ actionType: 'team_assignment' }), w.supplier('moda')]))[0].id;
      expect(await w.cards({ who: 'ops' }).then((cs) => cs.some((x) => x.id === id))).toBe(false);
      expect((await w.decide({ id }, 'edit', { who: 'ops', edits: { status: 'passive' } })).status).toBe(403);
    }
    expect((await ownerSql('SELECT status FROM suppliers WHERE id = $1', [w.supplier('moda')]))[0].status).toBe('accredited');
  });

  it('G-03 §7.3 × §17.1 [ürün sahibi kararı] vekil marj altı teklifi açabilir ama açma kararı yalnız acenta yöneticisinin onayına sunulur', async () => {
    const w = await makeWorld(S, 'g3');
    await w.admin.post('/api/delegations', { delegateId: w.user('ops').id, startsAt: '2026-11-19T00:00:00Z', endsAt: '2026-12-31T00:00:00Z' });
    const p = await w.flow().as('ops').intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS).quote(undefined, { markup: 0.04 });
    // vekil teklifi hazırlayıp açabildi; marj altı kararı onun kutusunda yok, yöneticinin kutusunda
    expect(await w.cards({ kind: 'margin_override', entityId: p.quote.id, who: 'ops' })).toHaveLength(0);
    const c = await w.card('margin_override', { entityId: p.quote.id, who: 'admin' });
    const denied = await w.ops.post(`/api/decisions/${c.id}/decide`, { action: 'approve', reason: 'Yönetici ulaşılamıyor', biometric: { method: 'dev' } });
    expect(denied.status).toBe(403);
    const r = await w.decide(c, 'approve', { who: 'admin', reason: 'Stratejik müşteri' });
    expect(r.body.decision.viaDelegation).toBe(false);
  });

  it('G-04 §16 otomasyon terfisi: 20 düzeltmesiz onaydan sonra "otomatik yapayım mı?"; düzeltme sayacı sıfırlar; terfi → otomatik + ~1/20 örneklem; hatalı örneklem → otomatik geri dönüş', async () => {
    const w = await makeWorld(S, 'g4');
    const intakeAndDecide = async (action: 'approve' | 'edit') => {
      const p = await w.flow().intake(REQUEST_TEXT);
      const c = await w.card('assignment', { projectId: p.id });
      await w.decide(c, action, action === 'edit' ? { edits: { userId: w.user('admin').id } } : {});
      return p;
    };
    for (let i = 0; i < 5; i++) await intakeAndDecide('approve');
    await intakeAndDecide('edit'); // düzeltme = öğrenme verisi, sayaç sıfır
    for (let i = 0; i < 19; i++) await intakeAndDecide('approve');
    expect(await w.cards({ kind: 'automation_promotion' })).toHaveLength(0);
    await intakeAndDecide('approve');
    const promo = await w.card('automation_promotion');
    expect(promo.detail).toMatchObject({ actionType: 'team_assignment', consecutiveClean: 20 });
    await w.decide(promo, 'approve');
    rng.value = 0.5; // örneklem dışı
    const auto = await w.flow().intake(REQUEST_TEXT);
    expect((await auto.project()).ownerId).toBe(w.user('clerk').id);
    expect(await w.cards({ kind: 'assignment', projectId: auto.id })).toHaveLength(0);
    rng.value = 0.04; // < 0.05 → örneklem
    const sampled = await w.flow().intake(REQUEST_TEXT);
    const s = await w.card('audit_sample', { projectId: sampled.id });
    expect((await w.decide(s, 'reject', { reason: 'yanlış kişi' })).body.effects).toContain('automation_demoted:team_assignment');
    expect((await w.admin.get('/api/automation')).body.items.find((c: any) => c.actionType === 'team_assignment').mode).toBe('approval');
    expect(await w.cards({ kind: 'automation_demotion' })).toHaveLength(1);
    const rep = (await w.admin.get('/api/reports/weekly')).body.automation;
    expect(rep).toMatchObject({ autoCount: 2, sampled: 1, sampleErrors: 1, demotions: 1 });
  });

  it('G-05 [Ürün kararı] neverAutomateKinds: müşteri teklifi onayı 20+ temiz onayda bile terfi önerilmez ve terfi edilemez', async () => {
    const w = await makeWorld(S, 'g5');
    await ownerSql(`INSERT INTO automation_counters (tenant_id, action_type, threshold, sample_rate, consecutive_clean) VALUES ($1, 'customer_quote', 20, 0.05, 25)`, [w.t.tenantId]);
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).offers(OFFERS).quote().approveQuote();
    void p;
    expect(await w.cards({ kind: 'automation_promotion' })).toHaveLength(0);
    const id = (await ownerSql(`INSERT INTO decisions (tenant_id, kind, badge, summary, detail, required_role, primary_action_label) VALUES ($1,'automation_promotion','suggestion','x',$2,'admin','Otomatiğe al') RETURNING id`,
      [w.t.tenantId, JSON.stringify({ actionType: 'customer_quote' })]))[0].id;
    expect((await w.decide({ id }, 'approve')).body.error.code).toBe('NOT_PROMOTABLE');
  });

  it('G-06 §6 yasak işlemler veritabanında da engelli: AI aktörü akredite edemez, imza kaydedemez, ödeme onaylayamaz, kural yazamaz', async () => {
    const w = await makeWorld(S, 'g6');
    const p = await w.flow().signed();
    const prep = (await p.finance('payable'))[0];
    await expect(asAi(w.t.tenantId, `UPDATE suppliers SET status = 'accredited' WHERE id = $1`, [w.supplier('galata')])).rejects.toMatchObject({ code: 'MI006' });
    await expect(asAi(w.t.tenantId, `UPDATE contracts SET status = 'draft', locked = false WHERE id = $1`, [p.contracts.moda])).rejects.toThrow();
    await expect(asAi(w.t.tenantId, `UPDATE finance_entries SET status = 'approved' WHERE id = $1`, [prep.id])).rejects.toMatchObject({ code: 'MI006' });
    await expect(asAi(w.t.tenantId, `UPDATE rules SET value = '0.01' WHERE key = 'targetMarginMin'`, [])).rejects.toMatchObject({ code: 'MI006' });
    await expect(ownerSql('DELETE FROM projects WHERE id = $1', [p.id])).rejects.toThrow(/silinemez/);
  });

  it('G-07 §16.5 kural önerisi (tedarikçi × sezon) kanıtla gelir, yalnız yönetici uygular, sonraki değerlendirmede kullanılır', async () => {
    const w = await makeWorld(S, 'g7');
    const sid = w.supplier('bogaz');
    for (const [m, advs] of [['01', [0.18, 0.19, 0.2, 0.21]], ['02', [0.18, 0.19, 0.2, 0.21]], ['07', [0.05, 0.05]]] as const) {
      for (const [i, a] of advs.entries()) {
        const d = `2026-${m}-${String(10 + i).padStart(2, '0')}`;
        await ownerSql(`INSERT INTO channel_prices (tenant_id, supplier_id, stay_date, room_type, board, cancellation, price, currency, price_eur, source) VALUES ($1,$2,$3,'DBL','BB','flexible',200,'EUR',200,'test')`, [w.t.tenantId, sid, d]);
        await ownerSql(`INSERT INTO price_history (tenant_id, supplier_id, kind, description, service_date, room_type, board, unit, price_type, unit_price, currency, unit_price_eur, verified)
          VALUES ($1,$2,'accommodation','DBL',$3,'DBL','BB','room_night','negotiated',$4,'EUR',$4,true)`, [w.t.tenantId, sid, d, 200 * (1 - a)]);
      }
    }
    const jan = REQUEST_TEXT.replace('12-14 Mart 2027', '12-14 Ocak 2027');
    const before = await w.flow().intake(jan).offer('accommodation', 'bogaz', 150);
    const ev = async (p: typeof before) => (await w.clerk.get(`/api/items/${p.item('accommodation')}/comparison`)).body.evaluations[0];
    expect((await ev(before)).suggestedMarkup).toBe(0.05); // fiyat sınıfı bilinmiyor → en düşük kademe
    expect((await w.clerk.post('/api/rules/suggestions/run')).status).toBe(403);
    await w.admin.post('/api/rules/suggestions/run');
    const card = (await w.cards({ kind: 'rule_suggestion' })).find((c) => c.detail.suggestionKind === 'supplier_season_markup');
    expect(card.detail.evidence.rows.length).toBe(8);
    await w.decide(card, 'approve');
    const after = await w.flow().intake(jan).offer('accommodation', 'bogaz', 150);
    expect((await ev(after)).suggestedMarkup).toBe(0.2);
  });

  it('G-08 §16.6 / §17.10 haftalık rapor: teklif süresi mesai saatiyle (hafta sonu + tatil hariç), müşteri bekleme ayrı, hedef oranı', async () => {
    const w = await makeWorld(S, 'g8');
    await w.rules({ businessHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5], timezone: 'Europe/Istanbul', holidays: ['2026-11-18'] } });
    const run = async (received: string, sent: string, waitMin = 0) => {
      setClock(received);
      const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted', receivedAt: `${received}:00+03:00` }).offers(OFFERS);
      if (waitMin) await w.clerk.patch(`/api/projects/${p.id}`, { customerWaitMinutes: waitMin });
      setClock(sent);
      await p.flow().quote().send();
      return p;
    };
    await run('2026-11-16T09:00', '2026-11-17T13:00'); // 9 + 4 = 13 sa
    await run('2026-11-13T17:00', '2026-11-16T11:00', 60); // Cuma 1 + Pzt 2 = 3 sa − 1 sa bekleme = 2 sa
    await run('2026-11-17T17:00', '2026-11-19T12:00'); // Salı 1 + Çarşamba tatil + Perşembe 3 = 4 sa
    await run('2026-11-16T09:00', '2026-11-20T09:00'); // 9 + 9 + 0 + 9 = 27 sa > 18 hedef
    const r = (await w.admin.get('/api/reports/weekly?weekStart=2026-11-16')).body;
    expect(r.quoteTime).toMatchObject({ medianBusinessHours: 8.5, targetBusinessHours: 18, onTargetRate: 0.75, customerWaitHours: 1 });
  });
});
