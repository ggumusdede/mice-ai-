// Shared enumerations — single source of truth for every layer (DB check constraints mirror these).
// PRD references: MICE AI Operations OS v0.4.

/** §4 Acenta içi roller */
export const ROLES = ['admin', 'clerk_sales', 'clerk_ops', 'field', 'finance', 'signatory'] as const;
export type Role = (typeof ROLES)[number];

/** §4 Kişi bazlı yetki seviyesi: "her teklif onaya" → "belirli müşteri/etkinlik tipinde serbest" → "tam yetki" */
export const AUTHORITY_LEVELS = ['all_need_approval', 'scoped', 'full'] as const;
export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number];

/** §5 Kalem türleri */
export const SERVICE_KINDS = ['accommodation', 'hall', 'fnb', 'transfer', 'technical', 'activity', 'ticket', 'other'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/** §7 İş akışı adımları 0..8 */
export const WORKFLOW_STEPS = [
  { step: 0, key: 'intake', label: 'Talep analizi' },
  { step: 1, key: 'rfq', label: 'Tedarikçi seçimi ve RFQ' },
  { step: 2, key: 'compare', label: 'Karşılaştırma ve pazarlık' },
  { step: 3, key: 'quote', label: 'Müşteri teklifi' },
  { step: 4, key: 'customer_approval', label: 'Müşteri onayı' },
  { step: 5, key: 'contract', label: 'Konfirmasyon ve sözleşme' },
  { step: 6, key: 'operations', label: 'Operasyon takibi' },
  { step: 7, key: 'finance', label: 'Fatura, ödeme ve tahsilat' },
  { step: 8, key: 'closing', label: 'Kapanış ve öğrenme' },
] as const;
export type WorkflowStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const PROJECT_OUTCOMES = ['open', 'won', 'lost', 'cancelled', 'closed'] as const;
export type ProjectOutcome = (typeof PROJECT_OUTCOMES)[number];

export const SUPPLIER_STATUSES = ['candidate', 'accredited', 'passive'] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

export const INBOUND_CHANNELS = ['email', 'whatsapp', 'phone_note', 'voice', 'manual'] as const;
export type InboundChannel = (typeof INBOUND_CHANNELS)[number];

export const OFFER_SOURCES = ['form', 'email', 'pdf', 'excel', 'image', 'manual'] as const;
export type OfferSource = (typeof OFFER_SOURCES)[number];

/** §9 Fiyat değerlendirme rozetleri */
export const PRICE_CLASSES = ['good', 'normal', 'unknown'] as const;
export type PriceClass = (typeof PRICE_CLASSES)[number];

export const DOCUMENT_KINDS = ['quote', 'contract', 'program', 'pnl', 'rooming_list', 'customer_invoice_draft', 'supplier_confirmation'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** §3.5 Değişiklik yayılımı — belge durumu: güncel / eski / bekliyor */
export const DOCUMENT_STATUSES = ['current', 'stale', 'pending'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const QUOTE_STATUSES = ['draft', 'blocked', 'pending_approval', 'approved', 'sent', 'accepted', 'revision_requested', 'rejected', 'superseded'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const CONTRACT_STATUSES = ['draft', 'diff_pending', 'clean', 'pending_approval', 'approved', 'signed', 'amended'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const RFQ_STATUSES = ['draft', 'pending_approval', 'sent', 'responded', 'closed', 'cancelled'] as const;
export type RfqStatus = (typeof RFQ_STATUSES)[number];

/** §15 Karar kutusu kart türleri */
export const DECISION_KINDS = [
  'quote_approval',
  'margin_override',
  'contract_diff',
  'contract_approval',
  'condition_risk',
  'payment_approval',
  'supplier_accreditation',
  'automation_promotion',
  'automation_demotion',
  'audit_sample',
  'rule_suggestion',
  'checklist_question',
  'assignment',
  'rfq_send',
  'negotiation_message',
  'outbound_message',
  'field_extra',
  'low_confidence_review',
  'unbilled_payment_escalation',
  'low_supplier_score',
  'closing_overdue',
  // v0.5-A para ve tedarik (S-19, S-03)
  'base_currency_change',
  'allotment_release',
  'supplier_option_expiry',
] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

/** §15 rozet: kural içinde / kritik / öneri */
export const DECISION_BADGES = ['within_rules', 'critical', 'suggestion'] as const;
export type DecisionBadge = (typeof DECISION_BADGES)[number];

export const DECISION_STATUSES = ['open', 'approved', 'edited', 'rejected', 'expired'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** §15 Eylem dili: tek birincil eylem + Düzelt + Reddet */
export const DECISION_ACTIONS = ['approve', 'edit', 'reject'] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export const FINANCE_KINDS = [
  'payable', // tedarikçiye borç (taahhüt anında)
  'receivable', // müşteriden alacak (taahhüt anında)
  'supplier_invoice',
  'customer_invoice',
  'payment_out',
  'payment_in',
  'commission',
] as const;
export type FinanceKind = (typeof FINANCE_KINDS)[number];

export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ACTOR_TYPES = ['user', 'ai', 'supplier', 'customer', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const LANGUAGES = ['tr', 'en', 'ru'] as const;
export type Language = (typeof LANGUAGES)[number];

export const CURRENCIES = ['EUR', 'TRY', 'USD', 'GBP'] as const;
export type Currency = (typeof CURRENCIES)[number];
/** §7 Adım 2: İç hesap EUR — v0.5 S-19: artık acentanın varsayılanı; her proje kendi `baseCurrency`'siyle hesaplanır. */
export const INTERNAL_CURRENCY: Currency = 'EUR';
/** v0.5 S-19 (ana çatı 7): acentanın seçebileceği ana para birimleri. */
export const BASE_CURRENCIES = ['EUR', 'TRY', 'USD'] as const;
export type BaseCurrency = (typeof BASE_CURRENCIES)[number];
