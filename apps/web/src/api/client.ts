// Typed HTTP client for the FIXED contract in @mice/shared (packages/shared/src/api.ts).
// Base path /api, Bearer JWT, errors { error: { code, message, details? } }, lists { items: T[] }.
import type {
  ApiError, AskResponse, AuditEntry, AutomationCounter, BankStatementImportResult, BankTransaction, BuildQuoteRequest, CloseProjectResponse, CustomerInvoiceInput,
  GenerateDocumentRequest, UnreflectedTotals, ChannelPriceInput, ChecklistQuestion,
  ClosingCheck, ComparisonResponse, Contract, CreateRfqsRequest, Customer, DailySummary, Decision, DecideResponse,
  DecisionInput, Delegation, DelegationInput, FieldExtra, FieldExtraInput, FieldIssue, FieldIssueInput, FinanceEntry,
  GeneratedDocument, Guest, IntakeRequest, IntakeResponse, List, LoginRequest, LoginResponse, ManualOfferInput,
  MeResponse, MessageDraft, NegotiationArgument, Project, ProjectDetail, PublicExtraView, PublicOfferInput,
  PublicQuoteView, PublicRfqView, PublicRoomingSubmit, PublicRoomingView, PublicSurveySubmit, PublicSurveyView, Quote,
  Rfq, RulesResponse, ServiceItem, ServiceItemInput, SimilarProject, Supplier, SupplierInvoiceInput, SupplierOffer,
  SupplierRanking, Task, TenantRules, User, UserStats, WeeklyReport,
} from '@mice/shared';

export const API_BASE = '/api';
const TOKEN_KEY = 'mice.token';

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
  get isNetwork() {
    return this.status === 0;
  }
}

// ---------- token ----------
let memToken: string | null = null;
export function getToken(): string | null {
  if (memToken) return memToken;
  try {
    memToken = localStorage.getItem(TOKEN_KEY);
  } catch {
    /* storage blocked */
  }
  return memToken;
}
export function setToken(token: string | null) {
  memToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked */
  }
}

let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}

// ---------- core ----------
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
interface RequestOpts {
  auth?: boolean;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  /** raw response (blob) */
  raw?: boolean;
}

export function buildQuery(query?: RequestOpts['query']): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function parseError(res: Response): Promise<ApiClientError> {
  let code = `http_${res.status}`;
  let message = res.statusText || 'Hata';
  let details: unknown;
  try {
    const data = (await res.json()) as Partial<ApiError>;
    if (data?.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
      details = data.error.details;
    }
  } catch {
    /* non-JSON error body */
  }
  return new ApiClientError(res.status, code, message, details);
}

/** Short device label recorded in the audit log (kim / ne zaman / hangi cihaz); the API falls back to the user-agent. */
function clientDevice(): string {
  if (typeof navigator === 'undefined') return 'Web';
  const ua = navigator.userAgent;
  const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Web';
  const standalone = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;
  return `${dev} (${standalone ? 'PWA' : 'Web'})`;
}

export async function request<T>(method: Method, path: string, body?: unknown, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Device': clientDevice() };
  const auth = opts.auth ?? true;
  if (auth) {
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${buildQuery(opts.query)}`, { method, headers, body: payload, signal: opts.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiClientError(0, 'network', 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.');
  }
  if (!res.ok) {
    const err = await parseError(res);
    if (res.status === 401 && auth && unauthorizedHandler) unauthorizedHandler();
    throw err;
  }
  if (opts.raw) return (await res.blob()) as unknown as T;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const get = <T>(path: string, query?: RequestOpts['query'], opts?: RequestOpts) => request<T>('GET', path, undefined, { ...opts, query });
const post = <T>(path: string, body?: unknown, opts?: RequestOpts) => request<T>('POST', path, body ?? {}, opts);
const patch = <T>(path: string, body: unknown, opts?: RequestOpts) => request<T>('PATCH', path, body, opts);
const items = <T>(p: Promise<List<T>>) => p.then((r) => r?.items ?? []);
const enc = encodeURIComponent;

function fileForm(file: File, extra?: Record<string, string>): FormData {
  const fd = new FormData();
  if (extra) for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  fd.append('file', file, file.name);
  return fd;
}

/** Opens an authenticated binary (PDF/XLSX) in a new tab / download. */
export async function openBinary(path: string, filename?: string) {
  const blob = await request<Blob>('GET', path, undefined, { raw: true });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  if (filename) a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------- endpoints ----------
export const api = {
  auth: {
    login: (b: LoginRequest) => post<LoginResponse>('/auth/login', b, { auth: false }),
    me: () => get<MeResponse>('/auth/me'),
    webauthnRegisterOptions: (password: string) => post<Record<string, unknown>>('/auth/webauthn/register/options', { password }),
    webauthnRegisterVerify: (response: unknown, deviceLabel?: string) => post<{ verified: boolean }>('/auth/webauthn/register/verify', { response, deviceLabel }),
    webauthnAuthOptions: (b?: { decisionId?: string }) => post<Record<string, unknown>>('/auth/webauthn/authenticate/options', b ?? {}),
  },
  decisions: {
    list: (status = 'open') => items(get<List<Decision>>('/decisions', { status })),
    get: (id: string) => get<Decision>(`/decisions/${enc(id)}`),
    decide: (id: string, b: DecisionInput) => post<DecideResponse>(`/decisions/${enc(id)}/decide`, b),
  },
  intake: (b: IntakeRequest) => post<IntakeResponse>('/intake', b),
  projects: {
    list: (q?: { q?: string; outcome?: string; step?: string | number }) => items(get<List<Project>>('/projects', q)),
    get: (id: string) => get<ProjectDetail>(`/projects/${enc(id)}`),
    patch: (id: string, b: Partial<Project> & { reason?: string }) => patch<Project>(`/projects/${enc(id)}`, b),
    assign: (id: string, userId: string) => post<Project>(`/projects/${enc(id)}/assign`, { userId }),
    outcome: (id: string, b: { outcome: 'won' | 'lost'; lostReason?: string }) => post<Project>(`/projects/${enc(id)}/outcome`, b),
    ask: (id: string, question: string) => post<AskResponse>(`/projects/${enc(id)}/ask`, { question }),
    timeline: (id: string) => items(get<List<AuditEntry>>(`/projects/${enc(id)}/timeline`)),
    similar: (id: string) => items(get<List<SimilarProject>>(`/projects/${enc(id)}/similar`)),
    addItem: (id: string, b: ServiceItemInput) => post<ServiceItem>(`/projects/${enc(id)}/items`, b),
    buildQuote: (id: string, b: BuildQuoteRequest) => post<Quote>(`/projects/${enc(id)}/quotes`, b),
    createContract: (id: string, b: { supplierId: string; serviceItemIds: string[]; template: 'agency' | 'supplier' }) =>
      post<Contract>(`/projects/${enc(id)}/contracts`, b),
    guests: (id: string) => items(get<List<Guest>>(`/projects/${enc(id)}/guests`)),
    saveGuests: (id: string, guests: Partial<Guest>[]) => post<List<Guest>>(`/projects/${enc(id)}/guests`, guests),
    roomingLink: (id: string) => post<{ url: string }>(`/projects/${enc(id)}/rooming-link`),
    fieldExtras: (id: string) => items(get<List<FieldExtra>>(`/projects/${enc(id)}/field-extras`)),
    addFieldExtra: (id: string, b: FieldExtraInput) => post<FieldExtra>(`/projects/${enc(id)}/field-extras`, b),
    fieldIssues: (id: string) => items(get<List<FieldIssue>>(`/projects/${enc(id)}/field-issues`)),
    addFieldIssue: (id: string, b: FieldIssueInput) => post<FieldIssue>(`/projects/${enc(id)}/field-issues`, b),
    dailySummary: (id: string) => get<DailySummary>(`/projects/${enc(id)}/daily-summary`),
    customerInvoiceDraft: (id: string) => post<GeneratedDocument>(`/projects/${enc(id)}/customer-invoice-draft`),
    closingCheck: (id: string) => get<ClosingCheck>(`/projects/${enc(id)}/closing-check`),
    close: (id: string, lessonsLearned?: string) => post<CloseProjectResponse>(`/projects/${enc(id)}/close`, { lessonsLearned }),
    generateDocument: (id: string, kind: GenerateDocumentRequest['kind']) => post<GeneratedDocument>(`/projects/${enc(id)}/documents`, { kind }),
    /** standard rooming list Excel (PII only for authorized roles — masked otherwise) */
    roomingListXlsx: (id: string, code?: string) => openBinary(`/projects/${enc(id)}/rooming-list.xlsx`, `${code ?? 'proje'}-rooming-list.xlsx`),
  },
  items: {
    patch: (id: string, b: Partial<ServiceItemInput>) => patch<ServiceItem>(`/items/${enc(id)}`, b),
    selectOffer: (id: string, offerId: string) => post<ServiceItem>(`/items/${enc(id)}/select-offer`, { offerId }),
    shortlist: (id: string) => items(get<List<SupplierRanking>>(`/items/${enc(id)}/shortlist`)),
    createRfqs: (id: string, b: CreateRfqsRequest) => items(post<List<Rfq>>(`/items/${enc(id)}/rfqs`, b)),
    addOffer: (id: string, b: ManualOfferInput) => post<SupplierOffer>(`/items/${enc(id)}/offers`, b),
    parseOfferText: (id: string, b: { text: string; supplierId: string }) => post<SupplierOffer>(`/items/${enc(id)}/offers/parse`, b),
    parseOfferFile: (id: string, file: File, supplierId: string) =>
      post<SupplierOffer>(`/items/${enc(id)}/offers/parse`, fileForm(file, { supplierId })),
    comparison: (id: string) => get<ComparisonResponse>(`/items/${enc(id)}/comparison`),
  },
  rfqs: {
    cancel: (id: string, reason: string) => post<Rfq>(`/rfqs/${enc(id)}/cancel`, { reason }),
    /** rotates and returns a one-time supplier link (manual sharing, e.g. WhatsApp) */
    link: (id: string) => post<Rfq>(`/rfqs/${enc(id)}/link`),
  },
  offers: {
    verify: (id: string, b: Partial<SupplierOffer>) => post<SupplierOffer>(`/offers/${enc(id)}/verify`, b),
    negotiate: (id: string, args: NegotiationArgument[]) => post<MessageDraft>(`/offers/${enc(id)}/negotiate`, { arguments: args }),
  },
  channelPrices: { add: (b: ChannelPriceInput) => post<{ id: string }>('/channel-prices', b) },
  suppliers: {
    list: (q?: { kind?: string; city?: string; status?: string }) => items(get<List<Supplier>>('/suppliers', q)),
    create: (b: Partial<Supplier>) => post<Supplier>('/suppliers', b),
    patch: (id: string, b: Partial<Supplier>) => patch<Supplier>(`/suppliers/${enc(id)}`, b),
  },
  quotes: {
    get: (id: string) => get<Quote>(`/quotes/${enc(id)}`),
    send: (id: string) => post<Quote>(`/quotes/${enc(id)}/send`),
    pdf: (id: string) => openBinary(`/quotes/${enc(id)}/pdf`, `teklif-${id}.pdf`),
  },
  contracts: {
    parseText: (id: string, text: string) => post<Contract>(`/contracts/${enc(id)}/parse`, { text }),
    parseFile: (id: string, file: File) => post<Contract>(`/contracts/${enc(id)}/parse`, fileForm(file)),
    compare: (id: string) => post<Contract>(`/contracts/${enc(id)}/compare`),
    sign: (id: string, b: { signedBy: string; scanFileName?: string }) => post<Contract>(`/contracts/${enc(id)}/sign`, b),
    amend: (id: string, b: { changes: unknown; reason: string }) => post<Contract>(`/contracts/${enc(id)}/amend`, b),
  },
  tasks: {
    list: (q?: { mine?: 1; status?: string }) => items(get<List<Task>>('/tasks', q)),
    complete: (id: string) => post<Task>(`/tasks/${enc(id)}/complete`),
  },
  fieldExtras: {
    unreflectedTotals: () => get<UnreflectedTotals>('/field-extras/unreflected-totals'),
    reflect: (id: string, b: { reflected: boolean; reason?: string }) => post<FieldExtra>(`/field-extras/${enc(id)}/reflect`, b),
  },
  documents: {
    regenerate: (id: string) => post<GeneratedDocument>(`/documents/${enc(id)}/regenerate`),
  },
  finance: {
    entries: (q?: { projectId?: string; kind?: string; status?: string }) => items(get<List<FinanceEntry>>('/finance/entries', q)),
    supplierInvoice: (b: SupplierInvoiceInput) => post<{ entry: FinanceEntry; alarms: string[] }>('/finance/supplier-invoices', b),
    supplierInvoiceFile: (file: File, meta: Partial<Record<keyof SupplierInvoiceInput, string>>) =>
      post<{ entry: FinanceEntry; alarms: string[] }>('/finance/supplier-invoices', fileForm(file, meta as Record<string, string>)),
    paymentRequest: (entryId: string) => post<FinanceEntry>('/finance/payment-requests', { entryId }),
    /** a human records the bank payment of an approved request (the system never pays, §6) */
    markPaid: (entryId: string, b: { paidAt?: string; reference?: string } = {}) => post<FinanceEntry>(`/finance/entries/${enc(entryId)}/mark-paid`, b),
    bankStatement: (file: File) => post<BankStatementImportResult>('/finance/bank-statements', fileForm(file)),
    bankTransactions: (status?: BankTransaction['status']) => items(get<List<BankTransaction>>('/finance/bank-transactions', { status })),
    matchBankTransaction: (id: string, entryId: string) => post<BankTransaction>(`/finance/bank-transactions/${enc(id)}/match`, { entryId }),
    commissions: (projectId?: string) => items(get<List<FinanceEntry>>('/finance/commissions', { projectId })),
    reconcileCommission: (id: string, b: { invoiceNo?: string; amount?: number }) => post<FinanceEntry>(`/finance/commissions/${enc(id)}/reconcile`, b),
    customerInvoice: (b: CustomerInvoiceInput) => post<FinanceEntry>('/finance/customer-invoices', b),
    /** Mikro Yazılım import Excel (authenticated binary download) */
    mikroExport: (q: { from?: string; to?: string } = {}) =>
      openBinary(`/finance/export/mikro${buildQuery(q)}`, `mikro-aktarim-${q.from ?? 'baslangic'}-${q.to ?? 'bugun'}.xlsx`),
  },
  rules: {
    get: () => get<RulesResponse>('/rules'),
    patch: (b: Partial<TenantRules>) => patch<RulesResponse>('/rules', b),
  },
  users: {
    list: () => items(get<List<User>>('/users')),
    patch: (id: string, b: Partial<Pick<User, 'authorityLevel' | 'authorityScope' | 'role' | 'canSign'>>) => patch<User>(`/users/${enc(id)}`, b),
    stats: (id: string) => get<UserStats>(`/users/${enc(id)}/stats`),
  },
  delegations: {
    list: () => items(get<List<Delegation>>('/delegations')),
    create: (b: DelegationInput) => post<Delegation>('/delegations', b),
    end: (id: string) => post<Delegation>(`/delegations/${enc(id)}/end`),
  },
  checklist: {
    list: () => items(get<List<ChecklistQuestion>>('/checklist')),
    setStatus: (id: string, status: 'active' | 'rejected') => patch<ChecklistQuestion>(`/checklist/${enc(id)}`, { status }),
  },
  automation: { list: () => items(get<List<AutomationCounter>>('/automation')) },
  customers: {
    list: () => items(get<List<Customer>>('/customers')),
    create: (b: Partial<Customer>) => post<Customer>('/customers', b),
    patch: (id: string, b: Partial<Customer>) => patch<Customer>(`/customers/${enc(id)}`, b),
  },
  drafts: {
    list: (projectId?: string) => items(get<List<MessageDraft>>('/drafts', { projectId })),
    patch: (id: string, b: { body: string; subject?: string | null }) => patch<MessageDraft>(`/drafts/${enc(id)}`, b),
    send: (id: string) => post<MessageDraft>(`/drafts/${enc(id)}/send`),
  },
  reports: { weekly: (weekStart?: string) => get<WeeklyReport>('/reports/weekly', { weekStart }) },
  assist: {
    ask: (question: string, projectId?: string) => post<AskResponse>('/assist/ask', { question, context: projectId ? { projectId } : undefined }),
  },
  // ---------- public token pages (no login) ----------
  public: {
    rfq: (t: string) => get<PublicRfqView>(`/public/rfq/${enc(t)}`, undefined, { auth: false }),
    submitRfq: (t: string, b: PublicOfferInput) => post<{ ok: true; version: number }>(`/public/rfq/${enc(t)}`, b, { auth: false }),
    rfqFile: (t: string, file: File) => post<{ ok: true; fileName: string }>(`/public/rfq/${enc(t)}/files`, fileForm(file), { auth: false }),
    quote: (t: string) => get<PublicQuoteView>(`/public/quotes/${enc(t)}`, undefined, { auth: false }),
    acceptQuote: (t: string, b: { optionNo: number; approverName: string; poNumber?: string }) =>
      post<{ ok: true }>(`/public/quotes/${enc(t)}/accept`, b, { auth: false }),
    reviseQuote: (t: string, message: string) => post<{ ok: true }>(`/public/quotes/${enc(t)}/revision`, { message }, { auth: false }),
    rooming: (t: string) => get<PublicRoomingView>(`/public/rooming/${enc(t)}`, undefined, { auth: false }),
    submitRooming: (t: string, b: PublicRoomingSubmit) => post<{ ok: true; saved: number }>(`/public/rooming/${enc(t)}`, b, { auth: false }),
    extra: (t: string) => get<PublicExtraView>(`/public/extras/${enc(t)}`, undefined, { auth: false }),
    approveExtra: (t: string, approverName: string) => post<{ ok: true }>(`/public/extras/${enc(t)}/approve`, { approverName }, { auth: false }),
    survey: (t: string) => get<PublicSurveyView>(`/public/survey/${enc(t)}`, undefined, { auth: false }),
    submitSurvey: (t: string, b: PublicSurveySubmit) => post<{ ok: true }>(`/public/survey/${enc(t)}`, b, { auth: false }),
  },
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Beklenmeyen bir hata oluştu';
}
