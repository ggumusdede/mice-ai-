import { describe, expect, it } from 'vitest';
import { isToday, isUpcoming } from '../fieldDates';

describe('field panel dates', () => {
  const today = '2026-11-20';
  it('today = event dates include today (inclusive, single-day events)', () => {
    expect(isToday({ startDate: '2026-11-19', endDate: '2026-11-21' }, today)).toBe(true);
    expect(isToday({ startDate: '2026-11-20', endDate: null }, today)).toBe(true);
    expect(isToday({ startDate: '2026-11-18', endDate: '2026-11-19' }, today)).toBe(false);
    expect(isToday({ startDate: '2026-11-21', endDate: '2026-11-22' }, today)).toBe(false);
    expect(isToday({ startDate: null, endDate: null }, today)).toBe(false);
  });
  it('upcoming = starts within the next 7 days', () => {
    expect(isUpcoming({ startDate: '2026-11-21', endDate: '2026-11-22' }, today)).toBe(true);
    expect(isUpcoming({ startDate: '2026-11-27', endDate: null }, today)).toBe(true);
    expect(isUpcoming({ startDate: '2026-11-28', endDate: null }, today)).toBe(false);
    expect(isUpcoming({ startDate: '2026-11-20', endDate: '2026-11-21' }, today)).toBe(false);
    expect(isUpcoming({ startDate: '2027-03-12', endDate: '2027-03-14' }, today)).toBe(false);
  });
});

import { taskTitleInProject } from '../tasks';
describe('task titles inside a project', () => {
  it('drops the leading project code', () => {
    expect(taskTitleInProject('PRJ-0014-DENIZLOJISTI-20270312-60-MODASAHILOTEL · Moda Sahil Otel: Ön ödeme %30')).toBe('Moda Sahil Otel: Ön ödeme %30');
    expect(taskTitleInProject('PRJ-0014-DENIZ-TBD: Etkinlik günü kontrol listesi')).toBe('Etkinlik günü kontrol listesi');
    expect(taskTitleInProject('Rooming list gönder')).toBe('Rooming list gönder');
  });
});
