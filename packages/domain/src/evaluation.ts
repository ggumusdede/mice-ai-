// §7 Adım 2 + §9: iyi fiyat / normal fiyat / bilmiyorum
import type { OfferEvaluation, NormalizedOffer, ServiceKind, TenantRules, SupplierStatus, PriceClass } from '@mice/shared';
import { channelAdvantage, markupForAdvantage } from './pricing.js';
import { contractAdvantage } from './procurement.js';

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
  /** (additive, optional) non-accommodation unit price in EUR on the same basis as `history`.
   *  Defaults to perPersonPerDayEur ?? perPersonEur ?? totalNetExVatEur of the normalized offer. */
  unitPriceEur?: number | null;
  /** (additive, §16.5) supplier × season markup override (see seasonalMarkupFor). Used ONLY when the price class is
   *  unknown, instead of the lowest tier. A measured advantage always goes through the tier table. */
  seasonalMarkup?: number | null;
  /** (additive, v0.5 S-03 / K-11) agreed contract price on the same basis as the offer (accommodation: per room-night; others: the
   *  same unit basis as unitPriceEur), in the same (base) currency. The comparison anchor: shown as "kontrat fiyatı"; when no channel /
   *  history benchmark exists it decides the price class (at or below contract → normal / good). */
  contract?: { contractRateId: string; price: number; label?: string } | null;
}

/** Lowest-tier markup (used when the price class is unknown — never guess a higher margin). */
function lowestMarkup(tiers: TenantRules['markupTiers']): number {
  return markupForAdvantage(Number.NEGATIVE_INFINITY, tiers);
}

/** Never guesses (§3.7): no channel data with matching conditions / no history → priceClass 'unknown', advantage null.
 *  Accommodation markup from tier table; other kinds: markup suggested from tier of advantage-vs-median, unknown → lowest tier.
 *  Value-add items: tier table not applied (suggestedMarkup null). Candidate suppliers flagged with a risk line. */
export function evaluateOffer(input: EvaluateInput): OfferEvaluation {
  const { normalized: n, rules } = input;
  const risks: string[] = [];
  let priceClass: PriceClass = 'unknown';
  let advantage: number | null = null;
  let benchmark: OfferEvaluation['benchmark'] = { type: 'none', value: null };

  if (input.kind === 'accommodation') {
    const ch = input.channel;
    const net = n.perRoomNightEur;
    if (!ch) {
      risks.push('Kanal fiyatı yok — fiyat sınıfı: bilmiyorum.');
    } else if (!ch.conditionsMatch) {
      risks.push('Kanal fiyatı koşulları farklı (tarih / oda tipi / pansiyon / iptal) — kıyaslanmadı, fiyat sınıfı: bilmiyorum.');
    } else if (net == null) {
      risks.push('Oda-gece fiyatı hesaplanamadı — fiyat sınıfı: bilmiyorum.');
    } else {
      const adv = channelAdvantage(ch.priceEur, net);
      if (adv == null) {
        risks.push('Geçersiz kanal fiyatı — fiyat sınıfı: bilmiyorum.');
      } else {
        advantage = adv;
        benchmark = { type: 'channel', value: ch.priceEur };
        priceClass = adv >= rules.goodPriceAdvantage - 1e-9 ? 'good' : 'normal';
        if (adv < 0) risks.push(`Net fiyat kanal fiyatından %${Math.round(-adv * 100)} pahalı.`);
      }
    }
  } else {
    const hist = (input.history ?? []).filter((v) => Number.isFinite(v) && v > 0);
    const m = median(hist);
    const price = input.unitPriceEur ?? n.perPersonPerDayEur ?? n.perPersonEur ?? n.totalNetExVatEur;
    if (m == null || m <= 0) {
      risks.push('Fiyat geçmişi yok — fiyat sınıfı: bilmiyorum.');
    } else if (price == null || !Number.isFinite(price)) {
      risks.push('Birim fiyat hesaplanamadı — fiyat sınıfı: bilmiyorum.');
    } else {
      advantage = (m - price) / m;
      benchmark = { type: 'history_median', value: m, sampleSize: hist.length };
      priceClass = advantage >= rules.goodPriceVsMedian - 1e-9 ? 'good' : 'normal';
      if (advantage < 0) risks.push(`Fiyat geçmiş medyanın %${Math.round(-advantage * 100)} üzerinde.`);
    }
  }

  // v0.5 K-11: contract price is the anchor ("kıyasta çıpa kontrat fiyatıdır")
  let contractBenchmark: OfferEvaluation['contractBenchmark'] = null;
  if (input.contract && input.contract.price > 0) {
    const offerPrice = input.kind === 'accommodation' ? n.perRoomNightEur : input.unitPriceEur ?? n.perPersonPerDayEur ?? n.perPersonEur ?? n.totalNetExVatEur;
    const cAdv = contractAdvantage(input.contract.price, offerPrice);
    contractBenchmark = {
      contractRateId: input.contract.contractRateId, price: input.contract.price, basis: input.kind === 'accommodation' ? 'room_night' : 'unit',
      advantage: cAdv, label: input.contract.label ?? 'Kontrat fiyatı',
    };
    if (cAdv != null && cAdv < -1e-9) risks.push(`Teklif kontrat fiyatının %${Math.round(-cAdv * 1000) / 10} üzerinde — kontrat fiyatını hatırlatın.`);
    if (advantage == null && cAdv != null) {
      advantage = cAdv;
      benchmark = { type: 'contract', value: input.contract.price };
      priceClass = cAdv >= rules.goodPriceVsMedian - 1e-9 ? 'good' : 'normal';
    }
  }

  let suggestedMarkup: number | null;
  if (input.valueAdd) {
    suggestedMarkup = null; // §17.4: kademe tablosu uygulanmaz
    risks.push('Katma değer kalemi (yalnız satış): kademe tablosu uygulanmaz, satış fiyatını acenta belirler.');
  } else if (advantage == null && input.seasonalMarkup != null && Number.isFinite(input.seasonalMarkup) && input.seasonalMarkup >= 0) {
    suggestedMarkup = input.seasonalMarkup;
    risks.push(`Fiyat sınıfı bilinmiyor; tedarikçi/sezon kuralı uygulandı (markup %${Math.round(input.seasonalMarkup * 1000) / 10}).`);
  } else if (advantage == null) {
    suggestedMarkup = lowestMarkup(rules.markupTiers);
  } else {
    suggestedMarkup = markupForAdvantage(advantage, rules.markupTiers);
  }

  const candidateSupplier = input.supplierStatus === 'candidate';
  if (candidateSupplier) risks.push('Aday tedarikçi: müşteriye sunmak ve konfirme etmek için yönetici akreditasyonu şart.');
  if (input.supplierStatus === 'passive') risks.push('Pasif tedarikçi.');
  for (const hc of n.hiddenCosts) {
    if (hc.severity !== 'info') risks.push(hc.description);
  }

  return { offerId: n.offerId, normalized: n, priceClass, advantage, benchmark, suggestedMarkup, risks, candidateSupplier, ...(input.contract ? { contractBenchmark } : {}) };
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
