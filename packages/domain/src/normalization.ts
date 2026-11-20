// §7 Adım 2 Normalizasyon: kişi başı / gün başı, KDV hariç, konaklama vergisi ayrı, tek para birimi (EUR)
import type { NormalizedOffer, ServiceItem, SupplierOffer, HiddenCost } from '@mice/shared';
import { notImplemented } from './_todo.js';

/** rates: 1 EUR = rates[currency] units. EUR→1. Throws on unknown currency. */
export function toEur(amount: number, currency: string, rates: Record<string, number>): number { return notImplemented('toEur'); }
export function fromEur(amountEur: number, currency: string, rates: Record<string, number>): number { return notImplemented('fromEur'); }

export interface NormalizeContext {
  item: Pick<ServiceItem, 'kind' | 'quantity' | 'nights' | 'dateFrom' | 'dateTo'>;
  pax: number | null;
  days: number | null;
  rates: Record<string, number>;
  accommodationTaxRate: number;
}
/** Strip VAT (when vatIncluded) and accommodation tax (when included) from each line, convert to EUR,
 *  compute totals and per-person / per-person-per-day / per-room-night unit prices, and detect hidden costs. */
export function normalizeOffer(offer: SupplierOffer, ctx: NormalizeContext): NormalizedOffer { return notImplemented('normalizeOffer'); }
/** Flags guarantee pax, attrition, prepayment/payment, cancellation, overtime terms (§7 Adım 2 gizli maliyetler). */
export function detectHiddenCosts(offer: SupplierOffer, pax: number | null): HiddenCost[] { return notImplemented('detectHiddenCosts'); }
