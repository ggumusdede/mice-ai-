// Saha paneli (§7 Adım 6): "Bugünkü projeler" = event dates include today; "Yaklaşan" = starts within the next 7 days.
import type { Project } from '@mice/shared';

type Dated = Pick<Project, 'startDate' | 'endDate'>;

/** The event dates (start…end, inclusive) include `today` (YYYY-MM-DD). */
export function isToday(p: Dated, today: string): boolean {
  if (!p.startDate) return false;
  const end = p.endDate ?? p.startDate;
  return p.startDate <= today && today <= end;
}

export function addDaysISO(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Starts tomorrow … today + `days` (and is not running today). */
export function isUpcoming(p: Dated, today: string, days = 7): boolean {
  if (!p.startDate || isToday(p, today)) return false;
  return p.startDate > today && p.startDate <= addDaysISO(today, days);
}
