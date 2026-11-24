// §7 Adım 3 — Müşteri teklifi onay kapısı
import type { CustomerRules, QuoteOption, ServiceItem, SupplierStatus, TenantRules, User, Customer } from '@mice/shared';

export interface QuoteValidationInput {
  options: QuoteOption[];
  items: Pick<ServiceItem, 'id' | 'kind' | 'dateFrom' | 'dateTo' | 'description' | 'valueAdd'>[];
  /** supplier status per offer/line supplier (by serviceItemId) */
  supplierStatusByItem: Record<string, SupplierStatus | null>;
  customerOptionUntil: string | null; // ISO date
  customerRules: CustomerRules | null;
  rules: Pick<TenantRules, 'targetMarginMin' | 'quoteOptionsMin' | 'quoteOptionsMax'>;
  /** event dates, used to detect missing per-day items (e.g. a day's hall / coffee break forgotten) */
  eventStartDate: string | null;
  eventEndDate: string | null;
  marginOverrideReason?: string | null;
  overrideByAdmin?: boolean;
}
export interface QuoteValidationIssue { code: 'option_exceeds_supplier' | 'below_target_margin' | 'candidate_supplier' | 'option_count' | 'missing_day_item' | 'missing_line' | 'zero_price' | 'customer_rule'; message: string; blocking: boolean; optionNo?: number; serviceItemId?: string }
export interface QuoteValidationResult { blocked: boolean; issues: QuoteValidationIssue[]; appliedCustomerRules: string[] }

/** §17.2 default for undefined / new customers: signed approval or PO, no deposit. */
export const DEFAULT_CUSTOMER_RULES: CustomerRules = {
  firmApproval: 'signed_or_po',
  depositRate: 0,
  omitPaymentCancellationClauses: false,
  specialClauses: [],
  preferredLanguage: 'tr',
  preferredCurrency: 'EUR',
};

const d10 = (s: string) => s.slice(0, 10);
const pct = (x: number) => `%${(Math.round(x * 1000) / 10).toString().replace('.', ',')}`;

/** Lists every ISO date from `from` to `to` inclusive (UTC date arithmetic). */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let t = Date.parse(d10(from) + 'T00:00:00Z');
  const end = Date.parse(d10(to) + 'T00:00:00Z');
  if (Number.isNaN(t) || Number.isNaN(end)) return out;
  for (; t <= end && out.length < 1000; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Human-readable list of customer rules applied to the quote (visible marking §7 Adım 3). */
export function describeCustomerRules(rules: CustomerRules | null): string[] {
  const r = rules ?? DEFAULT_CUSTOMER_RULES;
  const out: string[] = [];
  if (!rules) out.push('Varsayılan müşteri kuralları uygulandı (yeni / tanımsız müşteri)');
  out.push(r.firmApproval === 'online' ? 'Kesin onay: online onay yeterli' : 'Kesin onay: imzalı onay veya PO şart');
  out.push(r.depositRate > 0 ? `Kapora: ${pct(r.depositRate)}` : 'Kapora yok');
  if (r.omitPaymentCancellationClauses) out.push('Teklifte ödeme / iptal maddesi yer almaz');
  for (const c of r.specialClauses) if (c.trim()) out.push(`Özel madde: ${c.trim()}`);
  return out;
}

/** Blocking: customer option longer than any supplier option; margin below target (unless admin override with reason);
 *  candidate (non-accredited) supplier; option count outside [min,max]. Non-blocking warnings: missing day coverage. */
export function validateQuote(input: QuoteValidationInput): QuoteValidationResult {
  const issues: QuoteValidationIssue[] = [];
  const { rules } = input;
  const itemById = new Map(input.items.map((i) => [i.id, i]));

  // 1) option count (2–3)
  const n = input.options.length;
  if (n < rules.quoteOptionsMin || n > rules.quoteOptionsMax) {
    issues.push({ code: 'option_count', blocking: true, message: `Teklifte ${rules.quoteOptionsMin}–${rules.quoteOptionsMax} seçenek olmalı; şu an ${n}.` });
  }

  const overrideOk = input.overrideByAdmin === true && !!input.marginOverrideReason && input.marginOverrideReason.trim().length > 0;
  const candidateFlagged = new Set<string>();

  for (const opt of input.options) {
    const o = opt.optionNo;

    // 2) customer option must not exceed the earliest supplier option among this option's lines
    const supplierDates = opt.lines.filter((l) => !l.valueAdd && l.supplierOptionUntil).map((l) => d10(l.supplierOptionUntil as string));
    if (input.customerOptionUntil && supplierDates.length) {
      const earliest = supplierDates.sort()[0];
      const cust = d10(input.customerOptionUntil);
      if (cust > earliest) {
        const line = opt.lines.find((l) => !l.valueAdd && l.supplierOptionUntil && d10(l.supplierOptionUntil) === earliest);
        issues.push({ code: 'option_exceeds_supplier', blocking: true, optionNo: o, serviceItemId: line?.serviceItemId, message: `Seçenek ${o}: müşteri opsiyonu (${cust}) tedarikçi opsiyonundan (${earliest}) uzun olamaz.` });
      }
    }

    // 3) margin vs target (Kâr ÷ Satış)
    const margin = opt.totals.saleEur > 0 ? opt.totals.margin : 0;
    if (margin < rules.targetMarginMin - 1e-9) {
      issues.push({
        code: 'below_target_margin',
        blocking: !overrideOk,
        optionNo: o,
        message: overrideOk
          ? `Seçenek ${o}: marj ${pct(margin)} hedef ${pct(rules.targetMarginMin)} altında — yönetici gerekçesiyle açıldı: ${input.marginOverrideReason!.trim()}`
          : `Seçenek ${o}: marj ${pct(margin)} hedef ${pct(rules.targetMarginMin)} altında — yalnızca yönetici gerekçe yazarak açabilir.`,
      });
    }

    // 4) candidate suppliers & zero price lines
    for (const l of opt.lines) {
      if (input.supplierStatusByItem[l.serviceItemId] === 'candidate' && !candidateFlagged.has(l.serviceItemId)) {
        candidateFlagged.add(l.serviceItemId);
        issues.push({ code: 'candidate_supplier', blocking: true, serviceItemId: l.serviceItemId, optionNo: o, message: `"${l.description}": aday (akredite olmayan) tedarikçi — müşteriye sunmak için yönetici akreditasyonu şart.` });
      }
      if (!l.valueAdd && l.unitPriceEur <= 0) {
        issues.push({ code: 'zero_price', blocking: false, optionNo: o, serviceItemId: l.serviceItemId, message: `Seçenek ${o}: "${l.description}" satış fiyatı 0.` });
      } else if (!l.valueAdd && l.unitCostEur <= 0) {
        issues.push({ code: 'zero_price', blocking: false, optionNo: o, serviceItemId: l.serviceItemId, message: `Seçenek ${o}: "${l.description}" alış fiyatı 0 — katma değer kalemi değilse maliyet eksik.` });
      }
    }

    // 5) service items missing from this option
    const inOption = new Set(opt.lines.map((l) => l.serviceItemId));
    for (const it of input.items) {
      if (!inOption.has(it.id)) {
        issues.push({ code: 'missing_line', blocking: false, optionNo: o, serviceItemId: it.id, message: `Seçenek ${o}: "${it.description}" kalemi teklifte yok.` });
      }
    }

    // 6) per-day coverage (accommodation nights / hall days / F&B days) for kinds present in the option
    if (input.eventStartDate && input.eventEndDate) {
      const optItems = [...inOption].map((id) => itemById.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
      const allDays = eachDate(input.eventStartDate, input.eventEndDate);
      const checks: { kind: 'accommodation' | 'hall' | 'fnb'; days: string[]; label: string }[] = [
        { kind: 'accommodation', days: allDays.slice(0, -1), label: 'konaklama (gece)' },
        { kind: 'hall', days: allDays, label: 'salon' },
        { kind: 'fnb', days: allDays, label: 'yiyecek-içecek' },
      ];
      for (const c of checks) {
        const ofKind = optItems.filter((i) => i.kind === c.kind);
        if (!ofKind.length || ofKind.every((i) => !i.dateFrom)) continue;
        const covered = new Set<string>();
        for (const i of ofKind) {
          if (!i.dateFrom) continue;
          const to = i.dateTo ?? i.dateFrom;
          // accommodation dateTo is the check-out date → nights until the day before
          let days = eachDate(i.dateFrom, to);
          if (c.kind === 'accommodation' && i.dateTo && d10(i.dateTo) > d10(i.dateFrom)) days = days.slice(0, -1);
          days.forEach((d) => covered.add(d));
        }
        const missing = c.days.filter((d) => !covered.has(d));
        if (missing.length) {
          issues.push({ code: 'missing_day_item', blocking: false, optionNo: o, message: `Seçenek ${o}: ${c.label} kalemi şu günler için yok: ${missing.join(', ')}.` });
        }
      }
    }
  }

  return { blocked: issues.some((i) => i.blocking), issues, appliedCustomerRules: describeCustomerRules(input.customerRules) };
}

/** §4 kişi bazlı yetki: does this user's quote need admin approval? */
export function quoteNeedsApproval(user: Pick<User, 'role' | 'authorityLevel' | 'authorityScope'>, customer: Pick<Customer, 'id'> | null, eventType: string | null): boolean {
  if (user.role === 'admin') return false;
  if (user.role !== 'clerk_sales') return true; // only sales clerks send quotes under their own authority
  switch (user.authorityLevel) {
    case 'full':
      return false;
    case 'scoped': {
      const scope = user.authorityScope ?? {};
      const customerOk = !!customer && (scope.customerIds ?? []).includes(customer.id);
      const norm = (s: string) => s.trim().toLocaleLowerCase('tr-TR');
      const eventOk = !!eventType && (scope.eventTypes ?? []).some((e) => norm(e) === norm(eventType));
      return !(customerOk || eventOk);
    }
    default:
      return true;
  }
}
