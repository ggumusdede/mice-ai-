// §8 Blok 5 — Kurallar ve eşikler. "Kod değil tablo; yönetici değiştirir."
// These are the DEFAULT values seeded per tenant into the `rules` table. Runtime code must read
// the tenant's rules (DB) and fall back to these defaults only when a key is missing.

export interface MarkupTier {
  /** inclusive lower bound of channel advantage, as fraction (0.05 = 5%) */
  minAdvantage: number;
  /** markup on cost as fraction (0.25 = 25%) */
  markup: number;
}

export interface TenantRules {
  /** §9 Kanal fiyatına göre avantaj → markup tablosu */
  markupTiers: MarkupTier[];
  /** §7 Adım 3 Hedef marj altı bloklanır (Kâr÷Satış). */
  targetMarginMin: number;
  /** §7 Adım 2 "iyi fiyat" eşiği: konaklamada kanal avantajı, diğer kalemlerde geçmiş medyana göre indirim */
  goodPriceAdvantage: number;
  goodPriceVsMedian: number;
  /** §7 Adım 3 standart opsiyon süresi (iş günü) */
  customerOptionBusinessDays: number;
  /** §17.6 RFQ takip */
  rfqReminderHours: number;
  rfqCallTaskHours: number;
  rfqMinSuppliers: number;
  rfqMaxSuppliers: number;
  maxNegotiationRounds: number;
  /** §7 Adım 4 takip */
  quoteFollowupBusinessDays: number;
  optionExpiryWarningDays: number;
  /** §17.10 teklif süresi hedefi */
  quoteTargetBusinessDays: number;
  /** mesai saatleri */
  businessHours: { start: string; end: string; days: number[]; timezone: string; holidays: string[] };
  /** §17.1 saha ekstra limitleri (TRY) */
  fieldExtraPerItemLimitTry: number;
  fieldExtraPerProjectLimitTry: number;
  /** §7 Adım 7 fatura edilmemiş ödeme eskalasyonu */
  unbilledPaymentEscalationDays: number;
  /** §7 Adım 8 kapanış süresi */
  closingDeadlineDays: number;
  /** §16 otomasyon terfisi */
  automationPromotionThreshold: number;
  automationSampleRate: number;
  /** §6 güven puanı eşiği */
  aiConfidenceThreshold: number;
  /** §17.9 KVKK: rıza vermeyen misafir verisinin saklama süresi (gün) — avukat belirleyecek */
  guestDataRetentionDays: number;
  /** düşük tedarikçi skoru uyarı eşiği (0..100) */
  lowSupplierScore: number;
  /** §7 Adım 0 proje kodu formatı */
  projectCodePrefix: string;
  /** VAT rates (TR defaults) */
  vatRates: { accommodation: number; service: number };
  /** Konaklama vergisi (TR, 2026: %2) */
  accommodationTaxRate: number;
  /** §7 Adım 3 teklif seçenek sayısı */
  quoteOptionsMin: number;
  quoteOptionsMax: number;
}

export const DEFAULT_RULES: TenantRules = {
  markupTiers: [
    { minAdvantage: 0, markup: 0.05 },
    { minAdvantage: 0.05, markup: 0.1 },
    { minAdvantage: 0.1, markup: 0.15 },
    { minAdvantage: 0.15, markup: 0.2 },
    { minAdvantage: 0.2, markup: 0.25 },
  ],
  targetMarginMin: 0.08,
  goodPriceAdvantage: 0.15,
  goodPriceVsMedian: 0.05,
  customerOptionBusinessDays: 7,
  rfqReminderHours: 24,
  rfqCallTaskHours: 48,
  rfqMinSuppliers: 3,
  rfqMaxSuppliers: 5,
  maxNegotiationRounds: 3,
  quoteFollowupBusinessDays: 2,
  optionExpiryWarningDays: 2,
  quoteTargetBusinessDays: 2,
  businessHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5], timezone: 'Europe/Istanbul', holidays: [] },
  fieldExtraPerItemLimitTry: 5000,
  fieldExtraPerProjectLimitTry: 15000,
  unbilledPaymentEscalationDays: 7,
  closingDeadlineDays: 30,
  automationPromotionThreshold: 20,
  automationSampleRate: 0.05,
  aiConfidenceThreshold: 0.8,
  guestDataRetentionDays: 730,
  lowSupplierScore: 50,
  projectCodePrefix: 'PRJ',
  vatRates: { accommodation: 0.1, service: 0.2 },
  accommodationTaxRate: 0.02,
  quoteOptionsMin: 2,
  quoteOptionsMax: 3,
};

export type RuleKey = keyof TenantRules;
