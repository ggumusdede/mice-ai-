// §9 Fiyat değerlendirme ve marj mantığı
import type { MarkupTier, ProfitSummary } from '@mice/shared';

/** Tolerance used for tier boundaries so that floating-point noise (e.g. (100-95)/100 = 0.04999…) does not drop a tier. */
const EPS = 1e-9;

/** Avantaj % = (Kanal fiyatı − net fiyat) ÷ Kanal fiyatı. Returns null if channel price <= 0. */
export function channelAdvantage(channelPrice: number, netPrice: number): number | null {
  if (!Number.isFinite(channelPrice) || !Number.isFinite(netPrice) || channelPrice <= 0) return null;
  return (channelPrice - netPrice) / channelPrice;
}

/** Advantage → markup on cost using tier table (highest tier whose minAdvantage <= advantage). Negative advantage → lowest tier. */
export function markupForAdvantage(advantage: number, tiers: MarkupTier[]): number {
  if (!tiers.length) throw new Error('markupForAdvantage: empty tier table');
  const sorted = [...tiers].sort((a, b) => a.minAdvantage - b.minAdvantage);
  let chosen = sorted[0];
  if (!Number.isFinite(advantage)) return chosen.markup;
  for (const t of sorted) {
    if (t.minAdvantage <= advantage + EPS) chosen = t;
  }
  return chosen.markup;
}

/** 100 cost, 0.25 markup → 125 (rounded to 2 decimals). */
export function priceFromCost(cost: number, markup: number): number {
  return round2(cost * (1 + markup));
}

/** markup 0.25 → margin 0.2 */
export function marginFromMarkup(markup: number): number {
  if (markup <= -1) throw new Error('marginFromMarkup: markup must be > -1');
  return markup / (1 + markup);
}

/** margin 0.2 → markup 0.25 */
export function markupFromMargin(margin: number): number {
  if (margin >= 1) throw new Error('markupFromMargin: margin must be < 1');
  return margin / (1 - margin);
}

/** Kâr÷Satış (margin) and Kâr÷Alış (markup) always separate. Zero-safe. */
export function profitSummary(costEur: number, saleEur: number): ProfitSummary {
  const profit = saleEur - costEur;
  return {
    costEur: round2(costEur),
    saleEur: round2(saleEur),
    profitEur: round2(profit),
    margin: saleEur !== 0 ? profit / saleEur : 0,
    markup: costEur !== 0 ? profit / costEur : 0,
  };
}

export function sumProfit(parts: ProfitSummary[]): ProfitSummary {
  let cost = 0;
  let sale = 0;
  for (const p of parts) {
    cost += p.costEur;
    sale += p.saleEur;
  }
  return profitSummary(cost, sale);
}

/** Round half-away-from-zero to 2 decimals. */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return n;
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  // toPrecision(15) removes binary representation noise (1.005*100 = 100.49999999999999 → 100.5 → 101)
  const r = (sign * Math.round(Number((abs * 100).toPrecision(15)))) / 100;
  return r === 0 ? 0 : r; // avoid -0
}
