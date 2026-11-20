// §7 Adım 2 + §9: iyi fiyat / normal fiyat / bilmiyorum
import type { OfferEvaluation, NormalizedOffer, ServiceKind, TenantRules, SupplierStatus } from '@mice/shared';
import { notImplemented } from './_todo.js';

export interface ChannelBenchmark {
  /** channel price per room-night in EUR under IDENTICAL conditions (date, room type, board, cancellation) */
  priceEur: number;
  conditionsMatch: boolean;
}
export interface EvaluateInput {
  kind: ServiceKind;
  normalized: NormalizedOffer;
  supplierStatus: SupplierStatus;
  /** accommodation only */
  channel?: ChannelBenchmark | null;
  /** non-accommodation: historical unit prices (EUR, same city/segment/season, same unit basis) */
  history?: number[];
  rules: Pick<TenantRules, 'markupTiers' | 'goodPriceAdvantage' | 'goodPriceVsMedian'>;
  valueAdd?: boolean;
}
/** Never guesses (§3.7): no channel data with matching conditions / no history → priceClass 'unknown', advantage null.
 *  Accommodation markup from tier table; other kinds: markup suggested from tier of advantage-vs-median, unknown → lowest tier.
 *  Value-add items: tier table not applied (suggestedMarkup null). Candidate suppliers flagged with a risk line. */
export function evaluateOffer(input: EvaluateInput): OfferEvaluation { return notImplemented('evaluateOffer'); }
export function median(values: number[]): number | null { return notImplemented('median'); }
