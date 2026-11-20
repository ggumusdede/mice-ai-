// @mice/ai — LLM access layer. CONTRACT: the AiService interface below is FIXED (apps/api codes against it).
// Two implementations: ClaudeAiService (Anthropic API, when ANTHROPIC_API_KEY is set) and MockAiService
// (deterministic heuristics, used in tests/dev without a key). Every output carries a confidence score (§6).
// The layer enforces the §6 closed authority list: it only PRODUCES drafts/extractions; it never sends,
// pays, signs, accredits or changes rules. PII is pseudonymized before leaving the process (§18.2).
import type {
  ContractFields, Language, OfferLine, RequestExtraction, Currency, AiActionType,
} from '@mice/shared';

export interface AiResult<T> {
  data: T; confidence: number; model: string; action: AiActionType;
  /** input = uncached input tokens; cacheRead/cacheWrite (additive) = prompt-cache read/creation tokens */
  tokens?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
}

export interface FileInput { filename: string; mimeType: string; base64: string }

export interface ParsedOffer {
  supplierName: string | null;
  currency: Currency | null;
  lines: OfferLine[];
  optionUntil: string | null;
  guaranteePax: number | null;
  attritionTerms: string | null;
  paymentTerms: string | null;
  prepaymentRate: number | null;
  cancellationTerms: string | null;
  overtimeTerms: string | null;
  notes: string | null;
  fieldConfidence: Record<string, number>;
}

export interface ParsedInvoice { invoiceNo: string | null; supplierName: string | null; issueDate: string | null; dueDate: string | null; currency: Currency | null; netAmount: number | null; vatAmount: number | null; totalAmount: number | null; lines: { description: string; amount: number }[]; fieldConfidence: Record<string, number> }

export interface DraftRequest {
  kind: 'missing_info' | 'rfq' | 'rfq_reminder' | 'negotiation' | 'quote_cover' | 'quote_followup' | 'option_extension' | 'revision_request' | 'supplier_confirmation' | 'daily_summary' | 'other';
  language: Language;
  /** agency owner's style examples (learned from corrections, §15 üslup öğrenme) */
  styleExamples?: { before: string; after: string }[];
  senderName: string;
  recipientName?: string | null;
  facts: Record<string, unknown>;
}
export interface Draft { subject: string | null; body: string }

export interface AskContext { question: string; contextLabel: string; facts: Record<string, unknown> }
export interface AskAnswer { answer: string; usedFacts: string[] }

export interface AiService {
  readonly name: string;
  /** §7 Adım 0 */
  extractRequest(text: string, opts: { channel: string; today: string; knownCustomers?: string[] }): Promise<AiResult<RequestExtraction>>;
  /** §7 Adım 1 yanıt okuma: mail text / PDF / Excel (as CSV text) / image */
  parseSupplierOffer(input: { text?: string; file?: FileInput; itemKind?: string; today: string }): Promise<AiResult<ParsedOffer>>;
  /** §7 Adım 5 sözleşme okuma */
  parseContract(input: { text?: string; file?: FileInput; today: string }): Promise<AiResult<ContractFields>>;
  /** §7 Adım 7 fatura okuma */
  parseInvoice(input: { text?: string; file?: FileInput; today: string }): Promise<AiResult<ParsedInvoice>>;
  /** Short, clear drafts in the owner's style (§3.3, §3.4). Never sent by AI. */
  draftMessage(req: DraftRequest): Promise<AiResult<Draft>>;
  /** "Bu projeye sor" contextual Q&A (§15) — answers only from given facts; says "veri yok" otherwise (§3.7). */
  ask(ctx: AskContext): Promise<AiResult<AskAnswer>>;
  /** Voice command → intent (§15 ses) */
  interpretCommand(transcript: string, today: string): Promise<AiResult<{ intent: 'create_project' | 'ask' | 'unknown'; requestText?: string; question?: string }>>;
  /** §8 "Bu projede neyi geç öğrendik?" → checklist question suggestions */
  suggestChecklistQuestions(lessons: string, eventType: string | null, existing: string[]): Promise<AiResult<{ question: string; field: string | null }[]>>;
  /** Monthly style summary (§15 üslup öğrenme) */
  summarizeStyle(corrections: { before: string; after: string }[], language: Language): Promise<AiResult<{ summary: string }>>;
}

export { createAiService } from './factory.js';
export { MockAiService } from './mock.js';
export { ClaudeAiService, DEFAULT_MODEL, DEFAULT_FAST_MODEL, type AnthropicLike, type ClaudeAiServiceOptions } from './claude.js';
export { AiError, type AiErrorCode } from './errors.js';
export { assertAiMayPerform, aiMayPerform, draftActionFor, AiAuthorityError } from './authority.js';
export { Pseudonymizer, maskPii, restorePii, collectNamesFromFacts, type PseudonymMapping } from './pii.js';
export { budgetIsPerPerson, requestExtractionConfidence, offerConfidence, contractConfidence, invoiceConfidence } from './heuristics.js';
export { NEGOTIATION_ARGUMENTS, type NegotiationArgument, sanitizeDraftFacts } from './drafts.js';
