// §9 Fiyat değerlendirme ve marj mantığı
import type { MarkupTier, ProfitSummary } from '@mice/shared';
import { notImplemented } from './_todo.js';

/** Avantaj % = (Kanal fiyatı − net fiyat) ÷ Kanal fiyatı. Returns null if channel price <= 0. */
export function channelAdvantage(channelPrice: number, netPrice: number): number | null { return notImplemented('channelAdvantage'); }
/** Advantage → markup on cost using tier table (highest tier whose minAdvantage <= advantage). Negative advantage → lowest tier. */
export function markupForAdvantage(advantage: number, tiers: MarkupTier[]): number { return notImplemented('markupForAdvantage'); }
/** 100 cost, 0.25 markup → 125 (rounded to 2 decimals). */
export function priceFromCost(cost: number, markup: number): number { return notImplemented('priceFromCost'); }
/** markup 0.25 → margin 0.2 */
export function marginFromMarkup(markup: number): number { return notImplemented('marginFromMarkup'); }
export function markupFromMargin(margin: number): number { return notImplemented('markupFromMargin'); }
/** Kâr÷Satış (margin) and Kâr÷Alış (markup) always separate. Zero-safe. */
export function profitSummary(costEur: number, saleEur: number): ProfitSummary { return notImplemented('profitSummary'); }
export function sumProfit(parts: ProfitSummary[]): ProfitSummary { return notImplemented('sumProfit'); }
/** Round half-away-from-zero to 2 decimals. */
export function round2(n: number): number { return notImplemented('round2'); }
