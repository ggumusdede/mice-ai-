import { describe, expect, it } from 'vitest';
import { extraLimitStatus } from '../fieldLimits';
import { optionTotals, preCheck } from '../quoteMath';
import { sparklinePoints } from '../sparkline';
import { groupTasksByDay } from '../tasks';
import type { Task } from '@mice/shared';

describe('field extra limits (§17.1: 5.000 / 15.000 TL)', () => {
  const L = { perItem: 5000, perProject: 15000 };
  it('within limits', () => expect(extraLimitStatus(5000, 10000, L).needsAdmin).toBe(false));
  it('over per-item', () => expect(extraLimitStatus(5001, 0, L)).toMatchObject({ needsAdmin: true, overItem: true }));
  it('over project total', () => expect(extraLimitStatus(1000, 14500, L)).toMatchObject({ needsAdmin: true, overProject: true }));
});

describe('quote builder totals', () => {
  it('computes margin and markup separately, value-add has zero cost', () => {
    const t = optionTotals([
      { serviceItemId: 'a', include: true, offerId: 'o', costEur: 100, markup: 0.25, valueAdd: false, quantity: 1 },
      { serviceItemId: 'b', include: true, offerId: null, costEur: 0, markup: 0, valueAdd: true, quantity: 2, unitPriceEur: 10 },
      { serviceItemId: 'c', include: false, offerId: 'x', costEur: 999, markup: 0.1, valueAdd: false, quantity: 1 },
    ]);
    expect(t).toMatchObject({ costEur: 100, saleEur: 145, profitEur: 45 });
    expect(t.margin).toBeCloseTo(45 / 145);
    expect(t.markup).toBeCloseTo(0.45);
    expect(preCheck({ ...t, margin: 0.05 }, { targetMarginMin: 0.08 })).toHaveLength(1);
  });
});

describe('sparkline', () => {
  it('maps min to bottom, max to top; flat series centered', () => {
    const p = sparklinePoints([0, 1], 100, 40, 0);
    expect(p[0]).toEqual({ x: 0, y: 40 });
    expect(p[1]).toEqual({ x: 100, y: 0 });
    expect(sparklinePoints([5, 5], 100, 40)[0].y).toBe(20);
  });
});

describe('task calendar grouping', () => {
  const task = (id: string, dueAt: string | null, status: Task['status'] = 'open'): Task =>
    ({ id, tenantId: 't', projectId: 'p', assigneeId: null, kind: 'x', title: id, dueAt, status, source: 'rule' });
  it('groups by day, sorts, flags overdue, puts undated last', () => {
    const g = groupTasksByDay([task('c', null), task('b', '2026-11-25T10:00:00'), task('a', '2026-11-18T09:00:00'), task('z', '2026-11-19', 'cancelled')], new Date(2026, 10, 20));
    expect(g.map((x) => x.day)).toEqual(['2026-11-18', '2026-11-25', 'none']);
    expect(g[0].overdue).toBe(true);
    expect(g[1].overdue).toBe(false);
  });
});
