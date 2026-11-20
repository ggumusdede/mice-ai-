// §17.10 Ölçüm: mesai saatleri ile sayım
import type { TenantRules } from '@mice/shared';
import { notImplemented } from './_todo.js';

export type BusinessCalendar = TenantRules['businessHours'];
/** Business minutes between two instants, honoring timezone, working days, hours and holidays (YYYY-MM-DD). */
export function businessMinutesBetween(start: Date, end: Date, cal: BusinessCalendar): number { return notImplemented('businessMinutesBetween'); }
/** Adds N business days (date-only semantics in the calendar's timezone) → returns Date at same local time. */
export function addBusinessDays(from: Date, days: number, cal: BusinessCalendar): Date { return notImplemented('addBusinessDays'); }
/** Adds N business minutes. */
export function addBusinessMinutes(from: Date, minutes: number, cal: BusinessCalendar): Date { return notImplemented('addBusinessMinutes'); }
export function businessMinutesPerDay(cal: BusinessCalendar): number { return notImplemented('businessMinutesPerDay'); }
