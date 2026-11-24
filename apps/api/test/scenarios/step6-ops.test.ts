// Senaryolar — §7 Adım 6 Operasyon takibi, §17.1 / §17.7 saha ekstraları, §17.9 KVKK (docs/10-senaryolar.md S6-xx)
import { describe, expect, it } from 'vitest';
import { makeWorld, ownerSql, scenarioSuite, setClock, type World } from './_scenario.js';

const S = scenarioSuite();
let w: World;
const world = async () => (w ??= await makeWorld(S, 's6'));

describe('Adım 6 — operasyon', () => {
  it('S6-01 §7.6 sözleşme tarihlerinden takvim: kalem türüne göre görevler, sorumlu role atanır (transfer yoksa transfer listesi yok)', async () => {
    const w = await world();
    const p = await w.flow().signed();
    const tasks = await p.tasks();
    const kinds = new Set(tasks.map((t) => t.kind));
    for (const k of ['final_pax', 'attrition', 'rooming_list', 'menu_approval', 'tech_brief', 'payment_due', 'event_day_checklist']) expect(kinds.has(k)).toBe(true);
    expect(kinds.has('transfer_list')).toBe(false);
    expect(tasks.find((t) => t.kind === 'rooming_list')).toMatchObject({ assigneeId: w.user('ops').id });
    expect(tasks.find((t) => t.kind === 'rooming_list').dueAt.slice(0, 10)).toBe('2027-03-02');
    expect(tasks.find((t) => t.kind === 'payment_due').assigneeId).toBe(w.user('finance').id);
    expect(tasks.find((t) => t.kind === 'event_day_checklist').assigneeId).toBe(w.user('field').id);
  });

  it('S6-02 §17.9 rooming listesi: rıza verenin verisi saklanır, vermeyenin süre sonunda anonimleşir; ekip rızayı geri çekebilir', async () => {
    const w = await world();
    const p = await w.flow().signed();
    const url = (await w.ops.post(`/api/projects/${p.id}/rooming-link`)).body.url as string;
    const tok = url.split('/r/')[1];
    expect((await w.pub.post(`/api/public/rooming/${tok}`, { guests: [
      { fullName: 'Ayla Rızalı', email: 'ayla@example.com', roomType: 'DBL', consentReuse: true },
      { fullName: 'Bora Rızasız', roomType: 'SGL', consentReuse: false },
      { fullName: 'Cem Geriçeker', email: 'cem@example.com', roomType: 'SGL', consentReuse: true },
    ] })).body).toEqual({ ok: true, saved: 3 });
    const guests = (await w.ops.get(`/api/projects/${p.id}/guests`)).body.items;
    expect((await w.finance.get(`/api/projects/${p.id}/guests`)).body.items[0].fullName).toContain('***');
    const cem = guests.find((g: any) => g.fullName === 'Cem Geriçeker');
    expect((await w.ops.post(`/api/guests/${cem.id}/withdraw-consent`, {})).status).toBe(200);
    expect((await w.worker('2029-03-13T09:00')).some((x) => x.startsWith('guests_anonymized'))).toBe(false); // son saklama günü (bitiş + 730 gün)
    expect(await w.worker('2029-03-14T09:00')).toContain('guests_anonymized:2');
    const after = (await w.ops.get(`/api/projects/${p.id}/guests`)).body.items.map((g: any) => g.fullName).sort();
    expect(after).toEqual(['Ayla Rızalı', '[anonim]', '[anonim]']);
  });

  it('S6-03 §17.1 saha ekstra limitleri dahil: kalem 5.000 TL / proje 15.000 TL saha kararı; 5.000,01 ve 15.000 üstü yönetici; reddedilen toplamı düşürür', async () => {
    const w = await world();
    const p = await w.flow().signed();
    const add = async (amountTry: number) => (await w.field.post(`/api/projects/${p.id}/field-extras`, { description: `ekstra ${amountTry}`, amountTry })).body;
    expect((await add(5000)).needsAdminApproval).toBe(false);
    const over = await add(5000.01);
    expect(over.needsAdminApproval).toBe(true);
    const c = await w.card('field_extra', { entityId: over.id });
    expect((await w.decide(c, 'reject', { reason: 'gereksiz' })).body.effects).toContain('field_extra_rejected');
    expect((await add(5000)).needsAdminApproval).toBe(false);
    expect((await add(5000)).needsAdminApproval).toBe(false); // 15.000 dahil
    expect((await add(1)).needsAdminApproval).toBe(true);
  });

  it('S6-04 §17.7 müşteri onay linki: kişi/zaman/tutar kaydı; 30 gün sonra link geçersiz; çevrimdışı tekrar gönderim idempotent', async () => {
    const w = await world();
    const p = await w.flow().signed();
    const a = (await w.field.post(`/api/projects/${p.id}/field-extras`, { description: 'Ek kahve', amountTry: 1500, customerPhone: '+90 532 000 11 22', clientId: 'off-1' })).body;
    const again = (await w.field.post(`/api/projects/${p.id}/field-extras`, { description: 'Ek kahve', amountTry: 1500, clientId: 'off-1' })).body;
    expect(again.id).toBe(a.id);
    expect(w.mails.some((m) => m.channel === 'sms' && m.to === '+90 532 000 11 22')).toBe(true);
    const tok = a.approvalLink.split('/e/')[1];
    const b = (await w.field.post(`/api/projects/${p.id}/field-extras`, { description: 'Ek su', amountTry: 300 })).body;
    expect((await w.pub.post(`/api/public/extras/${tok}/approve`, { approverName: 'Burak Şahin' })).body).toEqual({ ok: true });
    setClock('2026-12-21T10:00');
    expect((await w.pub.get(`/api/public/extras/${b.approvalLink.split('/e/')[1]}`)).status).toBe(410);
    const row = (await ownerSql('SELECT customer_approver_name, customer_approved_amount_try FROM field_extras WHERE id = $1', [a.id]))[0];
    expect(row.customer_approver_name).toBe('Burak Şahin');
    expect(Number(row.customer_approved_amount_try)).toBe(1500);
  });

  it('S6-05 §7.6 yansıtma kararı: yansıtılmazsa gerekçe zorunlu; yansıtılmayan toplamlar proje / müşteri bazında ve haftalık raporda', async () => {
    const w = await makeWorld(S, 's6b');
    const p = await w.flow().signed();
    const e1 = (await w.field.post(`/api/projects/${p.id}/field-extras`, { description: 'İkram', amountTry: 4850 })).body;
    const e2 = (await w.field.post(`/api/projects/${p.id}/field-extras`, { description: 'Ek mikrofon', amountTry: 970 })).body;
    expect((await w.ops.post(`/api/field-extras/${e1.id}/reflect`, { reflected: false })).body.error.code).toBe('REASON_REQUIRED');
    await w.ops.post(`/api/field-extras/${e1.id}/reflect`, { reflected: false, reason: 'Müşteri ilişkisi' });
    await w.ops.post(`/api/field-extras/${e2.id}/reflect`, { reflected: true });
    const tot = (await w.admin.get('/api/field-extras/unreflected-totals')).body;
    expect(tot.byProject).toEqual([expect.objectContaining({ projectId: p.id, amountTry: 4850, amountEur: 100 })]);
    expect(tot.byCustomer[0]).toMatchObject({ customerId: w.customer('trusted'), amountTry: 4850 });
    expect((await w.admin.get('/api/reports/weekly')).body.unreflectedPriceDiffEur).toBe(100);
  });

  it('S6-06 §7.6 günlük 3 satırlık özet; etkinlik günü 18:00 sonrası müşteri taslağı (insan gönderir) + yönetici bildirimi', async () => {
    const w = await makeWorld(S, 's6c');
    const p = await w.flow().signed();
    setClock('2027-03-12T11:00');
    await w.field.post(`/api/projects/${p.id}/field-issues`, { description: 'Projeksiyon arızası', severity: 'high', supplierId: w.supplier('moda') });
    expect((await w.admin.get(`/api/projects/${p.id}/daily-summary`)).body.lines).toHaveLength(3);
    expect((await w.worker('2027-03-12T17:30')).some((x) => x.startsWith('daily_summary'))).toBe(false);
    expect((await w.worker('2027-03-12T18:30')).some((x) => x.startsWith('daily_summary'))).toBe(true);
    // (günde bir kez: NOT EXISTS kontrolü DB now() ile yazılan created_at'e bakar — test saati ileri alındığı için burada doğrulanmaz)
    const d = (await p.drafts('daily_summary'))[0];
    expect(d.status).toBe('draft');
    expect(d.body.split('\n')).toHaveLength(3);
    expect(d.body).toContain('Projeksiyon');
  });

  it('S6-07 §7.6 değişiklik akışı: sözleşmeli kalem değişince tedarikçi bildirimi taslağı (onaylı) + marj eşik altına düşerse yönetici kartı', async () => {
    const w = await world();
    const p = await w.flow().signed();
    await w.admin.patch(`/api/items/${p.item('accommodation')}`, { quantity: 110 });
    const c = (await w.cards({ kind: 'condition_risk', projectId: p.id })).find((x) => x.entityId === p.item('accommodation'));
    expect(c.detail.impactIfNotReflected.belowTarget).toBe(true);
    const notice = (await p.drafts()).find((d) => d.subject?.includes('değişiklik bildirimi'));
    expect(notice.status).toBe('draft');
    expect((await w.admin.post(`/api/drafts/${notice.id}/send`)).body.error.code).toBe('DRAFT_NOT_APPROVED');
  });
});
