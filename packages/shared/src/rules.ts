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
  // ---- v0.5-A Ekip, iletişim ve kontrol (docs/12 S-01, S-02, S-09…S-15, S-25, S-26) — temkinli varsayılanlar ----
  /** S-01 hızlı onay: nöbetçiye / sorumluya atanmış dış mesaj kartı N dakika içinde ele alınmazsa sıradaki kişiye yükselir
   *  (nöbetçi → vekili → yönetici). Yalnız bildirim ve atama; otomatik onay asla yok. 0 = kapalı. */
  quickApprovalEscalationMinutes: number;
  /** S-01: mesai dışında açılan dış mesaj kartları nöbet çizelgesindeki kişiye atanır (çizelgede kimse yoksa rol bazlı kalır). */
  onCallAssignOutsideBusinessHours: boolean;
  /** S-01 hazır mesaj şablonlarının acenta metni (anahtar → {subject?, body}); boş = ürünle gelen metin (packages/shared team.ts). */
  quickMessageTemplates: Record<string, { subject?: string; body: string }>;
  /** S-01 tahsilat hatırlatması: vadesi N gün geçmiş alacak için hazır hatırlatma kartı (tek dokunuş, insan onaylı). 0 = kapalı. */
  collectionReminderAfterDays: number;
  /** S-02 / S-26 #8: katılımcıya doğrudan mesaj — projede ayar yoksa bu geçerli. Varsayılan kapalı; müşteri proje bazında açtırır. */
  participantMessagingDefault: 'off' | 'logistics' | 'on';
  /** S-09: kurumsal e-posta alan adları (boş = kullanıcının giriş adresinin alan adı). Kişisel hesap yalnız yönetici istisnasıyla. */
  corporateMailDomains: string[];
  /** S-11: satışçı kendi panosunda tahmini primini görür (acenta tercihi, varsayılan kapalı). Formül şeffaf ve basit. */
  showEstimatedBonus: boolean;
  bonusFormula: { basis: 'realized_profit' | 'planned_profit'; rate: number; onlyCollected: boolean };
  /** S-14: bildirimler varsayılan "her zaman"; acenta (veya çalışan kendisi) sessiz saat açabilir. Kritikler ve nöbetçi geçer. */
  quietHours: { enabled: boolean; start: string; end: string };
  /** S-13 meşgul vekâleti: son tarihli kart (opsiyon, bilet limiti, release …) N saat yanıtsız kalır ve son tarihe M saatten az
   *  kalırsa önce onaylayana kritik bildirim, sonra kart vekile yönlenir. Otomatik onay asla yok. */
  busyDelegationEnabled: boolean;
  busyDelegationWaitHours: number;
  busyDelegationLeadHours: number;
  /** S-15 çevrimdışı saha paketi: ad + oda + transfer grubu (+ telefon), rol bazlı, cihazda şifreli, uzaktan iptal. */
  fieldPackEnabled: boolean;
  fieldPackIncludePhone: boolean;
  /** paket, paket gününün başından itibaren N saat geçerli */
  fieldPackValidHours: number;
  /** S-25 sesli not / sesle yazma: varsayılan kapalı; yönetici uyarıyı okuyup açar. */
  voiceFeaturesEnabled: boolean;
  /** K-04: her müşteride ilişki sahibi + yedek irtibat (küçük ekipte kapatılabilir; kapalıyken yalnız uyarı gösterilmez) */
  requireBackupContact: boolean;
  /** S-26 temkinli varsayılanlar paketi (docs/11 §H, 17 madde). Bazıları v0.6 işlerinin varsayılanıdır (bilgi amaçlı). */
  negotiationUseHotelOwnPublicPrice: boolean;
  rfqShowBudget: boolean;
  supplierQualitativeSummary: boolean;
  supplierPagePoweredBy: boolean;
  crisisDeputyUserId: string | null;
  crisisSpendCapTry: number;
  roomingChangeMode: 'diff_and_full' | 'diff_only' | 'full_only';
  postEventReportBusinessDays: number;
  participantPreferencesRequireConsent: boolean;
  departedMailboxRetentionDays: number;
  officeSupportRoleEnabled: boolean;
  fieldAdvanceSelfViewOnly: boolean;
  cashWeightedProfitSeparate: boolean;
  billingModelRequiresApproval: boolean;
  visaInsuranceTrackingOnly: boolean;
  leakScanGuaranteeDesignPartnersOnly: boolean;
  departedAgencyReadOnlyDays: number;
  /** §8 İlk veri yükü: only projects / prices closed within the last N months are imported (older rows are flagged and
   *  excluded). PRD: "yalnızca son 12–18 ayın kapanmış projeleri". Admin changes it in Kurallar. */
  initialImportWindowMonths: number;
  /** Q5: TCMB rate type used for the TRY value of EUR (or other) movements made WITHOUT conversion (value-date rate).
   *  Default döviz alış (VUK değerleme) [Doğrulanmalı: mali müşavir]. */
  fxRateTypeForReporting: 'tcmb_forex_buying' | 'tcmb_forex_selling' | 'tcmb_banknote_buying' | 'tcmb_banknote_selling';
  /** v0.5 S-06 "Kapora önce": tedarikçi ön ödeme talebi müşteri kaporası tahsil edilmeden gelirse — 'warn' (vars.: uyarı +
   *  zorunlu gerekçe + Face ID istisna) | 'block' (talep açılmaz). */
  depositFirstMode: 'warn' | 'block';
  /** v0.5 S-07 teklif kur politikası: varsayılan kur payı (tampon, 0.02 = %2) — teklif para birimi ana para biriminden farklıysa.
   *  [Ürün kararı] temkinli varsayılan %2. */
  quoteFxBufferDefault: number;
  /** kur payı üst sınırı (bu değerin üstü reddedilir) */
  quoteFxBufferMax: number;
  /** S-07: kur payı müşteriye gizli (vars. false = gizli). true → PDF'te kur ve pay açıkça yazılır. */
  showFxBufferToCustomer: boolean;
  /** S-07: istenirse teklif PDF'ine kur maddesi eklenir (vars. kapalı) */
  showFxClauseOnQuote: boolean;
  quoteFxClauseText: string;
  /** v0.5 S-03 allotment: release tarihinden kaç gün önce "release et / tut" kartı açılır (T-x) */
  allotmentReleaseWarningDays: number;
  /** v0.5 S-03 opsiyon: bitişten kaç gün önce "Uzat / Bırak / Konfirme et" kartı (T-3) */
  supplierOptionWarningDays: number;
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
  // v0.5-A Ekip, iletişim ve kontrol (temkinli varsayılanlar)
  quickApprovalEscalationMinutes: 10,
  onCallAssignOutsideBusinessHours: true,
  quickMessageTemplates: {},
  collectionReminderAfterDays: 3,
  participantMessagingDefault: 'off',
  corporateMailDomains: [],
  showEstimatedBonus: false,
  bonusFormula: { basis: 'realized_profit', rate: 0.05, onlyCollected: true },
  quietHours: { enabled: false, start: '22:00', end: '08:00' },
  busyDelegationEnabled: true,
  busyDelegationWaitHours: 4,
  busyDelegationLeadHours: 24,
  fieldPackEnabled: true,
  fieldPackIncludePhone: true,
  fieldPackValidHours: 36,
  voiceFeaturesEnabled: false,
  requireBackupContact: true,
  negotiationUseHotelOwnPublicPrice: false,
  rfqShowBudget: false,
  supplierQualitativeSummary: false,
  supplierPagePoweredBy: false,
  crisisDeputyUserId: null,
  crisisSpendCapTry: 25000,
  roomingChangeMode: 'diff_and_full',
  postEventReportBusinessDays: 3,
  participantPreferencesRequireConsent: true,
  departedMailboxRetentionDays: 90,
  officeSupportRoleEnabled: false,
  fieldAdvanceSelfViewOnly: true,
  cashWeightedProfitSeparate: true,
  billingModelRequiresApproval: true,
  visaInsuranceTrackingOnly: true,
  leakScanGuaranteeDesignPartnersOnly: true,
  departedAgencyReadOnlyDays: 90,
  initialImportWindowMonths: 18,
  fxRateTypeForReporting: 'tcmb_forex_buying',
  depositFirstMode: 'warn',
  quoteFxBufferDefault: 0.02,
  quoteFxBufferMax: 0.15,
  showFxBufferToCustomer: false,
  showFxClauseOnQuote: false,
  quoteFxClauseText: 'Fiyatlar teklif tarihindeki kur esas alınarak hesaplanmıştır; kur politikası alanında belirtilen tarihe kadar sabittir.',
  allotmentReleaseWarningDays: 7,
  supplierOptionWarningDays: 3,
};

export type RuleKey = keyof TenantRules;
