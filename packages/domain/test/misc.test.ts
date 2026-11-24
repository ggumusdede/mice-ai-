import { describe, expect, it } from 'vitest';
import { formatProjectCode, slugTr, supplierSafeCode } from '../src/project-code.js';
import { retentionUntil, shouldAnonymize, pseudonymize, restorePseudonyms } from '../src/kvkk.js';
import { canNegotiate, negotiationDraftViolations, ALLOWED_NEGOTIATION_ARGUMENTS } from '../src/negotiation.js';
import { staleKindsFor, changeImpact, revisionTargetStep, DOCUMENT_DEPENDENCIES } from '../src/propagation.js';
import { operationsCalendar, parsePaymentSchedule } from '../src/operations-calendar.js';
import { contractFields, rules } from './fixtures.js';

describe('project code', () => {
  it('PRD example', () => {
    expect(formatProjectCode({ prefix: 'PRJ', seq: 42, customer: 'Acme İlaç', date: '2027-03-12', pax: 80, venue: 'Hilton Bomonti' })).toBe('PRJ-0042-ACMEILAC-20270312-80-HILTONBOMONTI');
  });
  it('transliterates all Turkish characters', () => {
    expect(slugTr('çÇğĞıİöÖşŞüÜ')).toBe('CCGGIIOOSSUU');
    expect(slugTr('Işık Güneş Ölçü')).toBe('ISIKGUNESOLCU');
    expect(slugTr('Café & Co. — 5*')).toBe('CAFECO5');
  });
  it('truncates customer (12) and venue (14)', () => {
    const code = formatProjectCode({ prefix: 'PRJ', seq: 7, customer: 'Büyükşehir Belediyesi Kültür', date: '2027-03-12', pax: 250, venue: 'Swissôtel The Bosphorus İstanbul' });
    expect(code).toBe('PRJ-0007-BUYUKSEHIRBE-20270312-250-SWISSOTELTHEBO');
  });
  it('unknown parts → TBD; seq above 9999 not truncated', () => {
    expect(formatProjectCode({ prefix: 'PRJ', seq: 12345, customer: null, date: null, pax: null, venue: '  ' })).toBe('PRJ-12345-TBD-TBD-TBD-TBD');
    expect(formatProjectCode({ prefix: 'PRJ', seq: 1, customer: '***', date: 'yarın', pax: 0, venue: null })).toBe('PRJ-0001-TBD-TBD-TBD-TBD');
  });
});

describe('supplier-safe project reference (hideCustomerFromSuppliers)', () => {
  it('drops the customer and venue segments', () => {
    expect(supplierSafeCode('PRJ-0042-ACMEILAC-20270312-80-HILTONBOMONTI')).toBe('PRJ-0042-20270312-80');
    expect(supplierSafeCode('PRJ-12345-TBD-TBD-TBD-TBD')).toBe('PRJ-12345-TBD-TBD');
  });
  it('unknown shapes fall back to prefix + sequence (never the raw code)', () => {
    expect(supplierSafeCode('PRJ-0042-ACME-EXTRA')).toBe('PRJ-0042');
    expect(supplierSafeCode('ACME İLAÇ')).toBe('PRJ');
    expect(supplierSafeCode('')).toBe('PRJ');
  });
});

describe('KVKK retention & anonymization', () => {
  it('retentionUntil = event end + days', () => {
    expect(retentionUntil('2027-03-14', rules.guestDataRetentionDays)).toBe('2029-03-13');
    expect(retentionUntil('2027-03-14T18:00:00Z', 30)).toBe('2027-04-13');
    expect(() => retentionUntil('x', 1)).toThrow();
  });
  const g = (over = {}) => ({ consentReuse: false, consentWithdrawnAt: null, anonymizedAt: null, retentionUntil: '2027-04-13', ...over });
  it('consent → keep, even after retention', () => {
    expect(shouldAnonymize(g({ consentReuse: true }), new Date('2030-01-01'))).toBe(false);
  });
  it('no consent → anonymize only after the retention day', () => {
    expect(shouldAnonymize(g(), new Date('2027-04-13T23:59:59Z'))).toBe(false);
    expect(shouldAnonymize(g(), new Date('2027-04-14T00:00:00Z'))).toBe(true);
    expect(shouldAnonymize(g({ retentionUntil: null }), new Date('2030-01-01'))).toBe(false);
  });
  it('withdrawn consent → anonymize after retention, or immediately if past / unknown', () => {
    expect(shouldAnonymize(g({ consentReuse: true, consentWithdrawnAt: '2027-03-20T00:00:00Z' }), new Date('2027-04-01'))).toBe(false);
    expect(shouldAnonymize(g({ consentReuse: true, consentWithdrawnAt: '2027-03-20T00:00:00Z' }), new Date('2027-05-01'))).toBe(true);
    expect(shouldAnonymize(g({ consentReuse: true, consentWithdrawnAt: '2027-03-20T00:00:00Z', retentionUntil: null }), new Date('2027-04-01'))).toBe(true);
  });
  it('already anonymized → false', () => {
    expect(shouldAnonymize(g({ anonymizedAt: '2027-05-01T00:00:00Z' }), new Date('2030-01-01'))).toBe(false);
  });
});

describe('pseudonymize / restore', () => {
  const text = 'Merhaba, ben Ayşe Yılmaz (ayse.yilmaz@acme.com.tr, +90 532 123 45 67). AYŞE YILMAZ ve Mehmet Demir için 0532 123 45 67 veya 05321234567 arayın. Sabit: (0212) 555 66 77. VKN 1234567890. Yurtdışı: +44 20 7946 0958. Tekrar: Ayse.Yilmaz@ACME.com.tr';
  const r = pseudonymize(text, ['Ayşe Yılmaz', 'Mehmet Demir']);
  it('replaces emails, TR phones and known names with stable tokens', () => {
    expect(r.text).not.toMatch(/Ayşe|AYŞE|Mehmet|@|532|555 66 77|7946/);
    expect(r.text.match(/\[EMAIL_1\]/g)).toHaveLength(2); // same email (case-insensitive) → same token
    expect(r.text.match(/\[PHONE_1\]/g)).toHaveLength(3); // +90 532…, 0532…, 05321234567 are the same number
    expect(r.text).toContain('[PHONE_2]');
    expect(r.text).toContain('[PHONE_3]');
    expect(r.text.match(/\[PERSON_1\]/g)).toHaveLength(2);
    expect(r.text).toContain('[PERSON_2]');
    expect(r.mapping['[EMAIL_1]']).toBe('ayse.yilmaz@acme.com.tr');
    expect(r.mapping['[PERSON_1]']).toBe('Ayşe Yılmaz');
  });
  it('does not touch non-mobile bare 10-digit numbers (e.g. tax no)', () => {
    expect(r.text).toContain('VKN 1234567890');
  });
  it('restores tokens from the mapping', () => {
    const restored = restorePseudonyms(r.text, r.mapping);
    expect(restored).toContain('ben Ayşe Yılmaz (ayse.yilmaz@acme.com.tr, +90 532 123 45 67)');
    expect(restored).not.toMatch(/\[(PERSON|EMAIL|PHONE)_\d+\]/);
    expect(restorePseudonyms('[PERSON_9] x', r.mapping)).toBe('[PERSON_9] x');
    expect(restorePseudonyms('abc', {})).toBe('abc');
  });
  it('names are matched on word boundaries only', () => {
    expect(pseudonymize('Alican geldi, Ali gitti', ['Ali']).text).toBe('Alican geldi, [PERSON_1] gitti');
  });
  it('handles 10+ tokens without prefix collisions on restore', () => {
    const names = Array.from({ length: 11 }, (_, i) => `Kişi${String.fromCharCode(65 + i)}`);
    const p = pseudonymize(names.join(' '), names);
    expect(p.text).toContain('[PERSON_11]');
    expect(restorePseudonyms(p.text, p.mapping)).toBe(names.join(' '));
  });
});

describe('negotiation', () => {
  it('at most 3 rounds', () => {
    expect(canNegotiate(0, rules.maxNegotiationRounds).allowed).toBe(true);
    expect(canNegotiate(2, 3).allowed).toBe(true);
    const r = canNegotiate(3, 3);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/telefon/);
  });
  it('allowed arguments are volume, relationship, flexible dates, payment ease', () => {
    expect(ALLOWED_NEGOTIATION_ARGUMENTS).toEqual(['volume', 'relationship', 'flexible_dates', 'payment_ease']);
  });
  it('detects competitor names and competitor-price references', () => {
    const v = negotiationDraftViolations('Sayın Hilton, Divan Otel bize daha ucuza veriyor; başka bir otel %10 indirim yaptı.', ['Divan Otel', 'Swissotel']);
    expect(v).toContain('Rakip tedarikçi adı geçiyor: Divan Otel');
    expect(v.length).toBeGreaterThanOrEqual(3);
    expect(negotiationDraftViolations('We have a cheaper offer from another hotel', [])).toHaveLength(2);
  });
  it('clean draft using allowed arguments', () => {
    expect(negotiationDraftViolations('80 kişilik grup ve yıllık hacmimiz, esnek tarih ve peşin ödeme imkânımızla daha uygun bir fiyat rica ediyoruz.', ['Divan Otel'])).toEqual([]);
  });
});

describe('propagation', () => {
  it('stale document kinds for an entity change', () => {
    expect(staleKindsFor('guest', ['fullName'])).toEqual(['rooming_list']);
    expect(staleKindsFor('supplier_offer', ['lines'])).toEqual(['quote', 'contract', 'pnl']);
    expect(new Set(staleKindsFor('project', ['pax']))).toEqual(new Set(DOCUMENT_DEPENDENCIES.project));
  });
  it('bookkeeping-only changes make nothing stale', () => {
    expect(staleKindsFor('project', ['updatedAt', 'ownerId'])).toEqual([]);
    expect(staleKindsFor('quote', [])).toEqual([]);
  });
  it('changeImpact', () => {
    expect(changeImpact({ costEur: 10000, saleEur: 12500 }, { costEur: 11800, saleEur: 12500 }, rules.targetMarginMin)).toEqual({ deltaCostEur: 1800, deltaSaleEur: 0, newMargin: 0.056, belowTarget: true });
    const ok = changeImpact({ costEur: 100, saleEur: 125 }, { costEur: 92, saleEur: 100 }, 0.08);
    expect(ok.belowTarget).toBe(false);
    expect(changeImpact({ costEur: 0, saleEur: 0 }, { costEur: 0, saleEur: 0 }, 0.08)).toMatchObject({ newMargin: 0, belowTarget: true });
  });
  it('revision: dates/pax → step 1, price only → step 2', () => {
    expect(revisionTargetStep(['startDate'])).toBe(1);
    expect(revisionTargetStep(['pax', 'unitPriceEur'])).toBe(1);
    expect(revisionTargetStep(['roomsDbl'])).toBe(1);
    expect(revisionTargetStep(['unitPriceEur', 'markup'])).toBe(2);
    expect(revisionTargetStep([])).toBe(2);
  });
});

describe('operationsCalendar', () => {
  it('defaults from event start, attrition from terms, payments parsed', () => {
    const tasks = operationsCalendar(contractFields({ attritionTerms: '%10 düşüş hakkı 21 gün önce' }), '2027-03-12', '2027-01-10T10:00:00Z');
    const by = (k: string) => tasks.filter((t) => t.kind === k);
    expect(by('final_pax')[0].dueDate).toBe('2027-02-19');
    expect(by('attrition')[0].dueDate).toBe('2027-02-19');
    expect(by('rooming_list')[0].dueDate).toBe('2027-03-02');
    expect(by('menu_approval')[0].dueDate).toBe('2027-03-05');
    expect(by('tech_brief')[0].dueDate).toBe('2027-03-07');
    expect(by('transfer_list')[0].dueDate).toBe('2027-03-09');
    expect(by('event_day_checklist')[0]).toMatchObject({ dueDate: '2027-03-11', role: 'field' });
    const pay = by('payment_due');
    expect(pay.map((p) => p.dueDate)).toEqual(['2027-01-17', '2027-03-05']); // %30 at signing+7, rest 7 days before
    expect(pay.every((p) => p.role === 'finance')).toBe(true);
    // sorted by date
    expect([...tasks].map((t) => t.dueDate)).toEqual([...tasks].map((t) => t.dueDate).sort());
  });
  it('defaults: T-14 attrition, prepayment at signing+7d, or T-30 when unsigned', () => {
    const c = contractFields({ attritionTerms: null, paymentTerms: null, prepaymentRate: 0.3 });
    const signed = operationsCalendar(c, '2027-03-12', '2027-01-10');
    expect(signed.find((t) => t.kind === 'attrition')!.dueDate).toBe('2027-02-26');
    expect(signed.find((t) => t.kind === 'payment_due')).toMatchObject({ dueDate: '2027-01-17', title: 'Ön ödeme %30' });
    expect(operationsCalendar(c, '2027-03-12', null).find((t) => t.kind === 'payment_due')!.dueDate).toBe('2027-02-10');
    expect(operationsCalendar(contractFields({ paymentTerms: null, prepaymentRate: null, startDate: null }), '2027-03-12', null).filter((t) => t.kind === 'payment_due')).toEqual([]);
  });
  it('parsePaymentSchedule: after event end, check-in', () => {
    const s = parsePaymentSchedule('%50 girişte; %50 etkinlik bitiminden 15 gün sonra', '2027-03-12', '2027-03-14', null);
    expect(s).toEqual([
      { dueDate: '2027-03-12', percent: 50, text: '%50 girişte' },
      { dueDate: '2027-03-29', percent: 50, text: '%50 etkinlik bitiminden 15 gün sonra' },
    ]);
    expect(parsePaymentSchedule(null, '2027-03-12', '2027-03-14', null)).toEqual([]);
  });
});
