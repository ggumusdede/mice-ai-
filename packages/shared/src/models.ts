// Entity shapes as exchanged over the API (camelCase JSON). The DB uses snake_case; the API layer maps.
// All monetary "Eur" fields are in the internal currency (EUR). Dates: ISO strings.
import type {
  AuthorityLevel, ContractStatus, Currency, DecisionAction, DecisionBadge, DecisionKind, DecisionStatus,
  DocumentKind, DocumentStatus, FinanceKind, InboundChannel, Language, OfferSource, PriceClass, ProjectOutcome,
  QuoteStatus, RfqStatus, Role, ServiceKind, SupplierStatus, TaskStatus, WorkflowStep, ActorType,
} from './enums.js';
import type { AiActionType } from './ai-authority.js';

export type ID = string; // uuid
export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string;

/** Value + AI confidence (0..1). Every AI-extracted field carries a confidence (§6, §7 Adım 0). */
export interface Extracted<T> {
  value: T | null;
  confidence: number;
  /** true when confidence < threshold → needs human verification */
  needsReview?: boolean;
  source?: string;
}

export interface User {
  id: ID;
  tenantId: ID;
  email: string;
  fullName: string;
  role: Role;
  authorityLevel: AuthorityLevel;
  /** for 'scoped': customers / event types the user may send quotes for without approval */
  authorityScope: { customerIds?: ID[]; eventTypes?: string[] };
  canSign: boolean;
  languages: Language[];
  active: boolean;
}

export interface Delegation {
  id: ID;
  tenantId: ID;
  adminId: ID;
  delegateId: ID;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
}

export interface Supplier {
  id: ID;
  tenantId: ID;
  name: string;
  kinds: ServiceKind[];
  city: string;
  district: string | null;
  lat: number | null;
  lng: number | null;
  capacityPax: number | null;
  roomCount: number | null;
  halls: { name: string; capacityTheatre?: number; capacityClassroom?: number; capacityBanquet?: number }[];
  status: SupplierStatus;
  segment: string | null; // 4*, 5*, boutique
  email: string | null;
  phone: string | null;
  contactName: string | null;
  commission: { rate?: number; vatIncluded?: boolean; billedSeparately?: boolean } | null;
  paymentTerms: string | null;
  /** 0..100 */
  performanceScore: number | null;
  avgResponseHours: number | null;
  accreditedBy: ID | null;
  accreditedAt: ISODateTime | null;
  /** VKN / TCKN — e-Fatura (UBL-TR) supplier matching (additive) */
  taxNumber?: string | null;
}

export interface CustomerRules {
  /** §17.2 Kesin onay tanımı. Default for new customers: 'signed_or_po' */
  firmApproval: 'online' | 'signed_or_po';
  /** Kapora oranı (0 = yok) */
  depositRate: number;
  /** e.g. "no payment/cancellation clause in quotes" */
  omitPaymentCancellationClauses: boolean;
  specialClauses: string[];
  preferredLanguage: Language;
  preferredCurrency: Currency;
}

export interface Customer {
  id: ID;
  tenantId: ID;
  name: string;
  shortCode: string; // used in project code
  taxOffice: string | null;
  taxNumber: string | null;
  billingAddress: string | null;
  contacts: { name: string; email?: string; phone?: string; title?: string }[];
  rules: CustomerRules;
}

export interface RequestExtraction {
  customerName: Extracted<string>;
  eventType: Extracted<string>;
  startDate: Extracted<ISODate>;
  endDate: Extracted<ISODate>;
  dateFlexibility: Extracted<string>;
  pax: Extracted<number>;
  roomsSgl: Extracted<number>;
  roomsDbl: Extracted<number>;
  city: Extracted<string>;
  district: Extracted<string>;
  hallLayout: Extracted<string>;
  fnb: Extracted<string>;
  technical: Extracted<string>;
  transfer: Extracted<string>;
  budget: Extracted<number>;
  budgetCurrency: Extracted<Currency>;
  decisionDate: Extracted<ISODate>;
  billingInfo: Extracted<string>;
  language: Language;
}

export interface Project {
  id: ID;
  tenantId: ID;
  code: string; // PRJ-####-MÜŞTERİ-TARİH-KİŞİ-TESİS
  seq: number;
  customerId: ID | null;
  customerName: string | null;
  title: string;
  eventType: string | null;
  startDate: ISODate | null;
  endDate: ISODate | null;
  dateFlexibility: string | null;
  pax: number | null;
  roomsSgl: number | null;
  roomsDbl: number | null;
  city: string | null;
  district: string | null;
  hallLayout: string | null;
  fnbNeeds: string | null;
  technicalNeeds: string | null;
  transferNeeds: string | null;
  budget: number | null;
  budgetCurrency: Currency | null;
  budgetSegment: string | null; // when no budget: 4*, 5*, butik
  decisionDate: ISODate | null;
  billingInfo: string | null;
  extraction: RequestExtraction | null;
  step: WorkflowStep;
  outcome: ProjectOutcome;
  lostReason: string | null;
  ownerId: ID | null;
  venueName: string | null;
  receivedAt: ISODateTime;
  quoteSentAt: ISODateTime | null;
  /** §17.10 */
  targetBusinessDays: number;
  targetOverrideReason: string | null;
  customerWaitMinutes: number;
  eventEndedAt: ISODateTime | null;
  closedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface InboundMessage {
  id: ID;
  tenantId: ID;
  projectId: ID | null;
  channel: InboundChannel;
  fromAddress: string | null;
  subject: string | null;
  body: string;
  receivedAt: ISODateTime;
}

export interface ServiceItem {
  id: ID;
  tenantId: ID;
  projectId: ID;
  kind: ServiceKind;
  description: string;
  dateFrom: ISODate | null;
  dateTo: ISODate | null;
  quantity: number; // pax, rooms, vehicles...
  unit: string; // 'room_night', 'pax_day', 'vehicle', 'lump_sum', ...
  nights: number | null;
  specs: Record<string, unknown>; // room type, board, layout, menu...
  selectedOfferId: ID | null;
  /** §17.4 Yalnız satış kalemi (acenta katma değer kalemi): alış 0, satış acenta belirler */
  valueAdd: boolean;
  status: 'open' | 'rfq' | 'offered' | 'selected' | 'confirmed' | 'cancelled';
}

export interface Rfq {
  id: ID;
  tenantId: ID;
  projectId: ID;
  serviceItemId: ID;
  supplierId: ID;
  status: RfqStatus;
  sentBy: ID | null;
  sentAt: ISODateTime | null;
  deadlineAt: ISODateTime | null;
  linkExpiresAt: ISODateTime | null;
  reminderSentAt: ISODateTime | null;
  callTaskCreatedAt: ISODateTime | null;
  overrideReason: string | null;
  /** only returned once on creation (plain token never stored) */
  supplierLink?: string;
}

export interface OfferLine {
  description: string;
  kind: ServiceKind;
  quantity: number;
  unit: string;
  nights?: number;
  unitPrice: number; // in offer currency, as quoted
  vatIncluded: boolean;
  vatRate: number;
  accommodationTaxIncluded?: boolean;
  roomType?: string;
  board?: string; // BB, HB, FB
}

export interface HiddenCost {
  type: 'guarantee' | 'attrition' | 'payment' | 'cancellation' | 'overtime' | 'other';
  description: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface SupplierOffer {
  id: ID;
  tenantId: ID;
  rfqId: ID | null;
  serviceItemId: ID;
  supplierId: ID;
  version: number;
  source: OfferSource;
  currency: Currency;
  lines: OfferLine[];
  optionUntil: ISODate | null;
  guaranteePax: number | null;
  attritionTerms: string | null;
  paymentTerms: string | null;
  /** e.g. supplier pre-payment percentage required */
  prepaymentRate: number | null;
  cancellationTerms: string | null;
  overtimeTerms: string | null;
  notes: string | null;
  /** AI reading confidence; null for structured form input */
  confidence: number | null;
  verifiedBy: ID | null;
  supersededBy: ID | null;
  negotiationRound: number;
  createdAt: ISODateTime;
}

/** Output of domain normalization (§7 Adım 2) */
export interface NormalizedOffer {
  offerId: ID;
  supplierId: ID;
  totalNetExVatEur: number;
  accommodationTaxEur: number;
  vatEur: number;
  perPersonEur: number | null;
  perPersonPerDayEur: number | null;
  perRoomNightEur: number | null;
  fxRate: number;
  hiddenCosts: HiddenCost[];
}

export interface OfferEvaluation {
  offerId: ID;
  normalized: NormalizedOffer;
  priceClass: PriceClass;
  /** accommodation: (channel - net)/channel ; others: (median - price)/median */
  advantage: number | null;
  benchmark: { type: 'channel' | 'history_median' | 'none'; value: number | null; sampleSize?: number };
  suggestedMarkup: number | null;
  risks: string[];
  candidateSupplier: boolean;
}

export interface QuoteLine {
  id?: ID;
  optionNo: number; // 1..3
  serviceItemId: ID;
  offerId: ID | null;
  description: string;
  kind: ServiceKind;
  quantity: number;
  unit: string;
  nights: number | null;
  unitCostEur: number;
  unitPriceEur: number;
  markup: number; // fraction
  vatRate: number;
  valueAdd: boolean;
  supplierOptionUntil: ISODate | null;
}

export interface ProfitSummary {
  costEur: number;
  saleEur: number;
  profitEur: number;
  /** Kâr ÷ Satış */
  margin: number;
  /** Kâr ÷ Alış */
  markup: number;
}

export interface QuoteOption {
  optionNo: number;
  title: string;
  lines: QuoteLine[];
  totals: ProfitSummary;
  vatEur: number;
  accommodationTaxEur: number;
  grandTotalCustomerCurrency: number;
}

export interface Quote {
  id: ID;
  tenantId: ID;
  projectId: ID;
  version: number;
  status: QuoteStatus;
  currency: Currency;
  fxRate: number; // 1 EUR = fxRate currency
  fxSource: string;
  fxDate: ISODate;
  optionUntil: ISODate | null;
  options: QuoteOption[];
  appliedCustomerRules: string[];
  blockReasons: string[];
  requiresApproval: boolean;
  createdBy: ID | null;
  approvedBy: ID | null;
  sentAt: ISODateTime | null;
  openedAt: ISODateTime | null;
  acceptedOptionNo: number | null;
  acceptedAt: ISODateTime | null;
  marginOverrideReason: string | null;
  approvalLink?: string;
  createdAt: ISODateTime;
}

/** Fields compared field-by-field in §7 Adım 5 */
export interface ContractFields {
  supplierName: string | null;
  customerName: string | null;
  billingInfo: string | null;
  startDate: ISODate | null;
  endDate: ISODate | null;
  pax: number | null;
  guaranteePax: number | null;
  rooms: { type: string; count: number; nights: number; unitPrice: number }[];
  menu: string | null;
  hall: string | null;
  unitPrices: { description: string; unitPrice: number; quantity: number }[];
  vatSeparated: boolean | null;
  accommodationTaxSeparated: boolean | null;
  currency: Currency | null;
  totalAmount: number | null;
  paymentTerms: string | null;
  prepaymentRate: number | null;
  cancellationTerms: string | null;
  attritionTerms: string | null;
  optionDate: ISODate | null;
}

export interface ContractDiffItem {
  field: string;
  label: string;
  contractValue: unknown;
  quoteValue: unknown;
  severity: 'error' | 'warning' | 'info';
  /** §17.4: value-add items are flagged, not counted as errors */
  kind: 'mismatch' | 'missing_in_contract' | 'missing_in_quote' | 'empty_field' | 'value_add' | 'date_inconsistency';
  message: string;
}

export interface Contract {
  id: ID;
  tenantId: ID;
  projectId: ID;
  supplierId: ID;
  serviceItemIds: ID[];
  version: number;
  template: 'agency' | 'supplier';
  status: ContractStatus;
  fields: ContractFields;
  extractionConfidence: number | null;
  diff: ContractDiffItem[];
  conditionRiskEur: number | null;
  conditionRiskNote: string | null;
  locked: boolean;
  signedAt: ISODateTime | null;
  signedBy: ID | null;
  amendmentOf: ID | null;
  createdAt: ISODateTime;
}

export interface GeneratedDocument {
  id: ID;
  tenantId: ID;
  projectId: ID;
  kind: DocumentKind;
  version: number;
  status: DocumentStatus;
  staleReason: string | null;
  generatedAt: ISODateTime;
  /** structured content the document renders from */
  content: Record<string, unknown>;
  downloadUrl?: string;
}

export interface Task {
  id: ID;
  tenantId: ID;
  projectId: ID | null;
  assigneeId: ID | null;
  kind: string; // 'call_supplier', 'final_pax', 'rooming_list', 'menu_approval', 'tech_brief', 'transfer_list', 'payment_due', ...
  title: string;
  dueAt: ISODateTime | null;
  status: TaskStatus;
  source: 'ai' | 'rule' | 'user';
}

export interface Decision {
  id: ID;
  tenantId: ID;
  projectId: ID | null;
  projectCode: string | null;
  kind: DecisionKind;
  badge: DecisionBadge;
  /** tek satır özet */
  summary: string;
  /** alt panel detay */
  detail: Record<string, unknown>;
  /** yapay zekâ notu */
  aiNote: string | null;
  /** e.g. "Face ID ile onayla", "Revizyon talebini gönder", "Akredite et" */
  primaryActionLabel: string;
  /** minimum role required to decide; admin always can; delegate per §17.1 */
  requiredRole: Role;
  requiresBiometric: boolean;
  urgent: boolean;
  entityType: string | null;
  entityId: ID | null;
  /** editable draft (message body, price, etc.) for the "Düzelt" action */
  draft: Record<string, unknown> | null;
  status: DecisionStatus;
  decidedBy: ID | null;
  decidedAt: ISODateTime | null;
  decidedDevice: string | null;
  viaDelegation: boolean;
  createdAt: ISODateTime;
}

export interface DecisionInput {
  action: DecisionAction;
  /** edited draft for 'edit' (Düzelt). Edits are learning data (§16.4). */
  edits?: Record<string, unknown>;
  reason?: string;
  device?: string;
  /** WebAuthn assertion (Face ID) — required when decision.requiresBiometric */
  biometric?: { method: 'webauthn'; assertion: unknown } | { method: 'dev' };
}

export interface FinanceEntry {
  id: ID;
  tenantId: ID;
  projectId: ID | null;
  serviceItemId: ID | null;
  supplierId: ID | null;
  kind: FinanceKind;
  amount: number;
  currency: Currency;
  amountEur: number;
  dueDate: ISODate | null;
  status: 'open' | 'pending_approval' | 'approved' | 'paid' | 'matched' | 'cancelled';
  reference: string | null;
  invoiceNo: string | null;
  meta: Record<string, unknown>;
  createdAt: ISODateTime;
}

export interface BankTransaction {
  id: ID;
  tenantId: ID;
  bookedAt: ISODate;
  amount: number; // negative = outgoing
  currency: Currency;
  description: string;
  counterparty: string | null;
  matchedEntryId: ID | null;
  matchConfidence: number | null;
  status: 'unmatched' | 'suggested' | 'matched' | 'ignored';
  payerUserId: ID | null;
}

export interface FieldExtra {
  id: ID;
  projectId: ID;
  description: string;
  amountTry: number;
  enteredBy: ID;
  needsAdminApproval: boolean;
  customerApprovedAt: ISODateTime | null;
  customerApproverName: string | null;
  reflectedToCustomer: boolean | null;
  notReflectedReason: string | null;
  createdAt: ISODateTime;
}

export interface Guest {
  id: ID;
  projectId: ID;
  fullName: string; // decrypted only for authorized roles
  email: string | null;
  phone: string | null;
  roomType: string | null;
  arrival: ISODate | null;
  departure: ISODate | null;
  consentReuse: boolean;
  consentAt: ISODateTime | null;
  consentWithdrawnAt: ISODateTime | null;
  anonymizedAt: ISODateTime | null;
  retentionUntil: ISODate | null;
}

export interface ChecklistQuestion {
  id: ID;
  tenantId: ID;
  eventType: string | null; // null = all event types
  question: string;
  field: string | null;
  status: 'active' | 'suggested' | 'rejected';
  source: 'seed' | 'ai' | 'closing' | 'user';
}

export interface AutomationCounter {
  actionType: AiActionType;
  mode: 'approval' | 'auto';
  consecutiveClean: number;
  threshold: number;
  sampleRate: number;
  promotedAt: ISODateTime | null;
  demotedAt: ISODateTime | null;
  totalAuto: number;
  totalSampled: number;
  sampleErrors: number;
}

export interface AuditEntry {
  id: string;
  tenantId: ID;
  actorType: ActorType;
  actorId: string | null;
  entity: string;
  entityId: string | null;
  action: string;
  before: unknown;
  after: unknown;
  device: string | null;
  at: ISODateTime;
}

export interface MessageDraft {
  id: ID;
  tenantId: ID;
  projectId: ID | null;
  kind: 'missing_info' | 'rfq' | 'rfq_reminder' | 'negotiation' | 'quote_cover' | 'quote_followup' | 'option_extension' | 'revision_request' | 'supplier_confirmation' | 'daily_summary' | 'other';
  channel: 'email' | 'whatsapp' | 'sms';
  to: string | null;
  subject: string | null;
  body: string;
  language: Language;
  status: 'draft' | 'pending_approval' | 'approved' | 'sent' | 'discarded';
  fromUserId: ID | null;
  aiGenerated: boolean;
  createdAt: ISODateTime;
}

/** "Gelen kutusu": an inbound e-mail / WhatsApp message linked to a project (GET /api/projects/:id/inbound-messages, additive). */
export interface InboundMessageSummary {
  id: ID;
  channel: string;
  /** webhook | postmark | mailgun | mime | imap | whatsapp | manual */
  source: string;
  fromAddress: string | null;
  senderName: string | null;
  subject: string | null;
  preview: string;
  receivedAt: ISODateTime | null;
  /** new_request | supplier_reply | supplier_message | customer_reply | customer_revision | customer_acceptance | project_reply | extra_approval | auto_reply | unlinked | rejected */
  kind: string | null;
  linkMethod: string | null;
  status: string;
  note: string | null;
  supplierId: ID | null;
  supplierName: string | null;
  rfqId: ID | null;
  offerId: ID | null;
  offerVersion: number | null;
  serviceItemId: ID | null;
  taskId: ID | null;
  intakeProjectId: ID | null;
  fieldExtraId: ID | null;
  attachments: { filename: string; size: number; accepted: boolean; reason?: string; usedFor?: string }[];
}
