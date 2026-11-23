// §7 Adım 2 Normalizasyon: kişi başı / gün başı, KDV hariç, konaklama vergisi ayrı, tek para birimi (EUR)
import type { Currency, NormalizedOffer, ServiceItem, SupplierOffer, HiddenCost, OfferLine } from '@mice/shared';
import { round2 } from './pricing.js';

function rateOf(currency: string, rates: Record<string, number>): number {
  const cur = currency.toUpperCase();
  // v0.5 S-19: `rates` may be rebased on the project's base currency (rebaseRates) — then EUR has its own entry
  if (cur === 'EUR' && rates.EUR === undefined) return 1;
  const r = rates[cur] ?? rates[currency];
  if (r === undefined || !Number.isFinite(r) || r <= 0) throw new Error(`Unknown or invalid FX rate for currency ${currency}`);
  return r;
}

/** rates: 1 EUR = rates[currency] units. EUR→1. Throws on unknown currency.
 *  v0.5 S-19: with rates rebased on a base currency B (1 B = rates[c]), toEur/fromEur convert to/from B. */
export function toEur(amount: number, currency: string, rates: Record<string, number>): number {
  return amount / rateOf(currency, rates);
}
export function fromEur(amountEur: number, currency: string, rates: Record<string, number>): number {
  return amountEur * rateOf(currency, rates);
}

export interface NormalizeContext {
  item: Pick<ServiceItem, 'kind' | 'quantity' | 'nights' | 'dateFrom' | 'dateTo'>;
  pax: number | null;
  days: number | null;
  rates: Record<string, number>;
  accommodationTaxRate: number;
  /** (additive, v0.5 S-19) currency the rates are based on (the result amounts are in it); default EUR */
  baseCurrency?: Currency;
}

/** Inclusive day count between two ISO dates (YYYY-MM-DD), or null. */
export function daysInclusive(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(to.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Number of units a line is billed for: quantity × nights (when nights present). */
export function lineMultiplier(line: Pick<OfferLine, 'quantity' | 'nights'>): number {
  const q = Number.isFinite(line.quantity) ? line.quantity : 0;
  return line.nights != null && line.nights > 0 ? q * line.nights : q;
}

export interface NormalizedLine {
  netExVat: number; // offer currency, ex VAT and ex accommodation tax
  accommodationTax: number;
  vat: number;
}

/** Splits a single offer line into net / accommodation tax / VAT (offer currency).
 *  Accommodation tax (accommodation lines only) and VAT are both computed on the net (VAT- and tax-exclusive) amount
 *  and reported separately. */
export function splitLine(line: OfferLine, accommodationTaxRate: number): NormalizedLine {
  const gross = line.unitPrice * lineMultiplier(line);
  const vatRate = line.vatRate > 0 ? line.vatRate : 0;
  const isAccommodation = line.kind === 'accommodation';
  const taxRate = isAccommodation && accommodationTaxRate > 0 ? accommodationTaxRate : 0;
  const taxIncluded = isAccommodation && line.accommodationTaxIncluded === true;
  // price as quoted = net × (1 + (vatIncluded ? vat : 0) + (taxIncluded ? tax : 0))
  const divisor = 1 + (line.vatIncluded ? vatRate : 0) + (taxIncluded ? taxRate : 0);
  const net = gross / divisor;
  return { netExVat: net, accommodationTax: net * taxRate, vat: net * vatRate };
}

/** Strip VAT (when vatIncluded) and accommodation tax (when included) from each line, convert to EUR,
 *  compute totals and per-person / per-person-per-day / per-room-night unit prices, and detect hidden costs. */
export function normalizeOffer(offer: SupplierOffer, ctx: NormalizeContext): NormalizedOffer {
  const fx = rateOf(offer.currency, ctx.rates);
  let net = 0;
  let tax = 0;
  let vat = 0;
  let accNet = 0;
  let roomNights = 0;
  for (const line of offer.lines) {
    const s = splitLine(line, ctx.accommodationTaxRate);
    net += s.netExVat;
    tax += s.accommodationTax;
    vat += s.vat;
    if (line.kind === 'accommodation') {
      accNet += s.netExVat;
      roomNights += lineMultiplier(line);
    }
  }
  const netEur = net / fx;
  const pax = ctx.pax != null && ctx.pax > 0 ? ctx.pax : null;
  const days = ctx.days != null && ctx.days > 0 ? ctx.days : daysInclusive(ctx.item.dateFrom, ctx.item.dateTo);

  // per-room-night: for accommodation items use the accommodation lines; fallback on item quantity × nights
  let perRoomNight: number | null = null;
  if (ctx.item.kind === 'accommodation') {
    if (roomNights > 0) perRoomNight = round2(accNet / fx / roomNights);
    else if (ctx.item.quantity > 0 && (ctx.item.nights ?? 0) > 0) perRoomNight = round2(netEur / (ctx.item.quantity * (ctx.item.nights as number)));
  }

  return {
    offerId: offer.id,
    supplierId: offer.supplierId,
    totalNetExVatEur: round2(netEur),
    accommodationTaxEur: round2(tax / fx),
    vatEur: round2(vat / fx),
    perPersonEur: pax ? round2(netEur / pax) : null,
    perPersonPerDayEur: pax && days ? round2(netEur / pax / days) : null,
    perRoomNightEur: perRoomNight,
    fxRate: fx,
    hiddenCosts: detectHiddenCosts(offer, ctx.pax),
    baseCurrency: ctx.baseCurrency ?? 'EUR',
  };
}

const has = (s: string | null | undefined): s is string => typeof s === 'string' && s.trim().length > 0;
const NON_REFUNDABLE = /(iadesiz|iade edilmez|non[- ]?refundable|no refund|%\s*100|100\s*%)/i;

/** Flags guarantee pax, attrition, prepayment/payment, cancellation, overtime terms (§7 Adım 2 gizli maliyetler). */
export function detectHiddenCosts(offer: SupplierOffer, pax: number | null): HiddenCost[] {
  const out: HiddenCost[] = [];
  if (offer.guaranteePax != null && offer.guaranteePax > 0) {
    if (pax != null && pax > 0 && offer.guaranteePax > pax) {
      out.push({ type: 'guarantee', severity: 'critical', description: `Garanti kişi sayısı (${offer.guaranteePax}) talep edilen kişi sayısından (${pax}) fazla — fark ödenir.` });
    } else if (pax != null && pax > 0 && offer.guaranteePax / pax >= 0.9) {
      out.push({ type: 'guarantee', severity: 'warning', description: `Garanti kişi sayısı ${offer.guaranteePax} / ${pax} (%${Math.round((offer.guaranteePax / pax) * 100)}) — düşüş payı dar.` });
    } else {
      out.push({ type: 'guarantee', severity: 'info', description: `Garanti kişi sayısı: ${offer.guaranteePax}.` });
    }
  }
  if (has(offer.attritionTerms)) {
    out.push({ type: 'attrition', severity: 'warning', description: `Attrition koşulu: ${offer.attritionTerms.trim()}` });
  }
  if (offer.prepaymentRate != null && offer.prepaymentRate > 0) {
    const pct = Math.round(offer.prepaymentRate * 100);
    out.push({ type: 'payment', severity: offer.prepaymentRate >= 0.5 ? 'critical' : 'warning', description: `Tedarikçi %${pct} ön ödeme istiyor.` });
  }
  if (has(offer.paymentTerms)) {
    out.push({ type: 'payment', severity: 'info', description: `Ödeme koşulu: ${offer.paymentTerms.trim()}` });
  }
  if (has(offer.cancellationTerms)) {
    const strict = NON_REFUNDABLE.test(offer.cancellationTerms.toLocaleLowerCase('tr-TR'));
    out.push({ type: 'cancellation', severity: strict ? 'critical' : 'warning', description: `İptal koşulu: ${offer.cancellationTerms.trim()}` });
  }
  if (has(offer.overtimeTerms)) {
    out.push({ type: 'overtime', severity: 'warning', description: `Overtime koşulu: ${offer.overtimeTerms.trim()}` });
  }
  return out;
}
