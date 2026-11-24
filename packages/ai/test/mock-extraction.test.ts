import { describe, expect, it } from 'vitest';
import { MockAiService, budgetIsPerPerson } from '../src/index.js';
import { EN_REQUEST, TODAY, TR_REQUEST, TR_REQUEST_2 } from './fixtures.js';

const ai = new MockAiService();

describe('MockAiService.extractRequest — Turkish reference request', () => {
  it('extracts every field of the PRD sample with confidences', async () => {
    const r = await ai.extractRequest(TR_REQUEST, { channel: 'email', today: TODAY });
    const d = r.data;
    expect(r.action).toBe('request_extraction');
    expect(d.customerName.value).toBe('Acme İlaç');
    expect(d.eventType.value).toBe('toplantı');
    expect(d.startDate.value).toBe('2027-03-12');
    expect(d.endDate.value).toBe('2027-03-14');
    expect(d.pax.value).toBe(80);
    expect(d.roomsSgl.value).toBe(30);
    expect(d.roomsDbl.value).toBe(25);
    expect(d.district.value).toBe('Kadıköy');
    expect(d.city.value).toBe('İstanbul');
    expect(d.city.confidence).toBeLessThan(d.district.confidence); // inferred from district
    expect(d.hallLayout.value).toBe('tiyatro');
    expect(d.fnb.value).toContain('öğle yemeği');
    expect(d.fnb.value).toContain('2 coffee break');
    expect(d.transfer.value).toMatch(/havalimanı transferi/);
    expect(d.budget.value).toBe(250);
    expect(budgetIsPerPerson(d.budget)).toBe(true);
    expect(d.budgetCurrency.value).toBe('EUR');
    expect(d.language).toBe('tr');
    // absent fields: null + 0
    for (const k of ['technical', 'decisionDate', 'billingInfo', 'dateFlexibility'] as const) {
      expect(d[k].value).toBeNull();
      expect(d[k].confidence).toBe(0);
    }
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
    expect(d.pax.confidence).toBeGreaterThan(0.9);
  });

  it('is deterministic', async () => {
    const a = await ai.extractRequest(TR_REQUEST, { channel: 'email', today: TODAY });
    const b = await ai.extractRequest(TR_REQUEST, { channel: 'email', today: TODAY });
    expect(a).toEqual(b);
  });
});

describe('MockAiService.extractRequest — other samples', () => {
  it('English request with signature company, approx pax and reply-by date', async () => {
    const { data: d, confidence } = await ai.extractRequest(EN_REQUEST, { channel: 'email', today: TODAY });
    expect(d.language).toBe('en');
    expect(d.customerName.value).toBe('Globex Pharmaceuticals Ltd');
    expect(d.customerName.needsReview).toBe(true); // from signature → below threshold
    expect(d.startDate.value).toBe('2027-05-05');
    expect(d.endDate.value).toBe('2027-05-07');
    expect(d.pax.value).toBe(120);
    expect(d.pax.confidence).toBeLessThan(0.8); // "around"
    expect(d.roomsSgl.value).toBe(100);
    expect(d.roomsDbl.value).toBe(10);
    expect(d.city.value).toBe('Antalya');
    expect(d.district.value).toBe('Belek');
    expect(d.hallLayout.value).toBe('sınıf');
    expect(d.technical.value).toContain('LED ekran');
    expect(d.technical.value).toContain('ses sistemi');
    expect(d.budget.value).toBe(45000);
    expect(budgetIsPerPerson(d.budget)).toBe(false);
    expect(d.budgetCurrency.value).toBe('EUR');
    expect(d.decisionDate.value).toBe('2027-04-01');
    expect(confidence).toBeGreaterThan(0.7);
  });

  it('DD.MM.YYYY range, Turkish room words, flexibility, decision date, billing', async () => {
    const { data: d } = await ai.extractRequest(TR_REQUEST_2, { channel: 'email', today: TODAY });
    expect(d.startDate.value).toBe('2027-10-15');
    expect(d.endDate.value).toBe('2027-10-17');
    expect(d.eventType.value).toBe('bayi toplantısı');
    expect(d.pax.value).toBe(150);
    expect(d.pax.needsReview).toBe(true);
    expect(d.roomsSgl.value).toBe(50);
    expect(d.roomsDbl.value).toBe(50);
    expect(d.city.value).toBe('İzmir');
    expect(d.city.confidence).toBeGreaterThanOrEqual(0.9); // explicit city + district
    expect(d.district.value).toBe('Çeşme');
    expect(d.hallLayout.value).toBe('U');
    expect(d.fnb.value).toContain('gala yemeği');
    expect(d.technical.value).toContain('projeksiyon');
    expect(d.technical.value).toContain('mikrofon');
    expect(d.dateFlexibility.value).toMatch(/esneklik/);
    expect(d.decisionDate.value).toBe('2027-08-01');
    expect(d.billingInfo.value).toMatch(/Beta Enerji/);
    expect(d.customerName.value).toBe('Beta Enerji A.Ş.');
    expect(d.budget.value).toBeNull();
  });

  it('year inference: month/day without year resolves to the next future occurrence', async () => {
    const { data: d } = await ai.extractRequest('Kadıköy, 40 kişi, 12 Mart, iki gün toplantı', { channel: 'voice', today: TODAY });
    expect(d.startDate.value).toBe('2027-03-12');
    expect(d.endDate.value).toBe('2027-03-13'); // two-day meeting
    expect(d.startDate.confidence).toBeLessThan(0.95); // year inferred
    expect(d.pax.value).toBe(40);
    const { data: d2 } = await ai.extractRequest('5 Ekim toplantı 20 kişi', { channel: 'phone_note', today: '2026-03-01' });
    expect(d2.startDate.value).toBe('2026-10-05');
  });

  it('WhatsApp-style short note with Ankara and banquet, budget in TL', async () => {
    const { data: d } = await ai.extractRequest('Selam, 3 Haziran akşamı Ankara Çankaya da 200 kişilik gala, banket düzen. bütçe 1.500.000 TL civarı', { channel: 'whatsapp', today: TODAY });
    expect(d.eventType.value).toBe('gala');
    expect(d.city.value).toBe('Ankara');
    expect(d.district.value).toBe('Çankaya');
    expect(d.hallLayout.value).toBe('banket');
    expect(d.pax.value).toBe(200);
    expect(d.budget.value).toBe(1500000);
    expect(d.budgetCurrency.value).toBe('TRY');
    expect(d.startDate.value).toBe('2027-06-03');
    expect(d.endDate.value).toBeNull();
  });

  it('cross-month range and English month-first dates', async () => {
    const { data: d } = await ai.extractRequest('Conference in Istanbul, 30 March - 2 April 2027, 300 pax, theatre style.', { channel: 'email', today: TODAY });
    expect(d.startDate.value).toBe('2027-03-30');
    expect(d.endDate.value).toBe('2027-04-02');
    expect(d.eventType.value).toBe('konferans');
    expect(d.hallLayout.value).toBe('tiyatro');
    expect(d.city.value).toBe('İstanbul');
  });

  it('basic Russian request', async () => {
    const { data: d } = await ai.extractRequest('Здравствуйте! Планируем конференцию в Бодруме 10-12 мая 2027 года, 60 человек, театральная рассадка.', { channel: 'email', today: TODAY });
    expect(d.language).toBe('ru');
    expect(d.startDate.value).toBe('2027-05-10');
    expect(d.endDate.value).toBe('2027-05-12');
    expect(d.pax.value).toBe(60);
    expect(d.hallLayout.value).toBe('tiyatro');
  });

  it('uses knownCustomers and returns low confidence for non-requests', async () => {
    const r = await ai.extractRequest('Merhaba, Acme ekibi olarak yarın sizi arayacağız.', { channel: 'email', today: TODAY, knownCustomers: ['Acme İlaç', 'Acme'] });
    expect(r.data.customerName.value).toBe('Acme');
    const empty = await ai.extractRequest('Teşekkürler, iyi günler.', { channel: 'email', today: TODAY });
    expect(empty.confidence).toBeLessThan(0.5);
    expect(empty.data.pax.value).toBeNull();
  });

  it('does not take a city from unrelated words (bölüm ≠ Bolu, Marmaris month guard)', async () => {
    const { data: d } = await ai.extractRequest('Bu bölümde 12 Marmaris otelinde 50 kişi', { channel: 'email', today: TODAY });
    expect(d.city.value).toBe('Muğla');
    expect(d.district.value).toBe('Marmaris');
    expect(d.startDate.value).toBeNull();
  });
});
