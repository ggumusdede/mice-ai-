// HTTP API contract shared by apps/api (server) and apps/web (client).
// Base path: /api. Auth: Bearer JWT (staff). Public token routes under /api/public/* need no login.
// Errors: { error: { code: string; message: string; details?: unknown } } with proper HTTP status.
// Every list endpoint returns { items: T[] }.
import type {
  AuditEntry, AutomationCounter, BankTransaction, ChecklistQuestion, Contract, ContractDiffItem, Customer, Decision,
  DecisionInput, Delegation, FieldExtra, FinanceEntry, GeneratedDocument, Guest, ID, InboundMessage, MessageDraft,
  OfferEvaluation, Project, ProfitSummary, Quote, RealizedFx, Rfq, ServiceItem, Supplier, SupplierOffer, Task, User,
} from './models.js';
import type { TenantRules } from './rules.js';
import type { Currency, InboundChannel, Language, ServiceKind } from './enums.js';

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
  /** realizedFx (additive, Q5): evidence-based realized EUR + TRY, averages, FX gain/loss, evidence list */
  profit: { expected: ProfitSummary | null; realized: ProfitSummary | null; realizedFx?: RealizedFx | null };
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
// (additive, Q9 hızlı revizyon) POST /api/quotes/:id/revise  body Partial<BuildQuoteRequest> -> Quote
//   next revision (Rev.N+1) of the SAME quote file (same project code); body omitted → the previous revision's options are reused
//   (superseded offer versions follow to their latest version); validation + approval gates apply again. Only the latest revision
//   can be revised (409 QUOTE_NOT_LATEST); an accepted quote is not revised here (409 QUOTE_ACCEPTED). Sent revisions stay read-only.
// (v0.5 D-1) an ACCEPTED quote can be revised: the new Rev.N needs the customer's re-approval (new link); the accepted version stays
//   valid until the customer accepts the revision. With a signed contract, accepting the revision opens the ek protokol task.
export interface BuildQuoteRequest {
  currency?: string;
  options: { title: string; lines: { serviceItemId: ID; offerId?: ID | null; markup?: number; unitPriceEur?: number }[] }[];
  marginOverrideReason?: string;
  /** (additive, v0.5 S-07) quote FX policy — mandatory on every quote; omitted fields are filled with defaults
   *  (current rate source/date, validity = option date, buffer = rule quoteFxBufferDefault when currency ≠ base currency) */
  fxPolicy?: { rateSource?: string; rateDate?: string; validUntil?: string; bufferPct?: number };
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
export interface SupplierInvoiceInput { projectId: ID; supplierId: ID; invoiceNo: string; amount: number; currency: string; vatAmount?: number; issueDate: string; dueDate?: string; serviceItemIds?: ID[];
  /** (additive, Q5) actual rate proof printed on the invoice: EUR/TRY rate or the TL equivalent of `amount` */
  eurTryRate?: number; tryAmount?: number }
/** (additive, Q5) POST /api/finance/entries/:id/mark-paid body */
export interface MarkPaidRequest { paidAt?: string; reference?: string; paidAmount?: number; paidCurrency?: Currency; eurTryRate?: number; tryAmount?: number }

// ---------- Closing (Adım 8) ----------
// GET  /api/projects/:id/closing-check         -> ClosingCheck
// POST /api/projects/:id/close   body {lessonsLearned?: string} -> Project
// GET/POST /api/public/survey/:token           3-question survey
export interface ClosingCheck { ok: boolean; items: { key: string; label: string; ok: boolean; detail?: string }[]; planVsActual: { planned: ProfitSummary | null; actual: ProfitSummary | null; deviations: { reason: string; amountEur: number }[];
  /** (additive, Q5) evidence-based realized EUR + TRY (each movement at its actual rate) and the planned TRY at the quote rate */
  realizedFx?: RealizedFx | null; plannedTry?: { cost: number; sale: number; profit: number } | null } }

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
// (additive, Q7) GET /api/reports/team-performance?from=YYYY-MM-DD&to=YYYY-MM-DD -> TeamPerformanceReport (admin only; default last 12 months)
//   Per salesperson (project owner): requests, quotes sent, won / lost (+ reasons), quote time vs target, planned margin & markup
//   (separately) and realized profit on won projects. Quote-quality metrics (corrections, approval-required vs free) go to the quote author.
export interface TeamPerformanceLostProject { projectId: ID; code: string; title: string; customerName: string | null; lostReason: string | null; decidedAt: string | null; historical: boolean }
export interface TeamPerformanceRow {
  userId: ID;
  fullName: string;
  role: string | null;
  authorityLevel: string | null;
  active: boolean;
  /** requests (projects) received in the period and owned by the user */
  requests: number;
  /** customer quotes (revisions included) sent in the period on the user's projects */
  quotesSent: number;
  won: number;
  lost: number;
  /** won ÷ (won + lost); null when nothing decided */
  winRate: number | null;
  lostProjects: TeamPerformanceLostProject[];
  lostReasons: { reason: string; count: number }[];
  /** agency business hours request → first quote sent (customer wait excluded), mean over projects whose quote was sent in the period */
  avgQuoteBusinessHours: number | null;
  quoteTargetBusinessHours: number;
  onTargetRate: number | null;
  /** won projects: planned (accepted option) Kâr÷Satış and Kâr÷Alış — separately; null when financials are hidden or no data */
  avgPlannedMargin: number | null;
  avgPlannedMarkup: number | null;
  plannedProfitEur: number | null;
  /** realized profit on won projects (EUR, internal currency); TRY only when the realized-FX evidence provides it */
  realizedProfitEur: number | null;
  realizedProfitTry: number | null;
  realizedProjects: number;
  /** won projects whose TRY realized profit is unknown (no FX evidence) */
  realizedTryMissing: number;
  /** quotes authored by the user (created in the period) */
  quotesBuilt: number;
  quotesReviewed: number;
  quotesCorrected: number;
  /** corrected ÷ reviewed (admin edit / reject on the approval card) */
  correctionRate: number | null;
  approvalRequiredQuotes: number;
  freeQuotes: number;
  blockedQuotes: number;
  historicalProjects: number;
}
export interface TeamPerformanceReport {
  from: string;
  to: string;
  financialsVisible: boolean;
  /** (additive, v0.5 S-19) money columns are in the agency's CURRENT base currency, converted from each project's EUR equivalent at
   *  the rate shown in fxNote */
  baseCurrency?: Currency;
  fxNote?: string | null;
  rows: TeamPerformanceRow[];
  totals: Omit<TeamPerformanceRow, 'userId' | 'fullName' | 'role' | 'authorityLevel' | 'active' | 'lostProjects'>;
  /** v0.5 D-2 (additive): per sub-team ("küçük çekirdek ekip") aggregate — quote quality attributed to author AND team */
  teams?: import('./team.js').TeamPerformanceTeamRow[];
  /** v0.5 D-2: the user's team id per row (null = no team) */
  userTeams?: Record<ID, ID | null>;
}
// (additive, Q6) POST /api/suppliers/:id/request-accreditation body {reason?, projectId?} -> AccreditationRequestResponse
//   sales / ops / admin; idempotent: reuses the open 'supplier_accreditation' card (admin-only decision, never auto-approved)
export interface AccreditationRequestResponse { decisionId: ID; created: boolean; supplierId: ID; status: string }

// GET /api/reports/weekly?weekStart=YYYY-MM-DD -> WeeklyReport
export interface WeeklyReport {
  weekStart: string;
  /** (additive, v0.5 S-19) unreflectedPriceDiffEur is in this currency (agency's current base currency) */
  baseCurrency?: Currency;
  fxNote?: string | null;
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

// ---------- Phase B completion (ADDITIVE) ----------
// POST /api/finance/bank-statements   multipart CSV/XLSX | body {csv} -> BankStatementImportResult
// POST /api/finance/entries/:id/mark-paid   body {paidAt?, reference?} -> FinanceEntry  (a human records the bank payment of an APPROVED request)
// POST /api/finance/commissions/:id/reconcile body {invoiceNo?, amount?} -> FinanceEntry (status matched)
// POST /api/finance/customer-invoices  body CustomerInvoiceInput -> FinanceEntry  (invoice number issued in Mikro)
// GET  /api/field-extras/unreflected-totals  (admin) -> UnreflectedTotals
// POST /api/projects/:id/close  -> CloseProjectResponse (survey link for won projects)
// POST /api/projects/:id/documents  body GenerateDocumentRequest -> GeneratedDocument (program | rooming_list | pnl incl. realized)
// GET  /api/projects/:id/rooming-list.xlsx  -> standard rooming list Excel (PII decrypted only for view_guest_pii roles; header X-PII-Masked)
// POST /api/guests/:id/withdraw-consent  -> {ok:true; anonymized:boolean}
// PATCH /api/projects/:id  {venueName} (or selecting an accommodation / hall offer) regenerates the code's venue segment.
export interface BankStatementImportResult { imported: number; matched: number; suggested: number; unmatched: number; duplicates: number }
export interface CustomerInvoiceInput { projectId: ID; invoiceNo: string; amount: number; currency: string; vatAmount?: number; issueDate?: string; dueDate?: string }
export interface UnreflectedTotals {
  byProject: { projectId: ID; code: string; amountTry: number; amountEur: number; count: number }[];
  byCustomer: { customerId: ID | null; customerName: string | null; amountTry: number; amountEur: number }[];
  totalTry: number;
  totalEur: number;
}
export type CloseProjectResponse = Project & { surveyUrl: string | null; effects: string[] };
export interface GenerateDocumentRequest { kind: 'program' | 'rooming_list' | 'pnl' }

// ---------- §8 İlk veri yükü (initial historical import, ADDITIVE; admin only) ----------
// GET   /api/import/templates/:entity?format=xlsx|csv   -> template file (header + example row)
// GET   /api/import/batches                             -> List<ImportBatch>
// POST  /api/import/batches          body {label?}      -> ImportBatch
// GET   /api/import/batches/:id                         -> ImportBatchDetail
// POST  /api/import/batches/:id/files  multipart {entity, file} | body {entity, fileName, csv | dataBase64} -> ImportBatchDetail
// PATCH /api/import/rows/:id         body {input}       -> ImportBatchDetail   (inline edit; review → pending, revalidated)
// POST  /api/import/batches/:id/review body ImportReviewRequest -> ImportBatchDetail
// POST  /api/import/batches/:id/revalidate              -> ImportBatchDetail
// POST  /api/import/batches/:id/commit                  -> ImportBatchDetail (approved rows → live tables, one transaction)
// POST  /api/import/batches/:id/abandon body {reason?}  -> ImportBatch
// GET   /api/projects?historical=exclude|include|only   (default exclude: imported past projects never show in active lists)
export type ImportEntityName = 'suppliers' | 'customers' | 'projects' | 'service_lines' | 'price_points' | 'channel_prices' | 'finance_movements';
export type ImportRowStatusName = 'ok' | 'warning' | 'error';
export type ImportReview = 'pending' | 'approved' | 'rejected';
export interface ImportIssueView { code: string; severity: 'error' | 'warning' | 'info'; message: string; field?: string }
export interface ImportBatch {
  id: ID; label: string | null; status: 'open' | 'committed' | 'abandoned';
  summary: ImportSummary; createdBy: ID; createdAt: string; committedAt: string | null; committedBy: ID | null;
  abandonedAt: string | null; abandonReason: string | null;
}
export interface ImportSummary {
  rows: number; ok: number; warning: number; error: number; pending: number; approved: number; rejected: number;
  byEntity: Partial<Record<ImportEntityName, { rows: number; ok: number; warning: number; error: number; approved: number; pending: number }>>;
  committed?: Partial<Record<ImportEntityName, { created: number; linked: number }>>;
  windowMonths?: number; windowStart?: string;
}
export interface ImportFile { id: ID; entity: ImportEntityName; fileName: string; rowCount: number; unknownHeaders: string[]; createdAt: string }
export interface ImportRow {
  id: ID; fileId: ID; entity: ImportEntityName; rowNo: number; input: Record<string, string | number | null>;
  data: Record<string, unknown>; status: ImportRowStatusName; issues: ImportIssueView[]; review: ImportReview;
  resolved: Record<string, unknown>; committedEntityId: ID | null; committedAction: 'created' | 'linked' | null;
}
export interface ImportBatchDetail { batch: ImportBatch; files: ImportFile[]; rows: ImportRow[] }
export interface ImportReviewRequest {
  action: 'approve' | 'reject' | 'reset';
  rowIds?: ID[];
  /** bulk: every row of these statuses (error rows are never approved) */
  statuses?: ImportRowStatusName[];
  entity?: ImportEntityName;
}

// ---------- v0.5-A — para ve tedarik çekirdeği ----------
// GET  /api/settings                                   -> TenantSettings
// POST /api/settings/base-currency  body {currency, reason} -> {decision}  (admin; Face ID decision 'base_currency_change';
//      on approval the agency base currency changes — applies to NEW projects only; every project keeps its own)
// GET  /api/contract-rates?supplierId=                 -> List<ContractRate>
// POST /api/contract-rates  body ContractRateInput     -> ContractRate
// POST /api/contract-rates/:id/archive                 -> ContractRate   (no delete: status)
// GET  /api/allotments?projectId=                      -> List<AllotmentBlock> (with summary)
// POST /api/allotments  body AllotmentInput            -> AllotmentBlock
// POST /api/allotments/:id/pickup  body {date?, rooms}  -> AllotmentBlock (date omitted = every night)
// POST /api/allotments/:id/release body {rooms, reason?} -> AllotmentBlock (human only; supplier notice is a draft for approval)
// GET  /api/projects/:id/options                       -> List<SupplierOption>
// POST /api/projects/:id/options  body SupplierOptionInput -> SupplierOption
// POST /api/options/:id/extension-request              -> {draftId, decisionId} (draft to the supplier, human approval)
// POST /api/options/:id/extended  body {optionUntil}   -> SupplierOption (dependent customer quote → stale)
// POST /api/options/:id/status    body {status: 'released'|'confirmed'} -> SupplierOption
// POST /api/finance/:id/payment-request body {depositFirstReason?} — S-06 "kapora önce" (409 DEPOSIT_FIRST_REASON_REQUIRED /
//      DEPOSIT_FIRST_BLOCKED)
export interface ContractRateInput {
  supplierId: ID; kind: ServiceKind; roomType?: string | null; board?: string | null; unit?: string;
  validFrom: string; validTo: string; price: number; currency: Currency; vatIncluded?: boolean; conditions?: string | null;
}
export interface AllotmentInput {
  projectId?: ID | null; serviceItemId?: ID | null; supplierId: ID; roomType?: string | null; dateFrom: string; dateTo: string;
  roomsPerNight: number; ratePerRoomNight: number; currency: Currency; releaseDate?: string | null; attritionPct?: number;
  penaltyPct?: number; penaltyTerms?: string | null;
}
export interface SupplierOptionInput { serviceItemId: ID; supplierId: ID; offerId?: ID | null; rank?: 1 | 2; optionUntil: string; note?: string | null }
