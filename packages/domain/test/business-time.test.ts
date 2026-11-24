import { describe, expect, it } from 'vitest';
import { businessMinutesBetween, addBusinessDays, addBusinessMinutes, businessMinutesPerDay, tzOffsetMs, zonedTimeToUtc, localDate, parseHm, isBusinessDay, startOfLocalDate } from '../src/business-time.js';
import { cal } from './fixtures.js';

// Istanbul is UTC+3: 09:00 local = 06:00Z, 18:00 local = 15:00Z. 2026-11-16 is a Monday.
const at = (iso: string) => new Date(iso);
const holidayCal = { ...cal, holidays: ['2026-10-29'] }; // Cumhuriyet Bayramı (Thursday)

describe('timezone helpers (Intl-derived)', () => {
  it('derives Istanbul offset +3h and handles DST zones', () => {
    expect(tzOffsetMs(Date.UTC(2026, 0, 15), 'Europe/Istanbul')).toBe(3 * 3600_000);
    expect(tzOffsetMs(Date.UTC(2026, 6, 15), 'Europe/Istanbul')).toBe(3 * 3600_000);
    expect(tzOffsetMs(Date.UTC(2026, 0, 15), 'Europe/Berlin')).toBe(1 * 3600_000);
    expect(tzOffsetMs(Date.UTC(2026, 6, 15), 'Europe/Berlin')).toBe(2 * 3600_000);
    expect(new Date(zonedTimeToUtc(2026, 11, 16, 9, 0, 'Europe/Istanbul')).toISOString()).toBe('2026-11-16T06:00:00.000Z');
    expect(new Date(zonedTimeToUtc(2026, 3, 29, 9, 0, 'Europe/Berlin')).toISOString()).toBe('2026-03-29T07:00:00.000Z');
  });
  it('localDate crosses midnight correctly', () => {
    expect(localDate(at('2026-11-16T22:30:00Z'), 'Europe/Istanbul')).toBe('2026-11-17');
    expect(startOfLocalDate('2026-11-17', 'Europe/Istanbul').toISOString()).toBe('2026-11-16T21:00:00.000Z');
    expect(startOfLocalDate('2026-11-17', 'Europe/Istanbul', -2).toISOString()).toBe('2026-11-14T21:00:00.000Z');
  });
  it('parseHm validates', () => {
    expect(parseHm('09:30')).toBe(570);
    expect(() => parseHm('9h')).toThrow();
    expect(() => parseHm('25:00')).toThrow();
  });
  it('isBusinessDay honors weekends and holidays', () => {
    expect(isBusinessDay(2026, 11, 16, cal)).toBe(true);
    expect(isBusinessDay(2026, 11, 21, cal)).toBe(false); // Saturday
    expect(isBusinessDay(2026, 10, 29, holidayCal)).toBe(false);
    expect(isBusinessDay(2026, 11, 22, { ...cal, days: [7] })).toBe(true); // 7 accepted as Sunday
  });
});

describe('businessMinutesPerDay', () => {
  it('09:00–18:00 = 540', () => {
    expect(businessMinutesPerDay(cal)).toBe(540);
    expect(businessMinutesPerDay({ ...cal, start: '18:00', end: '09:00' })).toBe(0);
  });
});

describe('businessMinutesBetween', () => {
  it('within one working day', () => {
    expect(businessMinutesBetween(at('2026-11-16T07:00:00Z'), at('2026-11-16T09:30:00Z'), cal)).toBe(150); // 10:00–12:30 local
  });
  it('clips before opening and after closing', () => {
    expect(businessMinutesBetween(at('2026-11-16T03:00:00Z'), at('2026-11-16T20:00:00Z'), cal)).toBe(540);
  });
  it('after-hours to next morning', () => {
    // Mon 20:00 local → Tue 10:00 local = 60 business minutes
    expect(businessMinutesBetween(at('2026-11-16T17:00:00Z'), at('2026-11-17T07:00:00Z'), cal)).toBe(60);
  });
  it('skips weekends: Fri 17:00 → Mon 10:00 = 120', () => {
    expect(businessMinutesBetween(at('2026-11-20T14:00:00Z'), at('2026-11-23T07:00:00Z'), cal)).toBe(120);
  });
  it('entirely on a weekend = 0', () => {
    expect(businessMinutesBetween(at('2026-11-21T06:00:00Z'), at('2026-11-22T15:00:00Z'), cal)).toBe(0);
  });
  it('skips holidays', () => {
    // Thu 29 Oct 2026 is a holiday: Wed 17:00 → Fri 10:00 = 60 + 60
    expect(businessMinutesBetween(at('2026-10-28T14:00:00Z'), at('2026-10-30T07:00:00Z'), holidayCal)).toBe(120);
    expect(businessMinutesBetween(at('2026-10-28T14:00:00Z'), at('2026-10-30T07:00:00Z'), cal)).toBe(120 + 540);
  });
  it('a full week = 5 × 540', () => {
    expect(businessMinutesBetween(at('2026-11-16T00:00:00Z'), at('2026-11-23T00:00:00Z'), cal)).toBe(2700);
  });
  it('end <= start → 0', () => {
    expect(businessMinutesBetween(at('2026-11-16T09:00:00Z'), at('2026-11-16T08:00:00Z'), cal)).toBe(0);
    expect(businessMinutesBetween(at('2026-11-16T09:00:00Z'), at('2026-11-16T09:00:00Z'), cal)).toBe(0);
  });
});

describe('addBusinessDays', () => {
  it('keeps local time, skips weekends', () => {
    expect(addBusinessDays(at('2026-11-19T11:00:00Z'), 2, cal).toISOString()).toBe('2026-11-23T11:00:00.000Z'); // Thu → Mon
    expect(addBusinessDays(at('2026-11-16T11:00:00Z'), 7, cal).toISOString()).toBe('2026-11-25T11:00:00.000Z'); // 7 iş günü opsiyon
  });
  it('from a Saturday +1 → Monday', () => {
    expect(addBusinessDays(at('2026-11-21T11:00:00Z'), 1, cal).toISOString()).toBe('2026-11-23T11:00:00.000Z');
  });
  it('skips holidays', () => {
    expect(addBusinessDays(at('2026-10-28T08:00:00Z'), 1, holidayCal).toISOString()).toBe('2026-10-30T08:00:00.000Z');
  });
  it('local-date semantics: 23:30 local Monday counts from Monday', () => {
    // 2026-11-16T20:30Z = Mon 23:30 local → +1 = Tue 23:30 local
    expect(addBusinessDays(at('2026-11-16T20:30:00Z'), 1, cal).toISOString()).toBe('2026-11-17T20:30:00.000Z');
  });
  it('0 → same instant; negative walks backwards', () => {
    expect(addBusinessDays(at('2026-11-21T11:00:00Z'), 0, cal).toISOString()).toBe('2026-11-21T11:00:00.000Z');
    expect(addBusinessDays(at('2026-11-23T11:00:00Z'), -1, cal).toISOString()).toBe('2026-11-20T11:00:00.000Z');
  });
  it('throws when the calendar has no working days', () => {
    expect(() => addBusinessDays(at('2026-11-16T11:00:00Z'), 1, { ...cal, days: [] })).toThrow();
  });
});

describe('addBusinessMinutes', () => {
  it('within the day', () => {
    expect(addBusinessMinutes(at('2026-11-16T07:00:00Z'), 90, cal).toISOString()).toBe('2026-11-16T08:30:00.000Z');
  });
  it('rolls over closing to next business day', () => {
    // Fri 17:00 local + 120 → Mon 10:00 local
    expect(addBusinessMinutes(at('2026-11-20T14:00:00Z'), 120, cal).toISOString()).toBe('2026-11-23T07:00:00.000Z');
  });
  it('start outside business hours begins at next opening', () => {
    expect(addBusinessMinutes(at('2026-11-21T10:00:00Z'), 30, cal).toISOString()).toBe('2026-11-23T06:30:00.000Z');
    expect(addBusinessMinutes(at('2026-11-16T03:00:00Z'), 540, cal).toISOString()).toBe('2026-11-16T15:00:00.000Z');
  });
  it('2 business days of minutes (quote target)', () => {
    const start = at('2026-11-16T07:00:00Z');
    const end = addBusinessMinutes(start, 2 * 540, cal);
    expect(end.toISOString()).toBe('2026-11-18T07:00:00.000Z');
    expect(businessMinutesBetween(start, end, cal)).toBe(1080);
  });
  it('0 / negative → unchanged', () => {
    expect(addBusinessMinutes(at('2026-11-21T10:00:00Z'), 0, cal).toISOString()).toBe('2026-11-21T10:00:00.000Z');
    expect(addBusinessMinutes(at('2026-11-21T10:00:00Z'), -5, cal).toISOString()).toBe('2026-11-21T10:00:00.000Z');
  });
});
