import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AiError, ClaudeAiService, type AnthropicLike } from '../src/index.js';
import { TODAY, TR_REQUEST } from './fixtures.js';

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

function fakeClient(reply: unknown | ((p: Params) => unknown), extra: Partial<Anthropic.Beta.BetaMessage> = {}) {
  const calls: Params[] = [];
  const client: AnthropicLike = {
    beta: {
      messages: {
        async create(p: Params) {
          calls.push(p);
          const data = typeof reply === 'function' ? (reply as (p: Params) => unknown)(p) : reply;
          return {
            id: 'msg_1', type: 'message', role: 'assistant', model: p.model, stop_reason: 'end_turn', stop_sequence: null,
            content: [{ type: 'text', text: JSON.stringify(data), citations: null }],
            usage: { input_tokens: 200, output_tokens: 120, cache_read_input_tokens: 1500, cache_creation_input_tokens: 0 },
            ...extra,
          } as unknown as Anthropic.Beta.BetaMessage;
        },
      },
    },
  };
  return { client, calls };
}
const userText = (p: Params) => (p.messages[0].content as Anthropic.Beta.BetaContentBlockParam[])
  .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === 'text').map((b) => b.text).join('\n');

const F = (value: unknown, confidence = 0.95, evidence: string | null = null) => ({ value, confidence, evidence });
const requestReply = {
  customerName: F('Acme İlaç', 0.95, 'Firma: Acme İlaç'), eventType: F('toplantı'), startDate: F('2027-03-12'), endDate: F('2027-03-14'),
  dateFlexibility: F(null, 0), pax: F(80), roomsSgl: F(30), roomsDbl: F(25), city: F('İstanbul', 0.85), district: F('Kadıköy'),
  hallLayout: F('tiyatro'), fnb: F('öğle yemeği, 2 coffee break', 0.9), technical: F(null, 0), transfer: F('havalimanı transferi', 0.9),
  budget: F(250, 0.9, 'Bütçe kişi başı 250 EUR'), budgetPerPerson: true, budgetCurrency: F('EUR'), decisionDate: F('2027-13-45', 0.6),
  billingInfo: F('İletişim: [EMAIL_1]', 0.7), language: 'tr', overallConfidence: 0.8,
};

describe('ClaudeAiService request construction', () => {
  it('extractRequest: model, cached system prompt, json_schema output, effort, fallback beta, masking', async () => {
    const { client, calls } = fakeClient(requestReply);
    const ai = new ClaudeAiService({ client });
    const r = await ai.extractRequest(`${TR_REQUEST}\nİletişim: ayse@acme.com, 0532 123 45 67`, { channel: 'email', today: TODAY, knownCustomers: ['Acme İlaç'] });
    const p = calls[0];
    expect(p.model).toBe('claude-sonnet-5-5');
    expect(Array.isArray(p.system)).toBe(true);
    const sys = (p.system as Anthropic.Beta.BetaTextBlockParam[])[0];
    expect(sys.cache_control).toEqual({ type: 'ephemeral' });
    expect(sys.text).not.toContain(TODAY); // static → cacheable
    expect(p.output_config?.format?.type).toBe('json_schema');
    expect((p.output_config?.format?.schema as { required: string[] }).required).toContain('pax');
    expect(p.output_config?.effort).toBe('medium');
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(p.fallbacks).toBe('default');
    expect(p.tool_choice).toBeUndefined();
    expect(p.thinking).toBeUndefined();
    const ut = userText(p);
    expect(ut).toContain(`TODAY: ${TODAY}`);
    expect(ut).toContain('KNOWN CUSTOMERS: Acme İlaç');
    expect(ut).not.toContain('ayse@acme.com');
    expect(ut).not.toContain('0532 123 45 67');
    expect(ut).toContain('[EMAIL_1]');

    // output mapping
    expect(r.model).toBe('claude-sonnet-5-5');
    expect(r.tokens).toEqual({ input: 200, output: 120, cacheRead: 1500, cacheWrite: 0 });
    expect(r.data.pax).toMatchObject({ value: 80, confidence: 0.95, needsReview: false });
    expect(r.data.budget.source).toMatch(/^kişi başı/);
    expect(r.data.decisionDate).toMatchObject({ value: null, confidence: 0 }); // invalid date rejected
    expect(r.data.billingInfo.value).toBe('İletişim: ayse@acme.com'); // pseudonym restored
    expect(r.data.city.needsReview).toBe(false);
    expect(r.confidence).toBeLessThanOrEqual(0.8); // capped by self-report
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('parseSupplierOffer: PDF as base64 document block, image as image block, CSV as masked text', async () => {
    const reply = {
      supplierName: 'Grand Otel', currency: 'EUR', lines: [{ description: 'Oda DBL', kind: 'accommodation', quantity: 25, unit: 'oda', nights: 2, unitPrice: 120, vatIncluded: true, vatRate: 10, accommodationTaxIncluded: false, roomType: 'DBL', board: 'BB', confidence: 0.9 }],
      optionUntil: '2027-02-15', guaranteePax: 70, attritionTerms: null, paymentTerms: '%30 ön ödeme', prepaymentRate: 30, cancellationTerms: null, overtimeTerms: null, notes: null,
      fieldConfidence: { supplierName: 0.9, currency: 0.95, lines: 0.95, vat: 0.9, optionUntil: 0.9, guaranteePax: 0.8, attritionTerms: 0, paymentTerms: 0.9, prepaymentRate: 0.9, cancellationTerms: 0, overtimeTerms: 0 },
      overallConfidence: 0.95,
    };
    const { client, calls } = fakeClient(reply);
    const ai = new ClaudeAiService({ client });
    const r = await ai.parseSupplierOffer({ file: { filename: 'teklif.pdf', mimeType: 'application/pdf', base64: 'JVBERi0x\nLjQK' }, today: TODAY, itemKind: 'accommodation' });
    const content = calls[0].messages[0].content as Anthropic.Beta.BetaContentBlockParam[];
    expect(content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQK' } });
    expect(content.at(-1)).toMatchObject({ type: 'text' });
    expect(calls[0].max_tokens).toBeGreaterThanOrEqual(8000);
    expect(r.data.prepaymentRate).toBe(0.3); // percent normalised to fraction
    expect(r.data.lines[0]).toMatchObject({ kind: 'accommodation', quantity: 25, nights: 2, roomType: 'DBL' });
    expect(r.data.fieldConfidence.lines).toBe(0.9); // capped by line confidences
    expect(r.action).toBe('document_reading');

    await ai.parseSupplierOffer({ file: { filename: 'foto.jpg', mimeType: 'image/jpg', base64: '/9j/4AAQ' }, today: TODAY });
    expect((calls[1].messages[0].content as Anthropic.Beta.BetaContentBlockParam[])[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });

    const csv = Buffer.from('Kalem;Fiyat\nOda;120 EUR\nİletişim;satis@otel.com', 'utf8').toString('base64');
    await ai.parseSupplierOffer({ file: { filename: 'teklif.csv', mimeType: 'text/csv', base64: csv }, today: TODAY });
    const t = userText(calls[2]);
    expect(t).toContain('Oda;120 EUR');
    expect(t).not.toContain('satis@otel.com');

    await expect(ai.parseSupplierOffer({ file: { filename: 'x.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: 'UEsDB' }, today: TODAY }))
      .rejects.toMatchObject({ code: 'unsupported_input' });
  });

  it('KVKK switch: binary documents can be disabled', async () => {
    const { client } = fakeClient({});
    const ai = new ClaudeAiService({ client, allowBinaryDocuments: false });
    await expect(ai.parseInvoice({ file: { filename: 'f.pdf', mimeType: 'application/pdf', base64: 'JVBE' }, today: TODAY })).rejects.toMatchObject({ code: 'pii_unmaskable' });
  });

  it('parseInvoice: inconsistent totals lower confidence', async () => {
    const { client } = fakeClient({
      invoiceNo: 'A1', supplierName: 'ABC Turizm A.Ş.', issueDate: '2027-03-20', dueDate: null, currency: 'TRY', netAmount: 1000, vatAmount: 200, totalAmount: 1300, lines: [],
      fieldConfidence: { invoiceNo: 0.95, supplierName: 0.95, issueDate: 0.95, dueDate: 0, currency: 0.95, netAmount: 0.95, vatAmount: 0.95, totalAmount: 0.95, lines: 0 }, overallConfidence: 0.95,
    });
    const r = await new ClaudeAiService({ client }).parseInvoice({ text: 'Fatura', today: TODAY });
    expect(r.data.fieldConfidence.totalAmount).toBe(0.5);
    expect(r.confidence).toBeLessThan(0.9);
  });

  it('parseContract maps fields and validates enums', async () => {
    const { client } = fakeClient({
      supplierName: 'Grand Otel', customerName: null, billingInfo: null, startDate: '2027-03-12', endDate: '2027-03-14', pax: 80, guaranteePax: 70,
      rooms: [{ type: 'DBL', count: 25, nights: 2, unitPrice: 120 }], menu: null, hall: 'Balo salonu', unitPrices: [], vatSeparated: true, accommodationTaxSeparated: null,
      currency: 'XYZ', totalAmount: 6000, paymentTerms: null, prepaymentRate: 0.3, cancellationTerms: null, attritionTerms: null, optionDate: null,
      fieldConfidence: { supplierName: 0.9, customerName: 0, startDate: 0.9, endDate: 0.9, pax: 0.9, lines: 0.9, currency: 0, totalAmount: 0.9, paymentTerms: 0, cancellationTerms: 0, vat: 0.9 }, overallConfidence: 0.9,
    });
    const r = await new ClaudeAiService({ client }).parseContract({ text: 'Sözleşme', today: TODAY });
    expect(r.data.currency).toBeNull();
    expect(r.data.rooms).toEqual([{ type: 'DBL', count: 25, nights: 2, unitPrice: 120 }]);
    expect(r.confidence).toBeLessThan(0.9);
  });

  it('draftMessage: strips competitor facts, masks names, restores them, uses owner style examples', async () => {
    const { client, calls } = fakeClient((p: Params) => {
      const t = userText(p);
      const rec = /RECIPIENT: (\[PERSON_\d\])/.exec(t)?.[1];
      const snd = /SENDER: (\[PERSON_\d\])/.exec(t)?.[1];
      return { subject: 'Fiyat hakkında', body: `Merhaba ${rec},\n\nGrup büyüklüğünü düşünürsek 110 EUR mümkün mü?\n\nKolay gelsin,\n${snd}`, confidence: 0.9 };
    });
    const ai = new ClaudeAiService({ client });
    const r = await ai.draftMessage({
      kind: 'negotiation', language: 'tr', senderName: 'Ali Demir', recipientName: 'Mehmet Yılmaz',
      facts: { arguments: ['volume', 'competitor_price'], competitorPrices: [{ hotel: 'X Otel', price: 95 }], targetUnitPrice: 110, contactName: 'Mehmet Yılmaz' },
      styleExamples: [{ before: 'Merhaba Mehmet Bey, uzun metin', after: 'Selam Mehmet, kısa' }],
    });
    const t = userText(calls[0]);
    expect(t).not.toMatch(/X Otel|95|competitor/);
    expect(t).toContain('ALLOWED ARGUMENTS: ["volume"]');
    expect(t).not.toContain('Mehmet Yılmaz');
    expect(t).not.toContain('Ali Demir');
    expect(t).toContain('OWNER STYLE EXAMPLES');
    expect(calls[0].output_config?.format?.type).toBe('json_schema');
    expect(r.data.body).toContain('Merhaba Mehmet Yılmaz,');
    expect(r.data.body).toContain('Ali Demir');
    expect(r.action).toBe('negotiation_message');
    expect(r.confidence).toBe(0.9);
  });

  it('draftMessage: a draft that reveals AI is flagged with low confidence', async () => {
    const { client } = fakeClient({ subject: null, body: 'Merhaba, yapay zeka asistanı olarak yazıyorum.', confidence: 0.95 });
    const r = await new ClaudeAiService({ client }).draftMessage({ kind: 'other', language: 'tr', senderName: 'Ali', facts: {} });
    expect(r.confidence).toBeLessThanOrEqual(0.3);
  });

  it('ask: unanswerable → "Bu konuda veri yok."', async () => {
    const { client, calls } = fakeClient({ answerable: false, answer: 'I think maybe 100', usedFacts: ['x'] });
    const r = await new ClaudeAiService({ client }).ask({ question: 'Transfer firması kim?', contextLabel: 'project', facts: { guestName: 'Can Demir', pax: 80 } });
    expect(r.data).toEqual({ answer: 'Bu konuda veri yok.', usedFacts: [] });
    expect(userText(calls[0])).not.toContain('Can Demir');
    expect(calls[0].output_config?.effort).toBe('low');
  });

  it('interpretCommand uses the fast model without fallback beta', async () => {
    const { client, calls } = fakeClient({ intent: 'create_project', requestText: 'Kadıköy, 40 kişi, 12 Mart', question: null, confidence: 0.93 });
    const r = await new ClaudeAiService({ client }).interpretCommand('Kadıköy, 40 kişi, 12 Mart, proje aç', TODAY);
    expect(calls[0].model).toBe('claude-haiku-5-5');
    expect(calls[0].betas).toBeUndefined();
    expect(calls[0].fallbacks).toBeUndefined();
    expect(r.data).toEqual({ intent: 'create_project', requestText: 'Kadıköy, 40 kişi, 12 Mart' });
    expect(r.confidence).toBe(0.93);
  });

  it('suggestChecklistQuestions / summarizeStyle shape', async () => {
    const a = fakeClient({ questions: [{ question: 'Diyet ihtiyacı var mı?', field: 'fnb' }, { question: '', field: null }], confidence: 0.8 });
    const r = await new ClaudeAiService({ client: a.client }).suggestChecklistQuestions('vejetaryen', 'kongre', []);
    expect(r.data).toEqual([{ question: 'Diyet ihtiyacı var mı?', field: 'fnb' }]);
    const b = fakeClient({ summary: 'Daha kısa.' });
    expect((await new ClaudeAiService({ client: b.client }).summarizeStyle([{ before: 'a', after: 'b' }], 'tr')).data.summary).toBe('Daha kısa.');
  });

  it('fallbacks can be disabled; custom models honoured', async () => {
    const { client, calls } = fakeClient(requestReply);
    await new ClaudeAiService({ client, fallbacks: false, model: 'claude-opus-5-5' }).extractRequest('x', { channel: 'email', today: TODAY });
    expect(calls[0].model).toBe('claude-opus-5-5');
    expect(calls[0].betas).toBeUndefined();
  });
});

describe('ClaudeAiService error handling', () => {
  const failing = (err: unknown): AnthropicLike => ({ beta: { messages: { create: async () => { throw err; } } } });
  const cases: [unknown, string, boolean][] = [
    [new Anthropic.RateLimitError(429, {}, 'rate', new Headers()), 'rate_limit', true],
    [new Anthropic.AuthenticationError(401, {}, 'auth', new Headers()), 'auth', false],
    [new Anthropic.BadRequestError(400, {}, 'bad', new Headers()), 'bad_request', false],
    [new Anthropic.InternalServerError(529, {}, 'overloaded', new Headers()), 'overloaded', true],
    [new Anthropic.APIConnectionError({ message: 'down' }), 'network', true],
    [new Error('boom'), 'unknown', false],
  ];
  for (const [err, code, retryable] of cases) {
    it(`maps ${(err as Error).constructor.name} → ${code}`, async () => {
      const ai = new ClaudeAiService({ client: failing(err) });
      const e = await ai.ask({ question: 'q', contextLabel: 'c', facts: {} }).catch((x) => x);
      expect(e).toBeInstanceOf(AiError);
      expect(e.code).toBe(code);
      expect(e.retryable).toBe(retryable);
      expect(e.operation).toBe('ask');
    });
  }

  it('refusal, truncation and invalid JSON become typed errors', async () => {
    const r1 = fakeClient({}, { stop_reason: 'refusal' });
    await expect(new ClaudeAiService({ client: r1.client }).ask({ question: 'q', contextLabel: 'c', facts: {} })).rejects.toMatchObject({ code: 'refusal' });
    const r2 = fakeClient({}, { stop_reason: 'max_tokens' });
    await expect(new ClaudeAiService({ client: r2.client }).ask({ question: 'q', contextLabel: 'c', facts: {} })).rejects.toMatchObject({ code: 'truncated' });
    const r3 = fakeClient({}, { content: [{ type: 'text', text: 'not json', citations: null }] as Anthropic.Beta.BetaMessage['content'] });
    await expect(new ClaudeAiService({ client: r3.client }).ask({ question: 'q', contextLabel: 'c', facts: {} })).rejects.toMatchObject({ code: 'invalid_output' });
  });

  it('ignores thinking/fallback blocks and reads the served model name', async () => {
    const { client } = fakeClient({}, {
      model: 'claude-sonnet-5',
      content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: JSON.stringify({ answerable: true, answer: '80 kişi', usedFacts: ['pax'] }), citations: null }] as Anthropic.Beta.BetaMessage['content'],
    });
    const r = await new ClaudeAiService({ client }).ask({ question: 'Kaç kişi?', contextLabel: 'p', facts: { pax: 80 } });
    expect(r.data.answer).toBe('80 kişi');
    expect(r.model).toBe('claude-sonnet-5');
  });
});

describe('ClaudeAiService default client', () => {
  it('can be constructed with an API key without network access', () => {
    const ai = new ClaudeAiService({ apiKey: 'sk-test' });
    expect(ai.name).toBe('claude');
  });
});
