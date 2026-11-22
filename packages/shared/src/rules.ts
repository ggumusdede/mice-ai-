// §8 Blok 5 — Kurallar ve eşikler. "Kod değil tablo; yönetici değiştirir."
// These are the DEFAULT values seeded per tenant into the `rules` table. Runtime code must read
// the tenant's rules (DB) and fall back to these defaults only when a key is missing.

export interface MarkupTier {
  /** inclusive lower bound of channel advantage, as fraction (0.05 = 5%) */
  minAdvantage: number;
  /** markup on cost as fraction (0.25 = 25%) */
  markup: number;
}

/** §16.5 (additive) supplier × season scoped markup. Applied ONLY when the price class of an offer is unknown (no matching
 *  channel price / no history): instead of falling back to the lowest tier, the evidence-backed seasonal markup is suggested.
 *  When a real channel advantage exists the tier table still decides. Months are 1..12 (local date of the service). */
export interface SupplierSeasonMarkup {
  supplierId: string;
  supplierName?: string;
  months: number[];
  /** markup on cost as fraction */
  markup: number;
  note?: string;
}

/** §16.5 (additive) per-supplier RFQ follow-up hours (overrides rfqReminderHours / rfqCallTaskHours for that supplier). */
export interface SupplierRfqHours {
  supplierId: string;
  supplierName?: string;
  reminderHours: number;
  callTaskHours: number;
  note?: string;
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
  /** [Ürün kararı] §15 × §16: AI action types (e.g. 'customer_quote') or decision kinds (e.g. 'quote_approval') that are never
   *  promoted to / executed in auto mode (no promotion proposal either). Default: customer quote approval + margin override —
   *  §15 requires Face ID for money commitments, an AI auto-approval would bypass it. Structural §6 list stays on top. */
  neverAutomateKinds: string[];
  /** [Ürün kararı] §6 × §16: true → the admin's automation promotion counts as a standing approval and promoted outbound
   *  messages (RFQ, negotiation, option extension, revision request) are sent automatically (with the ~1/20 sample audit).
   *  false (default) → promoted outbound messages still open a one-tap approval card; nothing leaves without a human. */
  outboundAutoSendRequiresStandingApproval: boolean;
  /** [Ürün kararı] Supplier-facing outputs (RFQ e-mail / reminder, supplier portal, negotiation, confirmation, revision
   *  request, rooming list, mail headers) use the supplier-safe reference (PRJ-0042-20270312-80) instead of the project code
   *  that contains the customer name. Default true. */
  hideCustomerFromSuppliers: boolean;
  /** [Ürün kararı] Least privilege: false (default) → the field role sees no profit / P&L / finance entries / quote cost &
   *  margin / contract amounts / drafts of other users (enforced server-side). */
  fieldRoleCanSeeFinancials: boolean;
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
  /** §16.5 scoped overrides (default empty → behaviour unchanged) */
  supplierSeasonMarkups: SupplierSeasonMarkup[];
  supplierRfqHours: SupplierRfqHours[];
  /** §15 / docs/07 §1: a critical push not opened within N minutes → WhatsApp / SMS fallback to the admin (0 = off) */
  criticalPushFallbackMinutes: number;
  /** §8 İlk veri yükü: only projects / prices closed within the last N months are imported (older rows are flagged and
   *  excluded). PRD: "yalnızca son 12–18 ayın kapanmış projeleri". Admin changes it in Kurallar. */
  initialImportWindowMonths: number;
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
  neverAutomateKinds: ['customer_quote', 'quote_approval', 'margin_override'],
  outboundAutoSendRequiresStandingApproval: false,
  hideCustomerFromSuppliers: true,
  fieldRoleCanSeeFinancials: false,
  guestDataRetentionDays: 730,
  lowSupplierScore: 50,
  projectCodePrefix: 'PRJ',
  vatRates: { accommodation: 0.1, service: 0.2 },
  accommodationTaxRate: 0.02,
  quoteOptionsMin: 2,
  quoteOptionsMax: 3,
  supplierSeasonMarkups: [],
  supplierRfqHours: [],
  criticalPushFallbackMinutes: 15,
  initialImportWindowMonths: 18,
};

export type RuleKey = keyof TenantRules;
