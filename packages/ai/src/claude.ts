// ClaudeAiService — AiService on the Anthropic Messages API (@anthropic-ai/sdk).
//
// Design:
// - Every extraction uses structured outputs (output_config.format = json_schema) with an explicit schema, so the
//   response is guaranteed-parseable JSON. (Forced tool_choice is rejected by Claude Sonnet 5.5 / Opus 5.5.)
// - Long static system prompts carry cache_control → prompt caching; volatile content goes in the user turn.
// - PII is pseudonymized before the request and restored in the output (§18.2). Binary PDFs/images cannot be masked
//   in-process; they are sent as-is unless `allowBinaryDocuments` is false (AI_ALLOW_BINARY_DOCS=false).
// - Retries: SDK built-in (maxRetries, exponential backoff on 408/409/429/5xx/connection errors); failures are mapped
//   to a typed AiError.
// - Server-side refusal fallback (beta) is enabled for models that support it.
// - Confidence: computed from per-field confidences (same formula as the mock) and capped by the model's self-report.
import Anthropic from '@anthropic-ai/sdk';
import {
  CURRENCIES, LANGUAGES, SERVICE_KINDS, type ContractFields, type Currency, type Extracted, type Language, type OfferLine,
  type RequestExtraction, type ServiceKind,
} from '@mice/shared';
import { draftActionFor } from './authority.js';
import { revealsAi, sanitizeDraftFacts } from './drafts.js';
import { AiError } from './errors.js';
import { contractConfidence, ex, invoiceConfidence, offerConfidence, requestExtractionConfidence } from './heuristics.js';
import type {
  AiResult, AiService, AskAnswer, AskContext, Draft, DraftRequest, FileInput, ParsedInvoice, ParsedOffer,
} from './index.js';
import { collectNamesFromFacts, Pseudonymizer } from './pii.js';
import {
  SCHEMA_ASK, SCHEMA_CHECKLIST, SCHEMA_COMMAND, SCHEMA_CONTRACT, SCHEMA_DRAFT, SCHEMA_INVOICE, SCHEMA_OFFER,
  SCHEMA_REQUEST, SCHEMA_STYLE, SYSTEM_ASK, SYSTEM_CHECKLIST, SYSTEM_COMMAND, SYSTEM_DRAFT, SYSTEM_EXTRACT_REQUEST,
  SYSTEM_PARSE_CONTRACT, SYSTEM_PARSE_INVOICE, SYSTEM_PARSE_OFFER, SYSTEM_STYLE,
} from './prompts.js';
import { clamp01, isValidIsoDate, round2 } from './text.js';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_FAST_MODEL = 'claude-haiku-5-5';
/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). Haiku has none. */
const FALLBACK_MODELS = /^claude-(sonnet-5-5|opus-5-5|opus-5|fable-5-[12]|mythos-5-[12])$/;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** xlsx/docx/xls/zip: binary, must be converted (e.g. sheet → CSV) by the caller */
const BINARY_OFFICE = /openxmlformats|ms-excel|msword|ms-office|zip|octet-stream|vnd\.oasis/;

type Effort = 'low' | 'medium' | 'high';
type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

/** The slice of the Anthropic client this service uses — injectable for tests. */
export interface AnthropicLike {
  beta: { messages: { create(body: CreateParams, options?: Anthropic.RequestOptions): PromiseLike<Anthropic.Beta.BetaMessage> } };
}

export interface ClaudeAiServiceOptions {
  client?: AnthropicLike;
  apiKey?: string;
  /** extraction / drafting / document reading (default claude-sonnet-5-5, env AI_MODEL) */
  model?: string;
  /** cheap classification (default claude-haiku-5-5, env AI_MODEL_FAST) */
  fastModel?: string;
  /** SDK retries (default 3) */
  maxRetries?: number;
  /** per-attempt timeout in ms (default 120 000) */
  timeoutMs?: number;
  /** server-side refusal fallback on supported models (default true) */
  fallbacks?: boolean;
  /** send PDFs / images that cannot be pseudonymized in-process (default true; KVKK switch) */
  allowBinaryDocuments?: boolean;
}

interface CallSpec {
  op: string;
  model: string;
  system: string;
  schema: Record<string, unknown>;
  content: ContentBlock[];
  maxTokens: number;
  effort: Effort;
}

interface CallResult<T> { data: T; model: string; tokens: NonNullable<AiResult<unknown>['tokens']> }

// ------------------------------------------------------------------------------------------- validators
const vStr = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);
const vNum = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const vInt = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : null);
const vBool = (x: unknown): boolean | null => (typeof x === 'boolean' ? x : null);
const vDate = (x: unknown): string | null => (isValidIsoDate(x) ? x : null);
const vCur = (x: unknown): Currency | null => (typeof x === 'string' && (CURRENCIES as readonly string[]).includes(x) ? (x as Currency) : null);
const vKind = (x: unknown): ServiceKind => (typeof x === 'string' && (SERVICE_KINDS as readonly string[]).includes(x) ? (x as ServiceKind) : 'other');
const vRate = (x: unknown): number | null => {
  const n = vNum(x);
  if (n === null) return null;
  return n > 1 && n <= 100 ? n / 100 : n >= 0 && n <= 1 ? n : null;
};
type Obj = Record<string, unknown>;
const asObj = (x: unknown): Obj => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : {});
const asArr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
function fcMap(x: unknown): Record<string, number> {
  const o = asObj(x);
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, clamp01(v)]));
}

export class ClaudeAiService implements AiService {
  readonly name = 'claude';
  readonly model: string;
  readonly fastModel: string;
  private readonly client: AnthropicLike;
  private readonly fallbacks: boolean;
  private readonly allowBinaryDocuments: boolean;

  constructor(opts: ClaudeAiServiceOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.fastModel = opts.fastModel ?? DEFAULT_FAST_MODEL;
    this.fallbacks = opts.fallbacks ?? true;
    this.allowBinaryDocuments = opts.allowBinaryDocuments ?? true;
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: opts.maxRetries ?? 3, timeout: opts.timeoutMs ?? 120_000 });
  }

  // ========================================================================================= core call
  /** Builds the request (exposed for tests / cost estimation). */
  buildParams(spec: CallSpec): CreateParams {
    const params: CreateParams = {
      model: spec.model,
      max_tokens: spec.maxTokens,
      system: [{ type: 'text', text: spec.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: spec.content }],
      output_config: { effort: spec.effort, format: { type: 'json_schema', schema: spec.schema } },
    };
    if (this.fallbacks && FALLBACK_MODELS.test(spec.model)) {
      params.betas = [FALLBACK_BETA];
      params.fallbacks = 'default';
    }
    return params;
  }

  private async call<T>(spec: CallSpec): Promise<CallResult<T>> {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await this.client.beta.messages.create(this.buildParams(spec));
    } catch (e) {
      throw mapError(e, spec.op);
    }
    if (res.stop_reason === 'refusal') {
      throw new AiError('refusal', `${spec.op}: model declined the request`, { operation: spec.op, retryable: false });
    }
    if (res.stop_reason === 'max_tokens') {
      throw new AiError('truncated', `${spec.op}: output truncated at max_tokens=${spec.maxTokens}`, { operation: spec.op, retryable: true });
    }
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch (e) {
      throw new AiError('invalid_output', `${spec.op}: response is not valid JSON`, { operation: spec.op, cause: e, retryable: true });
    }
    const u = res.usage;
    return {
      data,
      model: res.model ?? spec.model,
      tokens: {
        input: u?.input_tokens ?? 0,
        output: u?.output_tokens ?? 0,
        cacheRead: u?.cache_read_input_tokens ?? 0,
        cacheWrite: u?.cache_creation_input_tokens ?? 0,
      },
    };
  }

  /** Turns a FileInput into content blocks. Text-like files are decoded and pseudonymized; PDFs/images go as-is. */
  private fileBlocks(file: FileInput, pii: Pseudonymizer, op: string): ContentBlock[] {
    const mt = file.mimeType.toLowerCase();
    const binary = mt === 'application/pdf' || mt.startsWith('image/');
    if (binary && !this.allowBinaryDocuments) {
      throw new AiError('pii_unmaskable', `${op}: binary documents are disabled (AI_ALLOW_BINARY_DOCS=false); pass extracted text instead`, { operation: op, retryable: false });
    }
    if (mt === 'application/pdf') {
      return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.base64.replace(/\s+/g, '') }, title: file.filename }];
    }
    if (mt.startsWith('image/')) {
      const media = (mt === 'image/jpg' ? 'image/jpeg' : mt) as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(media)) {
        throw new AiError('unsupported_input', `${op}: image type ${mt} not supported (jpeg/png/gif/webp)`, { operation: op, retryable: false });
      }
      return [{ type: 'image', source: { type: 'base64', media_type: media, data: file.base64.replace(/\s+/g, '') } }];
    }
    if (!BINARY_OFFICE.test(mt) && (mt.startsWith('text/') || /json|csv|xml|rfc822|message/.test(mt))) {
      const text = Buffer.from(file.base64, 'base64').toString('utf8');
      return [{ type: 'text', text: `<file name="${file.filename}" type="${mt}">\n${pii.mask(text)}\n</file>` }];
    }
    throw new AiError('unsupported_input', `${op}: ${file.filename} (${mt}) — convert spreadsheets to CSV text before calling`, { operation: op, retryable: false });
  }

  private docContent(input: { text?: string; file?: FileInput }, header: string, pii: Pseudonymizer, op: string): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    if (input.file) blocks.push(...this.fileBlocks(input.file, pii, op));
    const parts = [header];
    if (input.text && input.text.trim()) parts.push(`<document>\n${pii.mask(input.text)}\n</document>`);
    else if (!input.file) throw new AiError('unsupported_input', `${op}: neither text nor file given`, { operation: op, retryable: false });
    blocks.push({ type: 'text', text: parts.join('\n\n') });
    return blocks;
  }

  private result<T>(data: T, confidence: number, r: CallResult<unknown>, action: AiResult<T>['action']): AiResult<T> {
    return { data, confidence: round2(clamp01(confidence)), model: r.model, action, tokens: r.tokens };
  }

  // ========================================================================================= AiService
  async extractRequest(text: string, opts: { channel: string; today: string; knownCustomers?: string[] }): Promise<AiResult<RequestExtraction>> {
    const pii = new Pseudonymizer();
    const header = [`TODAY: ${opts.today}`, `CHANNEL: ${opts.channel}`, opts.knownCustomers?.length ? `KNOWN CUSTOMERS: ${opts.knownCustomers.join(' | ')}` : null]
      .filter(Boolean).join('\n');
    const r = await this.call<Obj>({
      op: 'extractRequest', model: this.model, system: SYSTEM_EXTRACT_REQUEST, schema: SCHEMA_REQUEST, maxTokens: 8000, effort: 'medium',
      content: [{ type: 'text', text: `${header}\n\n<message>\n${pii.mask(text)}\n</message>` }],
    });
    const d = pii.restoreDeep(r.data);
    const f = <T>(key: string, v: (x: unknown) => T | null): Extracted<T> => {
      const o = asObj(d[key]);
      const value = v(o.value);
      return ex(value, clamp01(o.confidence), vStr(o.evidence) ?? undefined);
    };
    const budget = f('budget', vNum);
    if (budget.value !== null && d.budgetPerPerson === true) budget.source = `kişi başı: ${budget.source ?? ''}`.trim();
    const language = (LANGUAGES as readonly string[]).includes(String(d.language)) ? (d.language as Language) : 'tr';
    const data: RequestExtraction = {
      customerName: f('customerName', vStr), eventType: f('eventType', vStr), startDate: f('startDate', vDate), endDate: f('endDate', vDate),
      dateFlexibility: f('dateFlexibility', vStr), pax: f('pax', vInt), roomsSgl: f('roomsSgl', vInt), roomsDbl: f('roomsDbl', vInt),
      city: f('city', vStr), district: f('district', vStr), hallLayout: f('hallLayout', vStr), fnb: f('fnb', vStr),
      technical: f('technical', vStr), transfer: f('transfer', vStr), budget, budgetCurrency: f('budgetCurrency', vCur),
      decisionDate: f('decisionDate', vDate), billingInfo: f('billingInfo', vStr), language,
    };
    const conf = Math.min(requestExtractionConfidence(data), clamp01(d.overallConfidence ?? 1));
    return this.result(data, conf, r, 'request_extraction');
  }

  async parseSupplierOffer(input: { text?: string; file?: FileInput; itemKind?: string; today: string }): Promise<AiResult<ParsedOffer>> {
    const pii = new Pseudonymizer();
    const header = [`TODAY: ${input.today}`, input.itemKind ? `SERVICE ITEM KIND: ${input.itemKind}` : null, 'Read the supplier offer above/below.'].filter(Boolean).join('\n');
    const r = await this.call<Obj>({
      op: 'parseSupplierOffer', model: this.model, system: SYSTEM_PARSE_OFFER, schema: SCHEMA_OFFER, maxTokens: 16000, effort: 'medium',
      content: this.docContent(input, header, pii, 'parseSupplierOffer'),
    });
    const d = pii.restoreDeep(r.data);
    const lineConf: number[] = [];
    const lines: OfferLine[] = asArr(d.lines).map((x) => {
      const o = asObj(x);
      lineConf.push(clamp01(o.confidence));
      const l: OfferLine = {
        description: vStr(o.description) ?? '', kind: vKind(o.kind), quantity: vNum(o.quantity) ?? 1, unit: vStr(o.unit) ?? 'adet',
        unitPrice: vNum(o.unitPrice) ?? 0, vatIncluded: vBool(o.vatIncluded) ?? false, vatRate: vRate(o.vatRate) ?? 0,
      };
      const nights = vInt(o.nights); if (nights !== null) l.nights = nights;
      const ati = vBool(o.accommodationTaxIncluded); if (ati !== null) l.accommodationTaxIncluded = ati;
      const rt = vStr(o.roomType); if (rt) l.roomType = rt;
      const bd = vStr(o.board); if (bd) l.board = bd;
      return l;
    });
    const fieldConfidence = fcMap(d.fieldConfidence);
    if (lineConf.length) fieldConfidence.lines = Math.min(fieldConfidence.lines ?? 1, round2(lineConf.reduce((a, b) => a + b, 0) / lineConf.length));
    const data: ParsedOffer = {
      supplierName: vStr(d.supplierName), currency: vCur(d.currency), lines, optionUntil: vDate(d.optionUntil), guaranteePax: vInt(d.guaranteePax),
      attritionTerms: vStr(d.attritionTerms), paymentTerms: vStr(d.paymentTerms), prepaymentRate: vRate(d.prepaymentRate),
      cancellationTerms: vStr(d.cancellationTerms), overtimeTerms: vStr(d.overtimeTerms), notes: vStr(d.notes), fieldConfidence,
    };
    const conf = Math.min(offerConfidence(data), clamp01(d.overallConfidence ?? 1));
    return this.result(data, conf, r, 'document_reading');
  }

  async parseContract(input: { text?: string; file?: FileInput; today: string }): Promise<AiResult<ContractFields>> {
    const pii = new Pseudonymizer();
    const r = await this.call<Obj>({
      op: 'parseContract', model: this.model, system: SYSTEM_PARSE_CONTRACT, schema: SCHEMA_CONTRACT, maxTokens: 16000, effort: 'medium',
      content: this.docContent(input, `TODAY: ${input.today}\nRead the contract.`, pii, 'parseContract'),
    });
    const d = pii.restoreDeep(r.data);
    const data: ContractFields = {
      supplierName: vStr(d.supplierName), customerName: vStr(d.customerName), billingInfo: vStr(d.billingInfo),
      startDate: vDate(d.startDate), endDate: vDate(d.endDate), pax: vInt(d.pax), guaranteePax: vInt(d.guaranteePax),
      rooms: asArr(d.rooms).map((x) => { const o = asObj(x); return { type: vStr(o.type) ?? '', count: vNum(o.count) ?? 0, nights: vNum(o.nights) ?? 1, unitPrice: vNum(o.unitPrice) ?? 0 }; }),
      menu: vStr(d.menu), hall: vStr(d.hall),
      unitPrices: asArr(d.unitPrices).map((x) => { const o = asObj(x); return { description: vStr(o.description) ?? '', unitPrice: vNum(o.unitPrice) ?? 0, quantity: vNum(o.quantity) ?? 1 }; }),
      vatSeparated: vBool(d.vatSeparated), accommodationTaxSeparated: vBool(d.accommodationTaxSeparated), currency: vCur(d.currency),
      totalAmount: vNum(d.totalAmount), paymentTerms: vStr(d.paymentTerms), prepaymentRate: vRate(d.prepaymentRate),
      cancellationTerms: vStr(d.cancellationTerms), attritionTerms: vStr(d.attritionTerms), optionDate: vDate(d.optionDate),
    };
    const conf = Math.min(contractConfidence(fcMap(d.fieldConfidence)), clamp01(d.overallConfidence ?? 1));
    return this.result(data, conf, r, 'document_reading');
  }

  async parseInvoice(input: { text?: string; file?: FileInput; today: string }): Promise<AiResult<ParsedInvoice>> {
    const pii = new Pseudonymizer();
    const r = await this.call<Obj>({
      op: 'parseInvoice', model: this.model, system: SYSTEM_PARSE_INVOICE, schema: SCHEMA_INVOICE, maxTokens: 8000, effort: 'medium',
      content: this.docContent(input, `TODAY: ${input.today}\nRead the invoice.`, pii, 'parseInvoice'),
    });
    const d = pii.restoreDeep(r.data);
    const fieldConfidence = fcMap(d.fieldConfidence);
    const data: ParsedInvoice = {
      invoiceNo: vStr(d.invoiceNo), supplierName: vStr(d.supplierName), issueDate: vDate(d.issueDate), dueDate: vDate(d.dueDate),
      currency: vCur(d.currency), netAmount: vNum(d.netAmount), vatAmount: vNum(d.vatAmount), totalAmount: vNum(d.totalAmount),
      lines: asArr(d.lines).map((x) => { const o = asObj(x); return { description: vStr(o.description) ?? '', amount: vNum(o.amount) ?? 0 }; }),
      fieldConfidence,
    };
    // arithmetic cross-check: net + VAT must equal total
    if (data.netAmount !== null && data.vatAmount !== null && data.totalAmount !== null
      && Math.abs(data.netAmount + data.vatAmount - data.totalAmount) > Math.max(0.05, data.totalAmount * 0.002)) {
      for (const k of ['netAmount', 'vatAmount', 'totalAmount']) fieldConfidence[k] = Math.min(fieldConfidence[k] ?? 0.5, 0.5);
    }
    const conf = Math.min(invoiceConfidence(fieldConfidence), clamp01(d.overallConfidence ?? 1));
    return this.result(data, conf, r, 'document_reading');
  }

  async draftMessage(req: DraftRequest): Promise<AiResult<Draft>> {
    const facts = sanitizeDraftFacts(req.kind, req.facts);
    const pii = new Pseudonymizer([req.recipientName, req.senderName, ...collectNamesFromFacts(facts)]);
    const style = (req.styleExamples ?? []).slice(-8).map((s, i) =>
      `<example n="${i + 1}">\n<draft>\n${pii.mask(s.before)}\n</draft>\n<owner_version>\n${pii.mask(s.after)}\n</owner_version>\n</example>`).join('\n');
    const userText = [
      `KIND: ${req.kind}`,
      `LANGUAGE: ${req.language}`,
      `SENDER: ${pii.mask(req.senderName)}`,
      `RECIPIENT: ${req.recipientName ? pii.mask(req.recipientName) : '(unknown — use a neutral greeting)'}`,
      req.kind === 'negotiation' ? `ALLOWED ARGUMENTS: ${JSON.stringify(facts.arguments ?? [])}` : null,
      `FACTS:\n${JSON.stringify(pii.maskDeep(facts), null, 2)}`,
      style ? `OWNER STYLE EXAMPLES:\n${style}` : null,
    ].filter(Boolean).join('\n\n');
    const r = await this.call<Obj>({
      op: 'draftMessage', model: this.model, system: SYSTEM_DRAFT, schema: SCHEMA_DRAFT, maxTokens: 4000, effort: 'medium',
      content: [{ type: 'text', text: userText }],
    });
    const d = pii.restoreDeep(r.data);
    const draft: Draft = { subject: vStr(d.subject), body: vStr(d.body) ?? '' };
    let conf = clamp01(d.confidence ?? 0.85);
    if (!draft.body) conf = 0;
    if (revealsAi(draft.body) || revealsAi(draft.subject ?? '')) conf = Math.min(conf, 0.3);
    if (/\[(EMAIL|PHONE|IBAN|NATID|PERSON)_\d+\]/.test(draft.body)) conf = Math.min(conf, 0.5); // unknown placeholder left
    return this.result(draft, conf, r, draftActionFor(req.kind));
  }

  async ask(ctx: AskContext): Promise<AiResult<AskAnswer>> {
    const pii = new Pseudonymizer(collectNamesFromFacts(ctx.facts));
    const r = await this.call<Obj>({
      op: 'ask', model: this.model, system: SYSTEM_ASK, schema: SCHEMA_ASK, maxTokens: 4000, effort: 'low',
      content: [{ type: 'text', text: `CONTEXT: ${ctx.contextLabel}\n\nFACTS:\n${JSON.stringify(pii.maskDeep(ctx.facts), null, 2)}\n\nQUESTION: ${pii.mask(ctx.question)}` }],
    });
    const d = pii.restoreDeep(r.data);
    const answerable = d.answerable === true;
    const usedFacts = asArr(d.usedFacts).map(String);
    let answer = vStr(d.answer) ?? '';
    if (!answerable || !answer) answer = answer && /veri yok/i.test(answer) ? answer : 'Bu konuda veri yok.';
    return this.result({ answer, usedFacts: answerable ? usedFacts : [] }, answerable ? (usedFacts.length ? 0.85 : 0.6) : 0.9, r, 'draft_generation');
  }

  async interpretCommand(transcript: string, today: string): Promise<AiResult<{ intent: 'create_project' | 'ask' | 'unknown'; requestText?: string; question?: string }>> {
    const pii = new Pseudonymizer();
    const r = await this.call<Obj>({
      op: 'interpretCommand', model: this.fastModel, system: SYSTEM_COMMAND, schema: SCHEMA_COMMAND, maxTokens: 2000, effort: 'low',
      content: [{ type: 'text', text: `TODAY: ${today}\nCOMMAND: ${pii.mask(transcript)}` }],
    });
    const d = pii.restoreDeep(r.data);
    const intent = d.intent === 'create_project' || d.intent === 'ask' ? d.intent : 'unknown';
    const out: { intent: 'create_project' | 'ask' | 'unknown'; requestText?: string; question?: string } = { intent };
    if (intent === 'create_project') out.requestText = vStr(d.requestText) ?? transcript;
    if (intent === 'ask') out.question = vStr(d.question) ?? transcript;
    return this.result(out, clamp01(d.confidence ?? 0.7), r, 'request_extraction');
  }

  async suggestChecklistQuestions(lessons: string, eventType: string | null, existing: string[]): Promise<AiResult<{ question: string; field: string | null }[]>> {
    const pii = new Pseudonymizer();
    const r = await this.call<Obj>({
      op: 'suggestChecklistQuestions', model: this.model, system: SYSTEM_CHECKLIST, schema: SCHEMA_CHECKLIST, maxTokens: 3000, effort: 'low',
      content: [{ type: 'text', text: `EVENT TYPE: ${eventType ?? '(unknown)'}\n\nEXISTING CHECKLIST:\n${existing.map((e) => `- ${e}`).join('\n') || '(empty)'}\n\nLESSONS:\n${pii.mask(lessons)}` }],
    });
    const d = pii.restoreDeep(r.data);
    const qs = asArr(d.questions).map((x) => { const o = asObj(x); return { question: vStr(o.question) ?? '', field: vStr(o.field) }; }).filter((q) => q.question).slice(0, 5);
    return this.result(qs, clamp01(d.confidence ?? 0.7), r, 'checklist_new_question');
  }

  async summarizeStyle(corrections: { before: string; after: string }[], language: Language): Promise<AiResult<{ summary: string }>> {
    const pii = new Pseudonymizer();
    const pairs = corrections.slice(-30).map((c, i) => `<pair n="${i + 1}">\n<draft>\n${pii.mask(c.before)}\n</draft>\n<owner_version>\n${pii.mask(c.after)}\n</owner_version>\n</pair>`).join('\n');
    const r = await this.call<Obj>({
      op: 'summarizeStyle', model: this.model, system: SYSTEM_STYLE, schema: SCHEMA_STYLE, maxTokens: 3000, effort: 'low',
      content: [{ type: 'text', text: `LANGUAGE: ${language}\n\n${pairs || '(no corrections)'}` }],
    });
    const d = pii.restoreDeep(r.data);
    return this.result({ summary: vStr(d.summary) ?? '' }, 0.8, r, 'draft_generation');
  }
}

function mapError(e: unknown, op: string): AiError {
  if (e instanceof AiError) return e;
  const msg = (x: string) => `${op}: ${x}`;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new AiError('auth', msg('authentication / permission error'), { status: e.status, cause: e, operation: op });
  }
  if (e instanceof Anthropic.RateLimitError) return new AiError('rate_limit', msg('rate limited'), { status: 429, cause: e, operation: op });
  if (e instanceof Anthropic.APIConnectionError) return new AiError('network', msg('connection error / timeout'), { cause: e, operation: op });
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError || e instanceof Anthropic.UnprocessableEntityError) {
    return new AiError('bad_request', msg(`request rejected (${e.status})`), { status: e.status, cause: e, operation: op });
  }
  if (e instanceof Anthropic.APIError) {
    const s = typeof e.status === 'number' ? e.status : undefined;
    if (s === 413) return new AiError('bad_request', msg('request too large'), { status: s, cause: e, operation: op });
    if (s !== undefined && s >= 500) return new AiError('overloaded', msg(`upstream error (${s})`), { status: s, cause: e, operation: op });
    return new AiError('unknown', msg(`API error (${s ?? '?'})`), { status: s, cause: e, operation: op });
  }
  return new AiError('unknown', msg(e instanceof Error ? e.message : String(e)), { cause: e, operation: op, retryable: false });
}
