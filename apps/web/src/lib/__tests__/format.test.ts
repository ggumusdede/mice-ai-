import { describe, expect, it } from 'vitest';
import { businessDuration, dateRange, money, pct, profitOf, signedPct, weekStartISO } from '../format';

describe('format', () => {
  it('formats money tr-TR and handles null', () => {
    expect(money(1234.5, 'EUR')).toMatch(/1\.234,50/);
    expect(money(null)).toBe('—');
    expect(money(25000, 'TRY')).toMatch(/25\.000/);
  });
  it('percent and signed percent', () => {
    expect(pct(0.2)).toMatch(/20/);
    expect(signedPct(0.18)).toMatch(/^\+/);
    expect(signedPct(-0.03)).toMatch(/^−/);
  });
  it('keeps margin and markup separate (100 → 125)', () => {
    const p = profitOf(100, 125);
    expect(p.markup).toBeCloseTo(0.25);
    expect(p.margin).toBeCloseTo(0.2);
    expect(profitOf(0, 0)).toMatchObject({ margin: 0, markup: 0 });
  });
  it('business duration', () => {
    expect(businessDuration(9 * 60 * 2)).toBe('2 iş günü');
    expect(businessDuration(90)).toBe('1 sa 30 dk');
  });
  it('week start is Monday', () => {
    expect(weekStartISO(new Date(2026, 10, 20))).toBe('2026-11-16');
  });
  it('date range same month', () => {
    expect(dateRange('2026-03-12', '2026-03-14')).toMatch(/^12–14/);
  });
});
