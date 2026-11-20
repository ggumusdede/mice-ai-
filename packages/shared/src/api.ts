// HTTP API contract shared by apps/api (server) and apps/web (client).
// Base path: /api. Auth: Bearer JWT (staff). Public token routes under /api/public/* need no login.
// Errors: { error: { code: string; message: string; details?: unknown } } with proper HTTP status.
// Every list endpoint returns { items: T[] }.
import type {
  AuditEntry, AutomationCounter, BankTransaction, ChecklistQuestion, Contract, ContractDiffItem, Customer, Decision,
  DecisionInput, Delegation, FieldExtra, FinanceEntry, GeneratedDocument, Guest, ID, InboundMessage, MessageDraft,
  OfferEvaluation, Project, ProfitSummary, Quote, Rfq, ServiceItem, Supplier, SupplierOffer, Task, User,
} from './models.js';
import type { TenantRules } from './rules.js';
import type { InboundChannel, Language, ServiceKind } from './enums.js';

export interface ApiError { error: { code: string; message: string; details?: unknown } }
export interface List<T> { items: T[] }

// ---------- Auth ----------
// POST /api/auth/login            body LoginRequest -> LoginResponse
// GET  /api/auth/me               -> MeResponse
// POST /api/auth/webauthn/register/options, /register/verify, /authenticate/options  (Face ID step-up, §15)
export interface LoginRequest { email: string; password: string }
export interface LoginResponse { token: string; user: User }
export interface MeResponse { user: User; tenant: { id: ID; name: string }; activeDelegationsForMe: Delegation[] }

// ---------- Decision inbox (§15 karar kutusu) ----------
// GET  /api/decisions?status=open            -> List<Decision>   (only decisions the current user may decide)
// GET  /api/decisions/:id                    -> Decision
// POST /api/decisions/:id/decide  body DecisionInput -> DecideResponse
export interface DecideResponse { decision: Decision; effects: string[] }

// ---------- Intake (Adım 0) ----------
// POST /api/intake   body IntakeRequest -> IntakeResponse
// Creates the project automatically (every request gets a code, §7 Adım 0), runs AI extraction,
// duplicate check, missing-info list + question draft, supplier pre-match, assignment suggestion.
export interface IntakeRequest {
  channel: InboundChannel;
  body: string;
  fromAddress?: string;
  subject?: string;
  customerId?: ID;
  receivedAt?: string;
}
export interface IntakeResponse {
  project: Project;
  duplicates: { projectId: ID; code: string; reason: string }[];
  missingFields: string[];
  missingQuestions: string[];
  questionDraft: MessageDraft | null;
  preMatchedSuppliers: SupplierRanking[];
  assignmentSuggestion: { userId: ID; fullName: string; reason: string } | null;
  rfqReady: boolean; // RFQ minimum info complete (date, pax, city/district, room split, layout, budget|segment)
}

// ---------- Projects ----------
// GET   /api/projects?q=&outcome=&step=         -> List<Project>
// GET   /api/projects/:id                       -> ProjectDetail
// PATCH /api/projects/:id   body Partial<Project> (+ reason?) -> Project   (propagates staleness, §3.5)
// POST  /api/projects/:id/assign   body {userId}            -> Project
// POST  /api/projects/:id/outcome  body {outcome:'won'|'lost', lostReason?} -> Project (lost requires reason, §7 Adım 4)
// POST  /api/projects/:id/ask      body {question}          -> AskResponse ("Bu projeye sor", §15)
// GET   /api/projects/:id/timeline                          -> List<AuditEntry>
// GET   /api/projects/:id/similar                           -> List<SimilarProject>  (know-how ekranı, §4)
export interface ProjectDetail {
  project: Project;
  customer: Customer | null;
  items: ServiceItemDetail[];
  quotes: Quote[];
  contracts: Contract[];
  documents: GeneratedDocument[];
  tasks: Task[];
  alerts: ProjectAlert[];
  profit: { expected: ProfitSummary | null; realized: ProfitSummary | null };
  recentActivity: AuditEntry[];
  stepTimer: { businessMinutesElapsed: number; targetBusinessMinutes: number; customerWaitMinutes: number };
}
export interface ServiceItemDetail extends ServiceItem {
  offers: SupplierOffer[];
  evaluations: OfferEvaluation[];
  rfqs: Rfq[];
  selectedSupplierName: string | null;
  costEur: number | null;
  saleEur: number | null;
  priceClass: 'good' | 'normal' | 'unknown' | null;
}
export interface ProjectAlert { level: 'info' | 'warning' | 'critical'; code: string; message: string; entityId?: ID }
export interface AskResponse { answer: string; sources: { type: string; id: ID; label: string }[]; confidence: number }
export interface SimilarProject { projectId: ID; code: string; customerName: string | null; eventType: string | null; pax: number | null; outcome: string; totalSaleEur: number | null; margin: number | null; lostReason: string | null }

// ---------- Service items (§5) ----------
// POST  /api/projects/:id/items   body ServiceItemInput -> ServiceItem
// PATCH /api/items/:id            body Partial<ServiceItemInput> -> ServiceItem
// POST  /api/items/:id/select-offer body {offerId} -> ServiceItem
export interface ServiceItemInput {
  kind: ServiceKind; description: string; dateFrom?: string; dateTo?: string; quantity: number; unit: string;
  nights?: number; specs?: Record<string, unknown>; valueAdd?: boolean;
}

// ---------- Suppliers & RFQ (Adım 1) ----------
// GET  /api/suppliers?kind=&city=&status=   -> List<Supplier>
// POST /api/suppliers  body Partial<Supplier>  -> Supplier (always created as 'candidate')
// PATCH /api/suppliers/:id                     -> Supplier (status change to 'accredited' => creates accreditation decision; only admin decides)
// GET  /api/items/:id/shortlist               -> List<SupplierRanking>
// POST /api/items/:id/rfqs  body CreateRfqsRequest -> List<Rfq>  (creates drafts + 'rfq_send' decision unless automated)
// POST /api/rfqs/:id/cancel body {reason}       -> Rfq
export interface SupplierRanking { supplier: Supplier; score: number; reasons: string[]; sameDistrict: boolean; candidate: boolean }
export interface CreateRfqsRequest { supplierIds: ID[]; deadlineHours?: number; overrideReason?: string; language?: Language }

// ---------- Offers & comparison (Adım 2) ----------
// POST /api/items/:id/offers           body ManualOfferInput -> SupplierOffer       (ekip manuel girer)
// POST /api/items/:id/offers/parse     multipart file | body {text, supplierId} -> SupplierOffer (AI okuma, confidence)
// POST /api/offers/:id/verify          body Partial<SupplierOffer> -> SupplierOffer  (low-confidence human verification; correction = learning)
// GET  /api/items/:id/comparison                         -> ComparisonResponse
// POST /api/offers/:id/negotiate       body {arguments: NegotiationArgument[]} -> MessageDraft (+ decision)
// POST /api/channel-prices             body ChannelPriceInput -> {id}  (manual entry assist; §18.5)
export type ManualOfferInput = Omit<SupplierOffer, 'id' | 'tenantId' | 'version' | 'createdAt' | 'supersededBy' | 'verifiedBy' | 'confidence' | 'serviceItemId' | 'negotiationRound'>;
export type NegotiationArgument = 'volume' | 'relationship' | 'flexible_dates' | 'payment_ease'; // §7 Adım 2: rakip fiyatı yasak
export interface ComparisonResponse { item: ServiceItem; evaluations: OfferEvaluation[]; offers: SupplierOffer[]; suppliers: Supplier[] }
export interface ChannelPriceInput { supplierId: ID; date: string; roomType: string; board: string; cancellation: 'flexible' | 'non_refundable'; price: number; currency: string; source: string }

// ---------- Customer quote (Adım 3) & approval (Adım 4) ----------
// POST /api/projects/:id/quotes       body BuildQuoteRequest -> Quote  (validated; blocked/pending_approval/approved)
// GET  /api/quotes/:id                                       -> Quote
// POST /api/quotes/:id/send                                  -> Quote (requires approved; generates PDF + approval link)
// GET  /api/quotes/:id/pdf                                   -> application/pdf
// GET  /api/public/quotes/:token                             -> PublicQuoteView (marks opened_at)
// POST /api/public/quotes/:token/accept  body {optionNo, approverName, poNumber?} -> {ok:true}
// POST /api/public/quotes/:token/revision body {message}      -> {ok:true}
export interface BuildQuoteRequest {
  currency?: string;
  options: { title: string; lines: { serviceItemId: ID; offerId?: ID | null; markup?: number; unitPriceEur?: number }[] }[];
  marginOverrideReason?: string;
}
export interface PublicQuoteView { agencyName: string; projectCode: string; customerName: string | null; currency: string; optionUntil: string | null; options: { optionNo: number; title: string; lines: { description: string; quantity: number; unit: string; unitPrice: number; total: number }[]; total: number; vat: number; accommodationTax: number; grandTotal: number }[]; status: string; firmApproval: 'online' | 'signed_or_po' }

// ---------- Contracts (Adım 5) ----------
// POST /api/projects/:id/contracts        body {supplierId, serviceItemIds, template} -> Contract (draft from agency template)
// POST /api/contracts/:id/parse           multipart file | body {text} -> Contract  (AI reads supplier contract)
// POST /api/contracts/:id/compare                          -> Contract (diff vs accepted quote)
// POST /api/contracts/:id/sign            body {signedBy, scanFileName?} -> Contract (locks; creates payable/receivable)
// POST /api/contracts/:id/amend           body {changes, reason} -> Contract (ek protokol; triggers change flow)

// ---------- Operations (Adım 6) ----------
// GET  /api/tasks?mine=1&status=open        -> List<Task>
// POST /api/tasks/:id/complete              -> Task
// GET  /api/projects/:id/guests             -> List<Guest>   (role-gated, decrypted)
// POST /api/projects/:id/guests             body Guest[]    -> List<Guest>
// POST /api/projects/:id/rooming-link       -> {url}         (public rooming form with KVKK consent checkbox)
// GET  /api/public/rooming/:token  / POST /api/public/rooming/:token  body {guests:[...]}
// POST /api/public/consent/:token/withdraw   -> {ok}
// POST /api/projects/:id/field-extras       body {description, amountTry, customerPhone?} -> FieldExtra (+ customer approval link)
// POST /api/public/extras/:token/approve    body {approverName} -> {ok}
// POST /api/field-extras/:id/reflect        body {reflected:boolean, reason?} -> FieldExtra
// GET  /api/projects/:id/daily-summary      -> {lines: string[]} (3-line summary)

// ---------- Finance (Adım 7) ----------
// GET  /api/finance/entries?projectId=&kind=&status=  -> List<FinanceEntry>
// POST /api/finance/supplier-invoices  multipart | body SupplierInvoiceInput -> {entry: FinanceEntry; alarms: string[]}
// POST /api/finance/payment-requests   body {entryId}  -> FinanceEntry (finance creates; admin approves via decision)
// POST /api/finance/bank-statements    multipart CSV/XLSX -> {imported:number; matched:number; suggested:number; unmatched:number}
// GET  /api/finance/bank-transactions?status=        -> List<BankTransaction>
// POST /api/finance/bank-transactions/:id/match  body {entryId} -> BankTransaction
// POST /api/projects/:id/customer-invoice-draft      -> GeneratedDocument
// GET  /api/finance/export/mikro?from=&to=           -> xlsx (Mikro Yazılım import)
// GET  /api/finance/commissions?projectId=           -> List<FinanceEntry>
export interface SupplierInvoiceInput { projectId: ID; supplierId: ID; invoiceNo: string; amount: number; currency: string; vatAmount?: number; issueDate: string; dueDate?: string; serviceItemIds?: ID[] }

// ---------- Closing (Adım 8) ----------
// GET  /api/projects/:id/closing-check         -> ClosingCheck
// POST /api/projects/:id/close   body {lessonsLearned?: string} -> Project
// GET/POST /api/public/survey/:token           3-question survey
export interface ClosingCheck { ok: boolean; items: { key: string; label: string; ok: boolean; detail?: string }[]; planVsActual: { planned: ProfitSummary | null; actual: ProfitSummary | null; deviations: { reason: string; amountEur: number }[] } }

// ---------- Admin: rules, users, delegations, checklist, automation ----------
// GET   /api/rules  -> TenantRules ; PATCH /api/rules body Partial<TenantRules> (admin only; AI can never call)
// GET   /api/users -> List<User> ; PATCH /api/users/:id body {authorityLevel, authorityScope, role, canSign} (admin only)
// GET   /api/users/:id/stats  -> UserStats  (§4 karar verisi)
// GET/POST /api/delegations ; DELETE not allowed — POST /api/delegations/:id/end
// GET   /api/checklist -> List<ChecklistQuestion>
// GET   /api/automation -> List<AutomationCounter>
// GET   /api/customers, POST /api/customers, PATCH /api/customers/:id
// GET   /api/audit?entity=&entityId= -> List<AuditEntry>
export type RulesResponse = TenantRules;
export interface UserStats { userId: ID; quotesTotal: number; quotesCorrected: number; avgPriceChangePct: number; avgMarginChangePct: number; won: number; lost: number; winRate: number | null }

// ---------- Reports (§16.6) ----------
// GET /api/reports/weekly?weekStart=YYYY-MM-DD -> WeeklyReport
export interface WeeklyReport {
  weekStart: string;
  quoteTime: { medianBusinessHours: number | null; targetBusinessHours: number; onTargetRate: number | null; customerWaitHours: number; overrides: { projectCode: string; reason: string }[] };
  corrections: { rate: number | null; trend: number[] };
  quotes: { won: number; lost: number; lostReasons: { reason: string; count: number }[] };
  automation: { autoCount: number; sampled: number; sampleErrors: number; demotions: number };
  unreflectedPriceDiffEur: number;
  pending: { rules: number; automations: number; checklist: number };
  styleUpdate: string | null;
  rfqOverrides: { projectCode: string; reason: string }[];
}

// ---------- Supplier portal (§10 karma model) ----------
// GET  /api/public/rfq/:token   -> PublicRfqView  (only that item; read-only after deadline until option end)
// POST /api/public/rfq/:token   body PublicOfferInput -> {ok:true, version:number}
export interface PublicRfqView { agencyName: string; projectCode: string; supplierName: string; item: { kind: ServiceKind; description: string; dateFrom: string | null; dateTo: string | null; quantity: number; unit: string; nights: number | null; specs: Record<string, unknown> }; deadlineAt: string | null; readOnly: boolean; previousVersions: { version: number; createdAt: string; lines: SupplierOffer['lines'] }[] }
export interface PublicOfferInput { currency: string; lines: SupplierOffer['lines']; optionUntil?: string; guaranteePax?: number; paymentTerms?: string; prepaymentRate?: number; cancellationTerms?: string; attritionTerms?: string; notes?: string }

// ---------- Message drafts (§3.3 insan imzası) ----------
// GET  /api/drafts?projectId=     -> List<MessageDraft>
// PATCH /api/drafts/:id body {body, subject} (edit = style learning)
// POST /api/drafts/:id/send      -> MessageDraft (sent from the responsible user's own address; human only)

// ---------- Voice / AI assist ----------
// POST /api/assist/voice-command  body {transcript} -> {intent: 'create_project'|'ask'|'unknown'; intake?: IntakeResponse; answer?: string}
// POST /api/assist/ask            body {question, context?: {projectId?: ID}} -> AskResponse

export type {
  AuditEntry, AutomationCounter, BankTransaction, ChecklistQuestion, Contract, ContractDiffItem, Customer, Decision,
  DecisionInput, Delegation, FieldExtra, FinanceEntry, GeneratedDocument, Guest, InboundMessage, MessageDraft,
  OfferEvaluation, Project, Quote, Rfq, ServiceItem, Supplier, SupplierOffer, Task, User,
};

// ---------- Additions requested by apps/web (ADDITIVE — not yet in the original contract) ----------
// GET  /api/projects/:id/field-extras              -> List<FieldExtra>    (operations tab + saha paneli limit total)
// POST /api/projects/:id/field-issues   body FieldIssueInput -> FieldIssue (saha: anlık sorun kaydı, §7 Adım 6)
// GET  /api/projects/:id/field-issues              -> List<FieldIssue>
// POST /api/documents/:id/regenerate               -> GeneratedDocument   (stale → current, §3.5)
// GET  /api/public/rooming/:token                  -> PublicRoomingView
// POST /api/public/rooming/:token  body PublicRoomingSubmit -> {ok:true; saved:number}
// GET  /api/public/extras/:token                   -> PublicExtraView
// GET  /api/public/survey/:token                   -> PublicSurveyView
// POST /api/public/survey/:token   body PublicSurveySubmit -> {ok:true}
// POST /api/public/rfq/:token/files  multipart file -> {ok:true; fileName:string}  (PDF/Excel/görsel ek, §17.5)
// PATCH /api/checklist/:id  body {status:'active'|'rejected'} -> ChecklistQuestion (admin only)
// POST /api/delegations  body DelegationInput -> Delegation
export interface FieldIssueInput { description: string; severity: 'low' | 'medium' | 'high'; occurredAt?: string }
export interface FieldIssue extends FieldIssueInput { id: ID; projectId: ID; enteredBy: ID; createdAt: string }
export interface FieldExtraInput { description: string; amountTry: number; customerPhone?: string }
export interface DelegationInput { delegateId: ID; startsAt: string; endsAt: string }
export interface PublicRoomingGuestInput {
  fullName: string; email?: string; phone?: string; roomType?: string; arrival?: string; departure?: string;
  /** §17.9 explicit, unticked by default: "Bilgilerimin sonraki etkinliklerde kullanılmasına izin veriyorum" */
  consentReuse: boolean;
}
export interface PublicRoomingView {
  agencyName: string; projectCode: string; eventTitle: string | null; startDate: string | null; endDate: string | null;
  roomTypes: string[]; privacyNoticeUrl: string | null; deadlineAt: string | null; readOnly: boolean; submittedCount: number;
}
export interface PublicRoomingSubmit { guests: PublicRoomingGuestInput[] }
export interface PublicExtraView {
  agencyName: string; projectCode: string; description: string; amountTry: number; createdAt: string;
  approvedAt: string | null; approverName: string | null;
}
export interface PublicSurveyView {
  agencyName: string; projectCode: string; submitted: boolean;
  questions: { id: string; text: string; type: 'rating' | 'text' }[];
}
export interface PublicSurveySubmit { answers: Record<string, number | string> }
export interface DailySummary { lines: string[] }
