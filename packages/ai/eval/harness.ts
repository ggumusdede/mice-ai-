// §18.9 / §19.3 — belge okuma doğruluğu değerlendirme koşucusu (evaluation harness).
// Runs an AiService over a labelled fixture set and computes per-field accuracy (exact / normalized / numeric tolerance),
// a calibration table (confidence bucket vs observed accuracy, ECE) and a recommended confidence threshold per document
// type for a target precision ("leaked error" = wrong value accepted above the threshold), incl. a Wilson-bound variant.
// Pure scoring functions + one `runEval()` that talks to the AiService. No DB, no network except through the service.
import type { AiResult, AiService, FileInput } from '../src/index.js';
import { fold } from '../src/text.js';

// ------------------------------------------------------------------ fixture format
export type DocType = 'request' | 'offer' | 'contract' | 'invoice';
export const SETS = { requests: 'request', offers: 'offer', contracts: 'contract', invoices: 'invoice' } as const satisfies Record<string, DocType>;
export type SetName = keyof typeof SETS;

export interface EvalFixture {
  id: string;
  docType: DocType;
  language: 'tr' | 'en' | 'ru';
  /** how the document reaches the model: plain text, a text-like file (csv/eml) or a PDF (base64) */
  source: 'text' | 'csv' | 'pdf';
  today: string;
  input: { text?: string; channel?: string; file?: FileInput };
  /** gold labels. Only listed fields are scored; an explicit null means "must be absent". */
  gold: Record<string, unknown>;
  tags?: string[];
  /** provenance (synthetic / exported from tenant corrections) */
  origin?: string;
}

// ------------------------------------------------------------------ field specs
export type Comparator = 'exact' | 'normalized' | 'date' | 'int' | 'money' | 'rate' | 'bool' | 'code';
export type FieldGroup = 'money' | 'quantity' | 'date' | 'code' | 'identity' | 'lines';

export interface FieldSpec { field: string; comparator: Comparator; group: FieldGroup; confidenceKey?: string }

export const FIELD_SPECS: Record<DocType, FieldSpec[]> = {
  request: [
    { field: 'customerName', comparator: 'normalized', group: 'identity' },
    { field: 'startDate', comparator: 'date', group: 'date' },
    { field: 'endDate', comparator: 'date', group: 'date' },
    { field: 'decisionDate', comparator: 'date', group: 'date' },
    { field: 'pax', comparator: 'int', group: 'quantity' },
    { field: 'roomsSgl', comparator: 'int', group: 'quantity' },
    { field: 'roomsDbl', comparator: 'int', group: 'quantity' },
    { field: 'city', comparator: 'normalized', group: 'code' },
    { field: 'district', comparator: 'normalized', group: 'code' },
    { field: 'budget', comparator: 'money', group: 'money' },
    { field: 'budgetCurrency', comparator: 'code', group: 'code' },
    { field: 'language', comparator: 'code', group: 'code' },
  ],
  offer: [
    { field: 'supplierName', comparator: 'normalized', group: 'identity', confidenceKey: 'supplierName' },
    { field: 'currency', comparator: 'code', group: 'code', confidenceKey: 'currency' },
    { field: 'optionUntil', comparator: 'date', group: 'date', confidenceKey: 'optionUntil' },
    { field: 'guaranteePax', comparator: 'int', group: 'quantity', confidenceKey: 'guaranteePax' },
    { field: 'prepaymentRate', comparator: 'rate', group: 'money', confidenceKey: 'prepaymentRate' },
  ],
  contract: [
    { field: 'supplierName', comparator: 'normalized', group: 'identity' },
    { field: 'customerName', comparator: 'normalized', group: 'identity' },
    { field: 'startDate', comparator: 'date', group: 'date' },
    { field: 'endDate', comparator: 'date', group: 'date' },
    { field: 'pax', comparator: 'int', group: 'quantity' },
    { field: 'guaranteePax', comparator: 'int', group: 'quantity' },
    { field: 'currency', comparator: 'code', group: 'code' },
    { field: 'totalAmount', comparator: 'money', group: 'money' },
    { field: 'prepaymentRate', comparator: 'rate', group: 'money' },
    { field: 'vatSeparated', comparator: 'bool', group: 'code' },
  ],
  invoice: [
    { field: 'invoiceNo', comparator: 'exact', group: 'identity', confidenceKey: 'invoiceNo' },
    { field: 'supplierName', comparator: 'normalized', group: 'identity', confidenceKey: 'supplierName' },
    { field: 'issueDate', comparator: 'date', group: 'date', confidenceKey: 'issueDate' },
    { field: 'dueDate', comparator: 'date', group: 'date', confidenceKey: 'dueDate' },
    { field: 'currency', comparator: 'code', group: 'code', confidenceKey: 'currency' },
    { field: 'netAmount', comparator: 'money', group: 'money', confidenceKey: 'netAmount' },
    { field: 'vatAmount', comparator: 'money', group: 'money', confidenceKey: 'vatAmount' },
    { field: 'totalAmount', comparator: 'money', group: 'money', confidenceKey: 'totalAmount' },
  ],
};

/** Line fields (offer lines / contract rooms). Lines are matched gold↔predicted first, then compared field by field. */
const OFFER_LINE_FIELDS: FieldSpec[] = [
  { field: 'kind', comparator: 'code', group: 'code' },
  { field: 'unitPrice', comparator: 'money', group: 'money' },
  { field: 'quantity', comparator: 'int', group: 'quantity' },
  { field: 'nights', comparator: 'int', group: 'quantity' },
  { field: 'roomType', comparator: 'code', group: 'code' },
  { field: 'board', comparator: 'code', group: 'code' },
  { field: 'vatIncluded', comparator: 'bool', group: 'code', confidenceKey: 'vat' },
];
const CONTRACT_ROOM_FIELDS: FieldSpec[] = [
  { field: 'type', comparator: 'code', group: 'code' },
  { field: 'count', comparator: 'int', group: 'quantity' },
  { field: 'nights', comparator: 'int', group: 'quantity' },
  { field: 'unitPrice', comparator: 'money', group: 'money' },
];

// ------------------------------------------------------------------ comparators
/** legal-form and venue-type tokens that do not identify a party (folded, punctuation removed) */
const NOISE_TOKENS = new Set(['a', 's', 'as', 'ltd', 'sti', 'limited', 'inc', 'llc', 'gmbh', 'plc', 'san', 've', 'tic', 'ooo', 'ооо', 'ао', 'зао', 'оао', 'пао',
  'otel', 'hotel', 'отель', 'компания', 'company', 'firma']);
export function normalizeText(v: unknown): string {
  return fold(String(v ?? ''))
    .replace(/[.,;:()"'«»„“”/\\-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !NOISE_TOKENS.has(w))
    .join(' ')
    .trim();
}

const CODE_ALIASES: Record<string, string> = { tl: 'try', '₺': 'try', '€': 'eur', double: 'dbl', single: 'sgl', twin: 'dbl' };
const normCode = (v: unknown) => { const s = fold(String(v ?? '')).trim(); return CODE_ALIASES[s] ?? s; };

export function isAbsent(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

/** true = correct. Absent gold (explicit null) is correct only if the prediction is absent too. */
export function compareValues(comparator: Comparator, gold: unknown, pred: unknown): { correct: boolean; matchKind: 'exact' | 'normalized' | 'tolerance' | 'absent' | 'mismatch' | 'missing' | 'extra' } {
  if (isAbsent(gold)) return isAbsent(pred) ? { correct: true, matchKind: 'absent' } : { correct: false, matchKind: 'extra' };
  if (isAbsent(pred)) return { correct: false, matchKind: 'missing' };
  switch (comparator) {
    case 'exact': return String(gold) === String(pred) ? { correct: true, matchKind: 'exact' } : { correct: false, matchKind: 'mismatch' };
    case 'normalized': {
      if (String(gold) === String(pred)) return { correct: true, matchKind: 'exact' };
      const g = normalizeText(gold), p = normalizeText(pred);
      const ok = !!g && !!p && (g === p || ((g.includes(p) || p.includes(g)) && Math.min(g.length, p.length) / Math.max(g.length, p.length) >= 0.6));
      return ok ? { correct: true, matchKind: 'normalized' } : { correct: false, matchKind: 'mismatch' };
    }
    case 'code': return normCode(gold) === normCode(pred) ? { correct: true, matchKind: 'normalized' } : { correct: false, matchKind: 'mismatch' };
    case 'date': return String(pred).slice(0, 10) === String(gold).slice(0, 10) ? { correct: true, matchKind: 'exact' } : { correct: false, matchKind: 'mismatch' };
    case 'bool': return Boolean(gold) === Boolean(pred) && typeof pred === 'boolean' ? { correct: true, matchKind: 'exact' } : { correct: false, matchKind: 'mismatch' };
    case 'int': return Number(gold) === Number(pred) ? { correct: true, matchKind: 'exact' } : { correct: false, matchKind: 'mismatch' };
    case 'money': {
      const g = Number(gold), p = Number(pred);
      return Number.isFinite(p) && Math.abs(g - p) <= 0.01 ? { correct: true, matchKind: Math.abs(g - p) === 0 ? 'exact' : 'tolerance' } : { correct: false, matchKind: 'mismatch' };
    }
    case 'rate': {
      const g = Number(gold), p = Number(pred);
      return Number.isFinite(p) && Math.abs(g - p) <= 0.0005 ? { correct: true, matchKind: 'tolerance' } : { correct: false, matchKind: 'mismatch' };
    }
  }
}

// ------------------------------------------------------------------ prediction access (field value + its confidence)
export interface Prediction { data: Record<string, unknown>; confidence: number; fieldConfidence: Record<string, number> }

export function toPrediction(docType: DocType, r: AiResult<unknown>): Prediction {
  const d = (r.data ?? {}) as Record<string, unknown>;
  if (docType === 'request') {
    // RequestExtraction: every field is Extracted<T> {value, confidence}; language is plain
    const data: Record<string, unknown> = {};
    const fc: Record<string, number> = {};
    for (const [k, v] of Object.entries(d)) {
      if (v && typeof v === 'object' && 'value' in (v as object)) {
        data[k] = (v as { value: unknown }).value;
        fc[k] = Number((v as { confidence?: number }).confidence ?? 0);
      } else data[k] = v;
    }
    fc.language = r.confidence;
    return { data, confidence: r.confidence, fieldConfidence: fc };
  }
  const fc = (d.fieldConfidence ?? {}) as Record<string, number>;
  return { data: d, confidence: r.confidence, fieldConfidence: fc };
}

function confOf(p: Prediction, spec: FieldSpec): number {
  const k = spec.confidenceKey ?? spec.field;
  const v = p.fieldConfidence[k];
  // contracts (and any doc without per-field confidence) fall back to the overall document confidence
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : Math.max(0, Math.min(1, p.confidence));
}

// ------------------------------------------------------------------ scoring
export interface FieldResult {
  docId: string; docType: DocType; language: string; field: string; group: FieldGroup; comparator: Comparator;
  gold: unknown; pred: unknown; correct: boolean; matchKind: string;
  /** confidence the system attached to this value (0 for a value the model did not produce) */
  confidence: number;
}

/** Greedy best-first matching of gold lines to predicted lines (score = matching fields). Deterministic. */
export function matchLines(gold: Record<string, unknown>[], pred: Record<string, unknown>[], specs: FieldSpec[]): [number, number | null][] {
  const pairs: { g: number; p: number; s: number }[] = [];
  gold.forEach((g, gi) => pred.forEach((p, pi) => {
    let s = 0;
    for (const sp of specs) if (g[sp.field] !== undefined && compareValues(sp.comparator, g[sp.field], p[sp.field]).correct) s += sp.group === 'money' ? 2 : 1;
    pairs.push({ g: gi, p: pi, s });
  }));
  pairs.sort((a, b) => b.s - a.s || a.g - b.g || a.p - b.p);
  const usedG = new Set<number>(), usedP = new Set<number>();
  const out = new Map<number, number | null>();
  for (const x of pairs) {
    if (x.s <= 0 || usedG.has(x.g) || usedP.has(x.p)) continue;
    usedG.add(x.g); usedP.add(x.p); out.set(x.g, x.p);
  }
  return gold.map((_, gi) => [gi, out.get(gi) ?? null]);
}

export function scoreDocument(fx: EvalFixture, p: Prediction): { fields: FieldResult[]; lines: { gold: number; pred: number; matched: number } | null } {
  const out: FieldResult[] = [];
  const base = { docId: fx.id, docType: fx.docType, language: fx.language };
  for (const spec of FIELD_SPECS[fx.docType]) {
    if (!(spec.field in fx.gold)) continue;
    const gold = fx.gold[spec.field];
    const pred = p.data[spec.field];
    const c = compareValues(spec.comparator, gold, pred);
    out.push({ ...base, field: spec.field, group: spec.group, comparator: spec.comparator, gold, pred: pred ?? null, ...c, confidence: isAbsent(pred) ? 0 : confOf(p, spec) });
  }
  const lineKey = fx.docType === 'offer' ? 'lines' : fx.docType === 'contract' ? 'rooms' : null;
  let lines: { gold: number; pred: number; matched: number } | null = null;
  if (lineKey && Array.isArray(fx.gold[lineKey])) {
    const specs = fx.docType === 'offer' ? OFFER_LINE_FIELDS : CONTRACT_ROOM_FIELDS;
    const g = fx.gold[lineKey] as Record<string, unknown>[];
    const pr = (Array.isArray(p.data[lineKey]) ? p.data[lineKey] : []) as Record<string, unknown>[];
    const m = matchLines(g, pr, specs);
    const lineConf = Number.isFinite(p.fieldConfidence.lines) ? p.fieldConfidence.lines : p.confidence;
    for (const [gi, pi] of m) {
      for (const spec of specs) {
        if (g[gi][spec.field] === undefined) continue;
        const pred = pi == null ? null : pr[pi][spec.field];
        const c = pi == null ? { correct: false, matchKind: 'missing' } : compareValues(spec.comparator, g[gi][spec.field], pred);
        const conf = pi == null || isAbsent(pred) ? 0 : spec.confidenceKey && Number.isFinite(p.fieldConfidence[spec.confidenceKey]) ? p.fieldConfidence[spec.confidenceKey] : lineConf;
        out.push({ ...base, field: `${lineKey}[${gi}].${spec.field}`, group: 'lines', comparator: spec.comparator, gold: g[gi][spec.field], pred: pred ?? null, ...c, confidence: conf });
      }
    }
    // extra predicted lines are wrong values the system would otherwise accept at its line confidence (leak risk)
    const matchedP = new Set(m.map(([, pi]) => pi).filter((x): x is number => x != null));
    pr.forEach((line, pi) => {
      if (matchedP.has(pi)) return;
      out.push({ ...base, field: `${lineKey}[+${pi}]`, group: 'lines', comparator: 'exact', gold: null, pred: line.description ?? line.type ?? 'line', correct: false, matchKind: 'extra', confidence: lineConf });
    });
    lines = { gold: g.length, pred: pr.length, matched: matchedP.size };
  }
  return { fields: out, lines };
}

// ------------------------------------------------------------------ metrics
export function wilson(successes: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: Math.max(0, (c - r) / d), high: Math.min(1, (c + r) / d) };
}

export const CALIBRATION_BUCKETS: [number, number][] = [[0, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.85], [0.85, 0.9], [0.9, 0.95], [0.95, 1.0001]];
export interface CalibrationRow { bucket: string; from: number; to: number; n: number; meanConfidence: number | null; accuracy: number | null; gap: number | null }

export function calibration(rs: FieldResult[]): { rows: CalibrationRow[]; ece: number } {
  const rows: CalibrationRow[] = CALIBRATION_BUCKETS.map(([from, to]) => {
    const b = rs.filter((r) => r.confidence >= from && r.confidence < to);
    const mc = b.length ? b.reduce((s, r) => s + r.confidence, 0) / b.length : null;
    const acc = b.length ? b.filter((r) => r.correct).length / b.length : null;
    return { bucket: `${from.toFixed(2)}–${Math.min(1, to).toFixed(2)}`, from, to: Math.min(1, to), n: b.length, meanConfidence: mc == null ? null : r4(mc), accuracy: acc == null ? null : r4(acc), gap: mc == null || acc == null ? null : r4(mc - acc) };
  });
  const n = rs.length || 1;
  const ece = rows.reduce((s, r) => s + (r.n && r.gap != null ? (r.n / n) * Math.abs(r.gap) : 0), 0);
  return { rows, ece: r4(ece) };
}

export interface ThresholdRecommendation {
  docType: DocType;
  targetPrecision: number;
  n: number;
  /** lowest τ with precision(conf ≥ τ) ≥ target (point estimate); null = no τ reaches it → everything to a human */
  threshold: number | null;
  precisionAtThreshold: number | null;
  /** share of fields accepted without a human at τ */
  coverageAtThreshold: number | null;
  /** lowest τ whose Wilson upper bound of the error rate ≤ 1 − target (small samples); null = not reachable with this data */
  thresholdWilson: number | null;
  coverageAtWilson: number | null;
  /** fields wrong but confident ≥ current default 0.8 (would leak today) */
  leaksAtDefault: number;
  note: string;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function recommendThreshold(docType: DocType, rs: FieldResult[], target: number, defaultThreshold = 0.8): ThresholdRecommendation {
  const n = rs.length;
  const taus = [...new Set(rs.map((r) => r.confidence).filter((c) => c > 0))].sort((a, b) => a - b);
  let threshold: number | null = null, prec: number | null = null, cov: number | null = null, tw: number | null = null, covW: number | null = null;
  for (const tau of taus) {
    const acc = rs.filter((r) => r.confidence >= tau);
    if (!acc.length) continue;
    const ok = acc.filter((r) => r.correct).length;
    const p = ok / acc.length;
    if (threshold == null && p >= target) { threshold = tau; prec = r4(p); cov = r4(acc.length / n); }
    if (tw == null && wilson(acc.length - ok, acc.length).high <= 1 - target) { tw = tau; covW = r4(acc.length / n); }
  }
  const leaks = rs.filter((r) => !r.correct && r.confidence >= defaultThreshold).length;
  const note = threshold == null
    ? `Hiçbir eşik %${Math.round(target * 100)} kesinliğe ulaşmıyor — bu belge türünde tüm alanlar insana gitmeli (istem / ön işleme iyileştirilmeli, eşik gevşetilmez).`
    : tw == null
      ? `Nokta tahmini τ=${threshold}; Wilson üst sınırıyla hedef bu örnek sayısında (${n}) kanıtlanamıyor — daha fazla etiketli örnek gerekli.`
      : `Önerilen eşik τ=${tw} (Wilson, küçük örneklemde güvenli taraf); nokta tahmini τ=${threshold}.`;
  return { docType, targetPrecision: target, n, threshold, precisionAtThreshold: prec, coverageAtThreshold: cov, thresholdWilson: tw, coverageAtWilson: covW, leaksAtDefault: leaks, note };
}

export interface FieldAccuracy { field: string; n: number; correct: number; accuracy: number; meanConfidence: number }
function perField(rs: FieldResult[], key: (r: FieldResult) => string): FieldAccuracy[] {
  const m = new Map<string, FieldResult[]>();
  for (const r of rs) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(r);
  return [...m.entries()].map(([field, xs]) => ({
    field, n: xs.length, correct: xs.filter((x) => x.correct).length, accuracy: r4(xs.filter((x) => x.correct).length / xs.length),
    meanConfidence: r4(xs.reduce((s, x) => s + x.confidence, 0) / xs.length),
  })).sort((a, b) => a.field.localeCompare(b.field));
}

export interface EvalReport {
  version: 1;
  provider: string;
  model: string | null;
  sets: SetName[];
  generatedAt: string;
  targetPrecision: number;
  documents: number;
  fieldsScored: number;
  overall: { accuracy: number; ece: number };
  byDocType: Record<string, {
    documents: number; fields: number; accuracy: number; ece: number;
    perField: FieldAccuracy[]; perGroup: FieldAccuracy[];
    lineF1: number | null;
    calibration: CalibrationRow[];
    threshold: ThresholdRecommendation;
  }>;
  byLanguage: FieldAccuracy[];
  errors: { docId: string; field: string; gold: unknown; pred: unknown; confidence: number; matchKind: string }[];
  failures: { docId: string; error: string }[];
}

// ------------------------------------------------------------------ run
export async function predict(ai: AiService, fx: EvalFixture): Promise<AiResult<unknown>> {
  const { text, file } = fx.input;
  switch (fx.docType) {
    case 'request': return ai.extractRequest(text ?? '', { channel: fx.input.channel ?? 'email', today: fx.today });
    case 'offer': return ai.parseSupplierOffer({ text, file, today: fx.today });
    case 'contract': return ai.parseContract({ text, file, today: fx.today });
    case 'invoice': return ai.parseInvoice({ text, file, today: fx.today });
  }
}

export async function runEval(ai: AiService, fixtures: EvalFixture[], opts: { target?: number; sets: SetName[]; now?: Date; concurrency?: number }): Promise<EvalReport> {
  const target = opts.target ?? 0.95;
  const all: FieldResult[] = [];
  const lineStats = new Map<DocType, { gold: number; pred: number; matched: number }>();
  const failures: EvalReport['failures'] = [];
  const docsByType = new Map<DocType, number>();
  let model: string | null = null;
  const queue = [...fixtures];
  const worker = async () => {
    for (let fx = queue.shift(); fx; fx = queue.shift()) {
      try {
        const r = await predict(ai, fx);
        model ??= r.model;
        const s = scoreDocument(fx, toPrediction(fx.docType, r));
        all.push(...s.fields);
        if (s.lines) {
          const l = lineStats.get(fx.docType) ?? { gold: 0, pred: 0, matched: 0 };
          lineStats.set(fx.docType, { gold: l.gold + s.lines.gold, pred: l.pred + s.lines.pred, matched: l.matched + s.lines.matched });
        }
        docsByType.set(fx.docType, (docsByType.get(fx.docType) ?? 0) + 1);
      } catch (e) {
        failures.push({ docId: fx.id, error: (e as Error).message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 1) }, worker));
  all.sort((a, b) => a.docId.localeCompare(b.docId) || a.field.localeCompare(b.field));
  const byDocType: EvalReport['byDocType'] = {};
  for (const dt of [...new Set(fixtures.map((f) => f.docType))]) {
    const rs = all.filter((r) => r.docType === dt);
    const ls = lineStats.get(dt);
    const lp = ls && ls.pred ? ls.matched / ls.pred : null;
    const lr = ls && ls.gold ? ls.matched / ls.gold : null;
    const cal = calibration(rs);
    byDocType[dt] = {
      documents: docsByType.get(dt) ?? 0, fields: rs.length, accuracy: rs.length ? r4(rs.filter((r) => r.correct).length / rs.length) : 0, ece: cal.ece,
      perField: perField(rs, (r) => r.field.replace(/\[\+?\d+\]/, '[]')), perGroup: perField(rs, (r) => r.group),
      lineF1: lp != null && lr != null && lp + lr > 0 ? r4((2 * lp * lr) / (lp + lr)) : ls ? 0 : null,
      calibration: cal.rows, threshold: recommendThreshold(dt, rs, target),
    };
  }
  return {
    version: 1, provider: ai.name, model, sets: opts.sets, generatedAt: (opts.now ?? new Date()).toISOString(), targetPrecision: target,
    documents: fixtures.length - failures.length, fieldsScored: all.length,
    overall: { accuracy: all.length ? r4(all.filter((r) => r.correct).length / all.length) : 0, ece: calibration(all).ece },
    byDocType, byLanguage: perField(all, (r) => r.language),
    errors: all.filter((r) => !r.correct).map((r) => ({ docId: r.docId, field: r.field, gold: r.gold, pred: r.pred, confidence: r4(r.confidence), matchKind: r.matchKind })),
    failures,
  };
}

// ------------------------------------------------------------------ markdown
const pct = (v: number | null | undefined) => (v == null ? '—' : `%${(v * 100).toFixed(1)}`);
const cell = (v: unknown) => (v === null || v === undefined ? '—' : String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/\|/g, '\\|').slice(0, 60));

export function renderMarkdown(r: EvalReport): string {
  const L: string[] = [];
  L.push(`# Belge okuma doğruluk raporu — ${r.provider}${r.model ? ` (${r.model})` : ''}`, '');
  L.push(`Üretim: ${r.generatedAt} · Setler: ${r.sets.join(', ')} · Belge: ${r.documents} · Skorlanan alan: ${r.fieldsScored} · Hedef kesinlik: ${pct(r.targetPrecision)}`, '');
  L.push(`**Genel ham doğruluk:** ${pct(r.overall.accuracy)} · **ECE:** ${r.overall.ece}`, '');
  L.push('> Ham doğruluk insan doğrulama yükünü, eşik üstü kesinlik (1 − sızan hata) iş riskini gösterir (docs/04 §1). Sentetik set küçük ve yönlendiricidir; eşikler gerçek etiketli set ile yeniden hesaplanmalıdır.', '');
  L.push('## Eşik önerileri', '', '| Belge türü | n alan | τ (nokta) | Kesinlik | Kapsama | τ (Wilson) | Kapsama | 0,8 üstü hata | Not |', '|---|---|---|---|---|---|---|---|---|');
  for (const [dt, d] of Object.entries(r.byDocType)) {
    const t = d.threshold;
    L.push(`| ${dt} | ${t.n} | ${t.threshold ?? '—'} | ${pct(t.precisionAtThreshold)} | ${pct(t.coverageAtThreshold)} | ${t.thresholdWilson ?? '—'} | ${pct(t.coverageAtWilson)} | ${t.leaksAtDefault} | ${t.note} |`);
  }
  for (const [dt, d] of Object.entries(r.byDocType)) {
    L.push('', `## ${dt} — ${d.documents} belge, ${d.fields} alan, doğruluk ${pct(d.accuracy)}, ECE ${d.ece}${d.lineF1 != null ? `, satır F1 ${d.lineF1}` : ''}`, '');
    L.push('| Alan | n | Doğru | Doğruluk | Ort. güven |', '|---|---|---|---|---|');
    for (const f of d.perField) L.push(`| ${f.field} | ${f.n} | ${f.correct} | ${pct(f.accuracy)} | ${f.meanConfidence} |`);
    L.push('', '| Alan grubu | n | Doğruluk |', '|---|---|---|');
    for (const f of d.perGroup) L.push(`| ${f.field} | ${f.n} | ${pct(f.accuracy)} |`);
    L.push('', '**Kalibrasyon** (güven aralığı → gözlenen doğruluk)', '', '| Güven | n | Ort. güven | Doğruluk | Fark |', '|---|---|---|---|---|');
    for (const c of d.calibration) L.push(`| ${c.bucket} | ${c.n} | ${c.meanConfidence ?? '—'} | ${pct(c.accuracy)} | ${c.gap ?? '—'} |`);
  }
  L.push('', '## Dil bazında', '', '| Dil | n | Doğruluk |', '|---|---|---|');
  for (const f of r.byLanguage) L.push(`| ${f.field} | ${f.n} | ${pct(f.accuracy)} |`);
  L.push('', `## Hatalar (${r.errors.length})`, '', '| Belge | Alan | Altın | Tahmin | Güven | Tür |', '|---|---|---|---|---|---|');
  for (const e of r.errors.slice(0, 200)) L.push(`| ${e.docId} | ${e.field} | ${cell(e.gold)} | ${cell(e.pred)} | ${e.confidence} | ${e.matchKind} |`);
  if (r.failures.length) {
    L.push('', '## Çalışmayan belgeler', '');
    for (const f of r.failures) L.push(`- ${f.docId}: ${f.error}`);
  }
  return L.join('\n') + '\n';
}
