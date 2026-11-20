// §7 Adım 3 — Müşteri teklifi onay kapısı
import type { CustomerRules, QuoteOption, ServiceItem, SupplierStatus, TenantRules, User, Customer } from '@mice/shared';
import { notImplemented } from './_todo.js';

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
/** Blocking: customer option longer than any supplier option; margin below target (unless admin override with reason);
 *  candidate (non-accredited) supplier; option count outside [min,max]. Non-blocking warnings: missing day coverage. */
export function validateQuote(input: QuoteValidationInput): QuoteValidationResult { return notImplemented('validateQuote'); }

/** §4 kişi bazlı yetki: does this user's quote need admin approval? */
export function quoteNeedsApproval(user: Pick<User, 'role' | 'authorityLevel' | 'authorityScope'>, customer: Pick<Customer, 'id'> | null, eventType: string | null): boolean { return notImplemented('quoteNeedsApproval'); }
