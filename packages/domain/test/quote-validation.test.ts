import { describe, expect, it } from 'vitest';
import { validateQuote, quoteNeedsApproval, describeCustomerRules, eachDate, type QuoteValidationInput } from '../src/quote-validation.js';
import { qline, qoption, rules } from './fixtures.js';

const items: QuoteValidationInput['items'] = [
  { id: 'si-acc', kind: 'accommodation', dateFrom: '2027-03-12', dateTo: '2027-03-14', description: 'Konaklama', valueAdd: false },
  { id: 'si-hall', kind: 'hall', dateFrom: '2027-03-12', dateTo: '2027-03-14', description: 'Salon', valueAdd: false },
];
const lines = (over: Parameters<typeof qline>[0] = {}) => [
  qline(over),
  qline({ serviceItemId: 'si-hall', description: 'Salon', kind: 'hall', quantity: 3, nights: null, unitCostEur: 1000, unitPriceEur: 1150, supplierOptionUntil: '2027-01-20' }),
];
function input(over: Partial<QuoteValidationInput> = {}): QuoteValidationInput {
  return {
    options: [qoption(1, lines()), qoption(2, lines({ supplierOptionUntil: '2027-01-18' }))],
    items, supplierStatusByItem: { 'si-acc': 'accredited', 'si-hall': 'accredited' },
    customerOptionUntil: '2027-01-15', customerRules: null, rules,
    eventStartDate: '2027-03-12', eventEndDate: '2027-03-14', ...over,
  };
}
const codes = (r: ReturnType<typeof validateQuote>) => r.issues.map((i) => i.code);

describe('validateQuote', () => {
  it('a clean 2-option quote passes', () => {
    const r = validateQuote(input());
    expect(r.blocked).toBe(false);
    expect(r.issues).toEqual([]);
    expect(r.appliedCustomerRules).toContain('Kesin onay: imzalı onay veya PO şart');
  });

  it('blocks when the customer option exceeds the EARLIEST supplier option of that option', () => {
    const r = validateQuote(input({ customerOptionUntil: '2027-01-16' }));
    expect(r.blocked).toBe(true);
    const iss = r.issues.filter((i) => i.code === 'option_exceeds_supplier');
    expect(iss.map((i) => i.optionNo)).toEqual([1]); // option 2's earliest is 01-18
    expect(iss[0].serviceItemId).toBe('si-acc');
    expect(iss[0].blocking).toBe(true);
  });
  it('same day as supplier option is allowed; value-add lines do not constrain the option', () => {
    expect(validateQuote(input({ customerOptionUntil: '2027-01-15' })).blocked).toBe(false);
    const opts = [qoption(1, [...lines(), qline({ serviceItemId: 'si-acc', valueAdd: true, supplierOptionUntil: '2026-12-01', unitCostEur: 0 })]), qoption(2, lines())];
    expect(codes(validateQuote(input({ options: opts })))).not.toContain('option_exceeds_supplier');
  });

  it('option count must be 2–3', () => {
    expect(validateQuote(input({ options: [qoption(1, lines())] })).issues[0]).toMatchObject({ code: 'option_count', blocking: true });
    const four = [1, 2, 3, 4].map((n) => qoption(n, lines()));
    expect(codes(validateQuote(input({ options: four })))).toContain('option_count');
    const three = [1, 2, 3].map((n) => qoption(n, lines()));
    expect(validateQuote(input({ options: three })).blocked).toBe(false);
  });

  it('margin below target blocks; admin override with written reason unblocks', () => {
    const low = [qoption(1, lines(), 100, 105), qoption(2, lines())]; // margin 4.76% < 8%
    const r = validateQuote(input({ options: low }));
    expect(r.blocked).toBe(true);
    expect(r.issues[0]).toMatchObject({ code: 'below_target_margin', optionNo: 1, blocking: true });

    expect(validateQuote(input({ options: low, overrideByAdmin: true, marginOverrideReason: '   ' })).blocked).toBe(true);
    expect(validateQuote(input({ options: low, overrideByAdmin: false, marginOverrideReason: 'Stratejik müşteri' })).blocked).toBe(true);
    const ok = validateQuote(input({ options: low, overrideByAdmin: true, marginOverrideReason: 'Stratejik müşteri' }));
    expect(ok.blocked).toBe(false);
    expect(ok.issues[0]).toMatchObject({ code: 'below_target_margin', blocking: false });
    expect(ok.issues[0].message).toContain('Stratejik müşteri');
  });
  it('margin exactly at target passes; zero sale counts as below target', () => {
    // margin = 8% exactly: cost 92, sale 100
    expect(validateQuote(input({ options: [qoption(1, lines(), 92, 100), qoption(2, lines())] })).blocked).toBe(false);
    expect(validateQuote(input({ options: [qoption(1, lines(), 0, 0), qoption(2, lines())] })).blocked).toBe(true);
  });

  it('candidate supplier blocks (flagged once per item)', () => {
    const r = validateQuote(input({ supplierStatusByItem: { 'si-acc': 'candidate', 'si-hall': 'accredited' } }));
    expect(r.blocked).toBe(true);
    expect(r.issues.filter((i) => i.code === 'candidate_supplier')).toHaveLength(1);
  });

  it('zero price warnings are non-blocking; value-add with zero cost is fine', () => {
    const opts = [qoption(1, [...lines(), qline({ serviceItemId: 'si-acc', description: 'Ses-ışık (katma değer)', valueAdd: true, unitCostEur: 0, unitPriceEur: 300 })]), qoption(2, lines({ unitPriceEur: 0 }))];
    const r = validateQuote(input({ options: opts }));
    expect(r.blocked).toBe(false);
    expect(r.issues.filter((i) => i.code === 'zero_price')).toHaveLength(1);
    expect(r.issues.find((i) => i.code === 'zero_price')!.optionNo).toBe(2);
  });

  it('missing line & missing day coverage are non-blocking warnings', () => {
    const hallOneDay = { ...items[1], dateTo: '2027-03-13' };
    const r = validateQuote(input({ items: [items[0], hallOneDay, { id: 'si-tr', kind: 'transfer', dateFrom: null, dateTo: null, description: 'Transfer', valueAdd: false }] }));
    expect(r.blocked).toBe(false);
    const missDay = r.issues.filter((i) => i.code === 'missing_day_item');
    expect(missDay).toHaveLength(2);
    expect(missDay[0].message).toContain('2027-03-14');
    expect(r.issues.filter((i) => i.code === 'missing_line')).toHaveLength(2);
  });
  it('accommodation covers nights (check-out day excluded)', () => {
    const short = { ...items[0], dateTo: '2027-03-13' };
    const r = validateQuote(input({ items: [short, items[1]] }));
    expect(r.issues.filter((i) => i.code === 'missing_day_item').every((i) => i.message.includes('konaklama') && i.message.includes('2027-03-13'))).toBe(true);
  });

  it('customer rules are listed (applied & visible)', () => {
    const r = validateQuote(input({ customerRules: { firmApproval: 'online', depositRate: 0.3, omitPaymentCancellationClauses: true, specialClauses: ['Fiyatlar TL sabitlenir'], preferredLanguage: 'tr', preferredCurrency: 'TRY' } }));
    expect(r.appliedCustomerRules).toEqual(['Kesin onay: online onay yeterli', 'Kapora: %30', 'Teklifte ödeme / iptal maddesi yer almaz', 'Özel madde: Fiyatlar TL sabitlenir']);
    expect(describeCustomerRules(null)[0]).toMatch(/Varsayılan/);
    expect(describeCustomerRules(null)).toContain('Kapora yok');
  });

  it('eachDate', () => {
    expect(eachDate('2027-02-27', '2027-03-01')).toEqual(['2027-02-27', '2027-02-28', '2027-03-01']);
    expect(eachDate('x', 'y')).toEqual([]);
  });
});

describe('quoteNeedsApproval (§4 kişi bazlı yetki)', () => {
  const clerk = (authorityLevel: 'all_need_approval' | 'scoped' | 'full', authorityScope = {}) => ({ role: 'clerk_sales' as const, authorityLevel, authorityScope });
  it('admin and full authority never need approval', () => {
    expect(quoteNeedsApproval({ role: 'admin', authorityLevel: 'all_need_approval', authorityScope: {} }, null, null)).toBe(false);
    expect(quoteNeedsApproval(clerk('full'), null, null)).toBe(false);
  });
  it('all_need_approval always needs approval', () => {
    expect(quoteNeedsApproval(clerk('all_need_approval'), { id: 'c1' }, 'toplantı')).toBe(true);
  });
  it('scoped: free within customer OR event type scope', () => {
    const u = clerk('scoped', { customerIds: ['c1'], eventTypes: ['Toplantı'] });
    expect(quoteNeedsApproval(u, { id: 'c1' }, 'kongre')).toBe(false);
    expect(quoteNeedsApproval(u, { id: 'c2' }, 'toplantı')).toBe(false);
    expect(quoteNeedsApproval(u, { id: 'c2' }, 'kongre')).toBe(true);
    expect(quoteNeedsApproval(u, null, null)).toBe(true);
  });
  it('non-sales roles need approval', () => {
    expect(quoteNeedsApproval({ role: 'finance', authorityLevel: 'full', authorityScope: {} }, null, null)).toBe(true);
  });
});
