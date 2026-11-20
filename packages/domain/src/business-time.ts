// §17.10 Ölçüm: mesai saatleri ile sayım
import type { TenantRules } from '@mice/shared';

export type BusinessCalendar = TenantRules['businessHours'];

const MS_MIN = 60_000;
const MS_DAY = 86_400_000;
const MAX_SCAN_DAYS = 3700; // ~10 years safety bound

/** Local wall-clock parts of an instant in an IANA time zone. */
export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; second: number; ms: number; weekday: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of `d` in time zone `tz` (derived with Intl — no hard-coded offsets). */
export function localParts(d: Date, tz: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(d)) parts[p.type] = p.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour) % 24;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour, minute: Number(parts.minute), second: Number(parts.second), ms: ((d.getTime() % 1000) + 1000) % 1000, weekday };
}

/** UTC offset (ms) of time zone `tz` at instant `t` (local − UTC). Europe/Istanbul → +3h. */
export function tzOffsetMs(t: number, tz: string): number {
  const p = localParts(new Date(t), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.ms);
  return asUtc - t;
}

/** Converts a local wall-clock time in `tz` to a UTC instant (ms). Handles DST by re-evaluating the offset. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string, second = 0, ms = 0): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let t = wall - tzOffsetMs(wall, tz);
  const off2 = tzOffsetMs(t, tz);
  t = wall - off2;
  return t;
}

/** "HH:MM" → minutes since midnight. */
export function parseHm(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Invalid time "${s}" (expected HH:MM)`);
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) throw new Error(`Invalid time "${s}"`);
  return h * 60 + mi;
}

/** ISO date (YYYY-MM-DD) of a y/m/d triple. */
function isoDate(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}
/** Adds whole calendar days to a local y/m/d triple. */
function shiftDate(y: number, m: number, d: number, days: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m - 1, d) + days * MS_DAY);
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

function workingDays(cal: BusinessCalendar): Set<number> {
  return new Set(cal.days.map((d) => (d === 7 ? 0 : d)));
}

/** Is the local calendar date a working day (weekday in `days`, not in `holidays`)? */
export function isBusinessDay(y: number, m: number, d: number, cal: BusinessCalendar): boolean {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (!workingDays(cal).has(wd)) return false;
  const iso = isoDate(y, m, d);
  return !cal.holidays.some((h) => h.slice(0, 10) === iso);
}

/** Business window [open, close] (UTC ms) for a local date. */
function windowFor(y: number, m: number, d: number, cal: BusinessCalendar): [number, number] {
  const s = parseHm(cal.start);
  const e = parseHm(cal.end);
  return [zonedTimeToUtc(y, m, d, Math.floor(s / 60), s % 60, cal.timezone), zonedTimeToUtc(y, m, d, Math.floor(e / 60), e % 60, cal.timezone)];
}

export function businessMinutesPerDay(cal: BusinessCalendar): number {
  return Math.max(0, parseHm(cal.end) - parseHm(cal.start));
}

/** Business minutes between two instants, honoring timezone, working days, hours and holidays (YYYY-MM-DD). */
export function businessMinutesBetween(start: Date, end: Date, cal: BusinessCalendar): number {
  const a = start.getTime();
  const b = end.getTime();
  if (!(b > a) || businessMinutesPerDay(cal) === 0) return 0;
  const sp = localParts(start, cal.timezone);
  const ep = localParts(end, cal.timezone);
  const lastIso = isoDate(ep.year, ep.month, ep.day);
  let [y, m, d] = [sp.year, sp.month, sp.day];
  let total = 0;
  for (let i = 0; i <= MAX_SCAN_DAYS * 10; i++) {
    if (isBusinessDay(y, m, d, cal)) {
      const [ws, we] = windowFor(y, m, d, cal);
      const from = Math.max(ws, a);
      const to = Math.min(we, b);
      if (to > from) total += to - from;
    }
    if (isoDate(y, m, d) >= lastIso) break;
    [y, m, d] = shiftDate(y, m, d, 1);
  }
  return Math.floor(total / MS_MIN + 1e-9);
}

/** Adds N business days (date-only semantics in the calendar's timezone) → returns Date at same local time.
 *  Starting on a non-working day, +1 lands on the next working day. Negative N walks backwards. */
export function addBusinessDays(from: Date, days: number, cal: BusinessCalendar): Date {
  const n = Math.trunc(days);
  if (n === 0) return new Date(from.getTime());
  if (workingDays(cal).size === 0) throw new Error('addBusinessDays: calendar has no working days');
  const p = localParts(from, cal.timezone);
  let [y, m, d] = [p.year, p.month, p.day];
  const step = n > 0 ? 1 : -1;
  let left = Math.abs(n);
  for (let i = 0; left > 0; i++) {
    if (i > MAX_SCAN_DAYS + Math.abs(n) * 7) throw new Error('addBusinessDays: no business day found');
    [y, m, d] = shiftDate(y, m, d, step);
    if (isBusinessDay(y, m, d, cal)) left--;
  }
  return new Date(zonedTimeToUtc(y, m, d, p.hour, p.minute, cal.timezone, p.second, p.ms));
}

/** Adds N business minutes. A start outside business hours rolls to the next opening. N <= 0 returns `from` unchanged. */
export function addBusinessMinutes(from: Date, minutes: number, cal: BusinessCalendar): Date {
  if (!(minutes > 0)) return new Date(from.getTime());
  if (businessMinutesPerDay(cal) === 0 || workingDays(cal).size === 0) throw new Error('addBusinessMinutes: calendar has no business hours');
  let remaining = minutes * MS_MIN;
  const p = localParts(from, cal.timezone);
  let [y, m, d] = [p.year, p.month, p.day];
  const cursor = from.getTime();
  for (let i = 0; i < MAX_SCAN_DAYS + Math.ceil(minutes / businessMinutesPerDay(cal)) * 7; i++) {
    if (isBusinessDay(y, m, d, cal)) {
      const [ws, we] = windowFor(y, m, d, cal);
      const s = Math.max(ws, cursor);
      if (we > s) {
        const avail = we - s;
        if (remaining <= avail) return new Date(s + remaining);
        remaining -= avail;
      }
    }
    [y, m, d] = shiftDate(y, m, d, 1);
  }
  throw new Error('addBusinessMinutes: exceeded scan window');
}

/** Local ISO date (YYYY-MM-DD) of an instant in the calendar's timezone. */
export function localDate(d: Date, tz: string): string {
  const p = localParts(d, tz);
  return isoDate(p.year, p.month, p.day);
}

/** Start of a local calendar date (00:00 in `tz`) shifted by `offsetDays`, as a Date. */
export function startOfLocalDate(isoDay: string, tz: string, offsetDays = 0): Date {
  const [yy, mm, dd] = isoDay.slice(0, 10).split('-').map(Number);
  const [y, m, d] = shiftDate(yy, mm, dd, offsetDays);
  return new Date(zonedTimeToUtc(y, m, d, 0, 0, tz));
}
