// §6 Yapay zekâ yetki sınırları — CLOSED LIST. Anything not listed here can never run autonomously.
// §16 Otomasyon terfisi: only 'suggest' actions can be promoted to auto; 'forbidden' never.

export type AiAuthority = 'autonomous' | 'suggest' | 'forbidden';

export const AI_ACTIONS = {
  // ---- Otonom (onaysız) ----
  request_extraction: { authority: 'autonomous', label: 'Talep ayıklama' },
  document_reading: { authority: 'autonomous', label: 'Belge okuma (teklif, sözleşme, fatura, ekstre)' },
  calculation_normalization: { authority: 'autonomous', label: 'Hesaplama ve normalizasyon' },
  comparison: { authority: 'autonomous', label: 'Karşılaştırma' },
  diff_report: { authority: 'autonomous', label: 'Fark raporu' },
  internal_alarm_task: { authority: 'autonomous', label: 'Alarm ve iç görev oluşturma' },
  internal_reminder: { authority: 'autonomous', label: 'Ekibe iç hatırlatma' },
  draft_generation: { authority: 'autonomous', label: 'Taslak üretimi' },
  shortlist_suggestion: { authority: 'autonomous', label: 'Kısa liste önerisi' },
  /** Tek dış istisna: onaylanmış RFQ için önceden onaylı şablonla tedarikçiye yanıt hatırlatması */
  supplier_rfq_reminder: { authority: 'autonomous', label: 'Onaylı RFQ için tedarikçi hatırlatması (onaylı şablon)' },

  // ---- Öneri (insan onaylar) ----
  customer_missing_info_question: { authority: 'suggest', label: 'Müşteriye eksik bilgi sorusu' },
  rfq_send: { authority: 'suggest', label: 'RFQ gönderimi' },
  negotiation_message: { authority: 'suggest', label: 'Pazarlık mesajı' },
  team_assignment: { authority: 'suggest', label: 'Ekip ataması' },
  margin_suggestion: { authority: 'suggest', label: 'Marj önerisi' },
  customer_quote: { authority: 'suggest', label: 'Müşteri teklifi' },
  option_extension_request: { authority: 'suggest', label: 'Opsiyon uzatma talebi' },
  revision_request: { authority: 'suggest', label: 'Revizyon talebi' },
  checklist_new_question: { authority: 'suggest', label: 'Kontrol listesine yeni soru' },
  low_confidence_payment_match: { authority: 'suggest', label: 'Düşük güvenli fatura–ödeme eşleşmesi' },

  // ---- Yasak ----
  money_movement: { authority: 'forbidden', label: 'Para hareketi veya ödeme talimatı' },
  supplier_confirmation: { authority: 'forbidden', label: 'Tedarikçiye konfirmasyon' },
  contract_signature: { authority: 'forbidden', label: 'Sözleşme imzası' },
  supplier_accreditation: { authority: 'forbidden', label: 'Tedarikçi akreditasyonu' },
  rule_change: { authority: 'forbidden', label: 'Kural / eşik / yetki değişikliği' },
  record_deletion: { authority: 'forbidden', label: 'Kayıt silme' },
  external_message_unapproved: { authority: 'forbidden', label: 'İnsan onayı olmadan dışarıya mesaj' },
  /** v0.5 S-03 / K-01: release, opsiyon bırakma / uzatma kararı ve base para birimi değişikliği asla otomatik değil */
  allotment_release: { authority: 'forbidden', label: 'Allotment release / opsiyon bırakma (tedarikçiye bildirim)' },
  base_currency_change: { authority: 'forbidden', label: 'Ana para birimi değişikliği' },
} as const satisfies Record<string, { authority: AiAuthority; label: string }>;

export type AiActionType = keyof typeof AI_ACTIONS;

export function aiAuthorityOf(action: string): AiAuthority {
  // Unknown actions are forbidden by definition (closed list).
  return (AI_ACTIONS as Record<string, { authority: AiAuthority }>)[action]?.authority ?? 'forbidden';
}

/** Only 'suggest' actions are eligible for §16 automation promotion. */
export function isPromotable(action: string): boolean {
  return aiAuthorityOf(action) === 'suggest';
}

/** Default confidence threshold below which AI output must be human-verified (§6). Overridable per tenant via rules. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;
