// §16.5 scoped rule overrides (additive). Defaults are empty lists, so every lookup returns the global behaviour
// unless an admin approved a scoped override (rule_suggestion decision or PATCH /api/rules).
import type { SupplierRfqHours, SupplierSeasonMarkup, TenantRules } from '@mice/shared';

/** Month (1..12) of an ISO date / timestamp string; null when unparseable. */
export function monthOf(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const m = /^\d{4}-(\d{2})/.exec(isoDate);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 12 ? n : null;
}

/** The supplier × season markup override for a service date, or null (→ global tier behaviour). */
export function seasonalMarkupFor(
  overrides: SupplierSeasonMarkup[] | undefined, supplierId: string | null | undefined, serviceDate: string | null | undefined,
): SupplierSeasonMarkup | null {
  if (!overrides?.length || !supplierId) return null;
  const month = monthOf(serviceDate);
  if (month == null) return null;
  return overrides.find((o) => o.supplierId === supplierId && Array.isArray(o.months) && o.months.includes(month)
    && Number.isFinite(o.markup) && o.markup >= 0) ?? null;
}

/** RFQ reminder / call-task hours for a supplier: scoped override when present, else the tenant-wide rules. */
export function rfqHoursFor(
  rules: Pick<TenantRules, 'rfqReminderHours' | 'rfqCallTaskHours'> & { supplierRfqHours?: SupplierRfqHours[] }, supplierId: string,
): { reminderHours: number; callTaskHours: number; scoped: boolean } {
  const o = rules.supplierRfqHours?.find((x) => x.supplierId === supplierId);
  if (o && o.reminderHours > 0 && o.callTaskHours > o.reminderHours) return { reminderHours: o.reminderHours, callTaskHours: o.callTaskHours, scoped: true };
  return { reminderHours: rules.rfqReminderHours, callTaskHours: rules.rfqCallTaskHours, scoped: false };
}
