import { describe, expect, it } from 'vitest';
import { MockAiService, type DraftRequest } from '../src/index.js';
import { TODAY } from './fixtures.js';

const ai = new MockAiService();
const base = { senderName: 'Ali Demir', facts: { startDate: '2027-03-12', endDate: '2027-03-14', pax: 80, district: 'Kadıköy', city: 'İstanbul' } };

describe('MockAiService.draftMessage', () => {
  const kinds: DraftRequest['kind'][] = ['missing_info', 'rfq', 'rfq_reminder', 'negotiation', 'quote_cover', 'quote_followup', 'option_extension', 'revision_request', 'supplier_confirmation', 'daily_summary', 'other'];
  for (const kind of kinds) {
    for (const language of ['tr', 'en', 'ru'] as const) {
      it(`${kind}/${language}: short, signed, no AI mention`, async () => {
        const r = await ai.draftMessage({ ...base, kind, language, recipientName: 'Ayşe' });
        expect(r.data.body).toContain('Ali Demir');
        expect(r.data.body).toContain('Ayşe');
        expect(r.data.body.split('\n').length).toBeLessThanOrEqual(14);
        expect(r.data.body.length).toBeLessThan(700);
        expect(r.data.body).not.toMatch(/yapay zek|\bAI\b|assistant/i);
        expect(r.confidence).toBeGreaterThan(0.8);
      });
    }
  }

  it('maps draft kinds to §6 actions', async () => {
    expect((await ai.draftMessage({ ...base, kind: 'missing_info', language: 'tr' })).action).toBe('customer_missing_info_question');
    expect((await ai.draftMessage({ ...base, kind: 'negotiation', language: 'tr' })).action).toBe('negotiation_message');
    expect((await ai.draftMessage({ ...base, kind: 'supplier_confirmation', language: 'tr' })).action).toBe('draft_generation');
  });

  it('Turkish date formatting and missing-info questions', async () => {
    const r = await ai.draftMessage({ ...base, kind: 'missing_info', language: 'tr', facts: { ...base.facts, missingQuestions: ['Oda dağılımı (SGL/DBL) nasıl olacak?', 'Bütçe aralığınız nedir?'] } });
    expect(r.data.subject).toContain('12–14 Mart 2027');
    expect(r.data.body).toContain('- Bütçe aralığınız nedir?');
    expect(r.data.body).not.toMatch(/EUR|TL/);
  });

  it('negotiation uses only allowed arguments and never competitor prices', async () => {
    const r = await ai.draftMessage({
      ...base, kind: 'negotiation', language: 'tr', recipientName: 'Mehmet Bey',
      facts: { ...base.facts, arguments: ['volume', 'relationship', 'competitor_price'], competitorPrices: [{ supplier: 'X Otel', price: 95 }], rakipFiyat: 99, targetUnitPrice: 110, currency: 'EUR' },
    });
    expect(r.data.body).toMatch(/toplam hacim/);
    expect(r.data.body).toMatch(/birlikte çalışıyoruz/);
    expect(r.data.body).toContain('110 EUR');
    expect(r.data.body).not.toMatch(/X Otel|95|99|rakip|competitor/i);
  });

  it('adopts greeting and closing from the owner style examples', async () => {
    const r = await ai.draftMessage({
      ...base, kind: 'rfq_reminder', language: 'tr', recipientName: 'Selin',
      styleExamples: [{ before: 'Merhaba Selin,\n\nUzun metin...\n\nİyi çalışmalar,\nAli', after: 'Selam Selin!\n\nKısa metin.\n\nKolay gelsin,\nAli' }],
    });
    expect(r.data.body.startsWith('Selam Selin!')).toBe(true);
    expect(r.data.body).toContain('Kolay gelsin,');
  });

  it('daily summary has at most 3 lines of content', async () => {
    const r = await ai.draftMessage({ ...base, kind: 'daily_summary', language: 'tr', facts: { projectCode: 'PRJ-0001', summaryLines: ['a', 'b', 'c', 'd'] } });
    expect(r.data.body.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(3);
  });
});

describe('MockAiService.ask', () => {
  const facts = { customer: 'Acme İlaç', lastYear: { hotel: 'Kadıköy Grand Otel', unitPrice: 120, currency: 'EUR', pax: 80 }, optionUntil: '2027-02-15' };
  it('answers from facts with used fact paths', async () => {
    const r = await ai.ask({ question: 'Bu müşteriyle geçen yıl hangi otelde çalıştık?', contextLabel: 'project', facts });
    expect(r.data.answer).toContain('Kadıköy Grand Otel');
    expect(r.data.usedFacts).toContain('lastYear.hotel');
  });
  it('opsiyon question', async () => {
    const r = await ai.ask({ question: 'Opsiyon ne zaman bitiyor?', contextLabel: 'project', facts });
    expect(r.data.answer).toContain('2027-02-15');
  });
  it('says "Bu konuda veri yok" when facts do not cover it', async () => {
    const r = await ai.ask({ question: 'Transfer firması kim?', contextLabel: 'project', facts });
    expect(r.data.answer).toMatch(/^Bu konuda veri yok/);
    expect(r.data.usedFacts).toEqual([]);
  });
});

describe('MockAiService.interpretCommand', () => {
  it('recognises "... proje aç"', async () => {
    const r = await ai.interpretCommand('Kadıköy, 40 kişi, 12 Mart, iki gün toplantı, proje aç', TODAY);
    expect(r.data.intent).toBe('create_project');
    expect(r.data.requestText).toBe('Kadıköy, 40 kişi, 12 Mart, iki gün toplantı');
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    const e = await ai.interpretCommand('Create a new project: Antalya 100 pax May', TODAY);
    expect(e.data.intent).toBe('create_project');
  });
  it('recognises questions and unknown', async () => {
    expect((await ai.interpretCommand('Acme ile geçen yıl kaça çalıştık?', TODAY)).data.intent).toBe('ask');
    expect((await ai.interpretCommand('hmm tamam', TODAY)).data.intent).toBe('unknown');
  });
});

describe('MockAiService.suggestChecklistQuestions / summarizeStyle', () => {
  it('turns lessons into new, non-duplicate checklist questions', async () => {
    const r = await ai.suggestChecklistQuestions('Vejetaryen katılımcıları son gün öğrendik. Simultane çeviri ihtiyacı geç geldi. Fatura bilgisi eksikti.', 'kongre', ['Fatura bilgileri (unvan, vergi dairesi / no, adres) nedir?']);
    const qs = r.data.map((q) => q.question);
    expect(qs.some((q) => /diyet/.test(q))).toBe(true);
    expect(qs.some((q) => /Simultane/.test(q))).toBe(true);
    expect(qs.some((q) => /Fatura/.test(q))).toBe(false);
    expect(r.action).toBe('checklist_new_question');
  });
  it('summarizes style corrections', async () => {
    const r = await ai.summarizeStyle([
      { before: 'Merhaba Ayşe Hanım,\nTeklifimizi ekte bulabilirsiniz. Her türlü sorunuz için bize ulaşabilirsiniz.\nSaygılarımızla', after: 'Selam Ayşe,\nTeklif ekte.\nAli' },
      { before: 'Merhaba Selin Hanım,\nOpsiyon uzatımı konusunda bilgilerinize sunarız. Her türlü sorunuz için bize ulaşabilirsiniz.', after: 'Selam Selin,\nOpsiyonu 3 gün uzatabilir misin?' },
    ], 'tr');
    expect(r.data.summary).toMatch(/kısaltıldı/);
    expect(r.data.summary).toMatch(/Selam/);
  });
});
