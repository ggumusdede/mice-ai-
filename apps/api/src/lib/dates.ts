/** YYYY-MM-DD of an instant in a timezone (default Europe/Istanbul). */
export function isoDate(d: Date, timeZone = 'Europe/Istanbul'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function addDaysIso(date: string, days: number): string {
  const t = Date.parse(date.slice(0, 10) + 'T00:00:00Z') + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function addHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3_600_000);
}

export function minIsoDate(...dates: (string | null | undefined)[]): string | null {
  const v = dates.filter((x): x is string => !!x).map((x) => x.slice(0, 10)).sort();
  return v[0] ?? null;
}

export function iso(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  return d instanceof Date ? d.toISOString() : d;
}

export function nightsBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const n = Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
