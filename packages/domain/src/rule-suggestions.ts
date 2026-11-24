// §16.5 Kural önerisi üreticisi — pure, deterministic. From closed-loop data (channel advantages, admin markup edits,
// RFQ response times, margin overrides, customer decision times) it PROPOSES evidence-backed rule changes.
// It never changes anything: every suggestion becomes an admin-only 'rule_suggestion' decision (§6 rule_change is forbidden
// for AI; the DB rules_change_guard refuses AI actors). Every suggestion carries its data points (evidence rows), sample size,
// confidence and a Turkish rationale. Forbidden / authority / legal settings are never suggested (NEVER_SUGGESTED_RULE_KEYS).
import type { MarkupTier, SupplierRfqHours, SupplierSeasonMarkup, TenantRules } from '@mice/shared';
import { businessMinutesBetween, businessMinutesPerDay } from './business-time.js';
import { markupForAdvantage } from './pricing.js';
import { monthOf } from './scoped-rules.js';

/** Only these keys can ever be the target of a generated suggestion. */
export const SUGGESTABLE_RULE_KEYS = [
  'markupTiers', 'supplierSeasonMarkups', 'rfqReminderHours', 'rfqCallTaskHours', 'supplierRfqHours', 'targetMarginMin', 'customerOptionBusinessDays',
] as const satisfies readonly (keyof TenantRules)[];
export type SuggestableRuleKey = (typeof SUGGESTABLE_RULE_KEYS)[number];

/** §6 / §17: authority, automation, AI-risk, legal and money-limit settings are never proposed by the generator. */
export const NEVER_SUGGESTED_RULE_KEYS: readonly (keyof TenantRules)[] = [
  'automationPromotionThreshold', 'automationSampleRate', 'aiConfidenceThreshold', 'fieldExtraPerItemLimitTry', 'fieldExtraPerProjectLimitTry',
  'guestDataRetentionDays', 'vatRates', 'accommodationTaxRate', 'projectCodePrefix', 'businessHours', 'unbilledPaymentEscalationDays',
  'closingDeadlineDays', 'lowSupplierScore', 'rfqMinSuppliers', 'rfqMaxSuppliers', 'maxNegotiationRounds',
];

export function isSuggestableRuleKey(k: string): k is SuggestableRuleKey {
  return (SUGGESTABLE_RULE_KEYS as readonly string[]).includes(k) && !(NEVER_SUGGESTED_RULE_KEYS as readonly string[]).includes(k);
}

export type RuleSuggestionKind =
  | 'supplier_season_markup' | 'markup_tier' | 'rfq_hours' | 'supplier_rfq_hours' | 'target_margin' | 'customer_option_days';

export type RuleSuggestionPatch =
  /** set one or more top-level keys (applied only if the keys still hold `currentValue`) */
  | { op: 'set'; values: Partial<Pick<TenantRules, SuggestableRuleKey>> }
  /** insert / replace one entry of a scoped override list, matched by supplierId (and months for season markups) */
  | { op: 'upsert_supplier_season_markup'; entry: SupplierSeasonMarkup }
  | { op: 'upsert_supplier_rfq_hours'; entry: SupplierRfqHours };

export interface EvidenceColumn {
  key: string;
  label: string;
  format?: 'pct' | 'eur' | 'date' | 'hours' | 'days' | 'number' | 'text';
}
export interface RuleSuggestionEvidence {
  columns: EvidenceColumn[];
  rows: Record<string, string | number | boolean | null>[];
  /** rows dropped from `rows` because of the display cap (all are counted in sampleSize) */
  truncated: number;
  summary: Record<string, string | number | null>;
}

export interface RuleSuggestion {
  kind: RuleSuggestionKind;
  /** primary rule key (TenantRules) */
  key: SuggestableRuleKey;
  scope: { supplierId?: string; supplierName?: string; months?: number[]; tierIndex?: number } | null;
  /** current value(s) of the affected key(s) — for 'set' the effect refuses to apply when rules changed meanwhile */
  currentValue: unknown;
  /** the new full value of `key` if applied to the current rules */
  proposedValue: unknown;
  patch: RuleSuggestionPatch;
  /** stable identity of "the same suggestion" (dedup across weekly runs) */
  fingerprint: string;
  confidence: number;
  sampleSize: number;
  /** one line (decision summary) */
  title: string;
  /** Turkish explanation incl. the numbers */
  rationale: string;
  evidence: RuleSuggestionEvidence;
}

// ------------------------------------------------------------------ input
export interface AdvantageObservation {
  supplierId: string;
  supplierName: string;
  /** service (stay) date, ISO */
  date: string;
  /** channel advantage as fraction (0.18 = 18%) */
  advantage: number;
  ref?: string | null;
  roomType?: string | null;
}
export interface MarkupObservation {
  /** advantage at quote time (null = unknown price class) */
  advantage: number | null;
  /** markup the tier table suggested */
  suggestedMarkup: number;
  /** markup the human finally applied (approved / sent quote) */
  appliedMarkup: number;
  date: string;
  ref?: string | null;
}
export interface RfqResponseObservation {
  supplierId: string;
  supplierName: string;
  sentAt: string;
  /** first offer received; null = no response (yet) */
  respondedAt: string | null;
  ref?: string | null;
}
export interface MarginOverrideObservation {
  date: string;
  /** lowest option margin of the overridden quote (Kâr ÷ Satış) */
  margin: number;
  approved: boolean;
  outcome?: 'won' | 'lost' | 'open' | null;
  ref?: string | null;
}
export interface QuoteDecisionObservation {
  sentAt: string;
  /** customer accepted / rejected at; null when still open or expired */
  decidedAt: string | null;
  outcome: 'accepted' | 'rejected' | 'expired' | 'open';
  ref?: string | null;
}

export interface RuleSuggestionOptions {
  /** minimum data points for any suggestion */
  minSample: number;
  /** supplier × season: minimum points inside the season window */
  minSeasonSample: number;
  /** supplier × season: minimum lift of the window mean over the supplier's other months (when ≥ 3 other points exist) */
  minSeasonLift: number;
  /** markup edits: share of observations edited in the same direction */
  minEditConsistency: number;
  /** RFQ: relative difference |p75 − current| / current to call it "strong" */
  minRfqRelativeGap: number;
  /** cap of evidence rows rendered on the card */
  maxEvidenceRows: number;
}
export const DEFAULT_RULE_SUGGESTION_OPTIONS: RuleSuggestionOptions = {
  minSample: 8, minSeasonSample: 6, minSeasonLift: 0.05, minEditConsistency: 0.8, minRfqRelativeGap: 0.5, maxEvidenceRows: 40,
};

export interface RuleSuggestionInput {
  rules: TenantRules;
  advantages?: AdvantageObservation[];
  markupEdits?: MarkupObservation[];
  rfqResponses?: RfqResponseObservation[];
  marginOverrides?: MarginOverrideObservation[];
  quoteDecisions?: QuoteDecisionObservation[];
  options?: Partial<RuleSuggestionOptions>;
}

// ------------------------------------------------------------------ helpers
export const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

export function monthRangeLabel(months: number[]): string {
  if (!months.length) return '';
  if (months.length === 1) return TR_MONTHS[months[0] - 1];
  return `${TR_MONTHS[months[0] - 1]}–${TR_MONTHS[months[months.length - 1] - 1]}`;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pctTxt = (n: number) => `%${Math.round(n * 1000) / 10}`;
/** round a fraction to 0.5 percentage points */
const halfPp = (n: number) => Math.round(n * 200) / 200;
const roundUpTo = (n: number, step: number) => Math.ceil(n / step) * step;

/** Linear-interpolated quantile (q in 0..1) of a non-empty list. */
export function quantile(values: number[], q: number): number {
  const v = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

/** Confidence from sample size and consistency (both 0..1 saturating). Deterministic and conservative (≤ 0.95). */
export function suggestionConfidence(n: number, minSample: number, consistency: number): number {
  const size = Math.min(1, n / (minSample * 2.5));
  return r2(Math.max(0, Math.min(0.95, 0.35 + 0.3 * size + 0.3 * Math.max(0, Math.min(1, consistency)))));
}

function evidence(columns: EvidenceColumn[], rows: RuleSuggestionEvidence['rows'], cap: number, summary: RuleSuggestionEvidence['summary']): RuleSuggestionEvidence {
  return { columns, rows: rows.slice(0, cap), truncated: Math.max(0, rows.length - cap), summary };
}

const hoursBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;

/** Contiguous month windows of length 1..maxLen, wrapping December → January. */
function monthWindows(maxLen: number): number[][] {
  const out: number[][] = [];
  for (let len = 1; len <= maxLen; len++) {
    for (let start = 1; start <= 12; start++) out.push(Array.from({ length: len }, (_, i) => ((start - 1 + i) % 12) + 1));
  }
  return out;
}

// ------------------------------------------------------------------ (a) supplier × season advantage → seasonal markup
function supplierSeasonSuggestions(input: RuleSuggestionInput, o: RuleSuggestionOptions): RuleSuggestion[] {
  const { rules } = input;
  const bySupplier = new Map<string, AdvantageObservation[]>();
  for (const a of input.advantages ?? []) {
    if (!Number.isFinite(a.advantage) || monthOf(a.date) == null) continue;
    (bySupplier.get(a.supplierId) ?? bySupplier.set(a.supplierId, []).get(a.supplierId)!).push(a);
  }
  const lowest = markupForAdvantage(Number.NEGATIVE_INFINITY, rules.markupTiers);
  const out: RuleSuggestion[] = [];
  for (const [supplierId, obs] of bySupplier) {
    if (obs.length < o.minSeasonSample) continue;
    let best: { months: number[]; inside: AdvantageObservation[]; outside: AdvantageObservation[]; markup: number; p25: number; meanIn: number; meanOut: number | null; score: number } | null = null;
    for (const months of monthWindows(3)) {
      const inside = obs.filter((x) => months.includes(monthOf(x.date)!));
      if (inside.length < o.minSeasonSample) continue;
      const outside = obs.filter((x) => !months.includes(monthOf(x.date)!));
      const advIn = inside.map((x) => x.advantage);
      const meanIn = mean(advIn);
      const meanOut = outside.length >= 3 ? mean(outside.map((x) => x.advantage)) : null;
      if (meanOut != null && meanIn - meanOut < o.minSeasonLift) continue;
      // conservative: the tier reached by the 25th percentile — most data points support at least this markup
      const p25 = quantile(advIn, 0.25);
      const markup = markupForAdvantage(p25, rules.markupTiers);
      if (markup <= lowest + 1e-9) continue;
      // prefer the higher supported markup, then more data, then the shorter window
      const score = markup * 1000 + inside.length - months.length * 0.01;
      if (!best || score > best.score) best = { months, inside, outside, markup, p25, meanIn, meanOut, score };
    }
    if (!best) continue;
    // windows are ≤ 3 months; with ≥ 3 points outside the window the lift over other months is required (minSeasonLift)
    const name = obs[0].supplierName;
    const existing = rules.supplierSeasonMarkups?.find((x) => x.supplierId === supplierId && sameMonths(x.months, best!.months)) ?? null;
    if (existing && Math.abs(existing.markup - best.markup) < 1e-9) continue;
    const consistency = best.inside.filter((x) => markupForAdvantage(x.advantage, rules.markupTiers) >= best!.markup - 1e-9).length / best.inside.length;
    const entry: SupplierSeasonMarkup = {
      supplierId, supplierName: name, months: best.months, markup: best.markup,
      note: `${monthRangeLabel(best.months)} ortalama avantaj ${pctTxt(best.meanIn)} (${best.inside.length} veri)`,
    };
    const others = (rules.supplierSeasonMarkups ?? []).filter((x) => !(x.supplierId === supplierId && sameMonths(x.months, best!.months)));
    const label = monthRangeLabel(best.months);
    const contrast = best.meanOut != null ? `; diğer aylarda ortalama ${pctTxt(best.meanOut)} (${best.outside.length} veri)` : '';
    out.push({
      kind: 'supplier_season_markup', key: 'supplierSeasonMarkups',
      scope: { supplierId, supplierName: name, months: best.months },
      currentValue: existing, proposedValue: [...others, entry],
      patch: { op: 'upsert_supplier_season_markup', entry },
      fingerprint: `supplier_season_markup:${supplierId}:${best.months.join('-')}:${r4(best.markup)}`,
      confidence: suggestionConfidence(best.inside.length, o.minSeasonSample, consistency),
      sampleSize: best.inside.length,
      title: `${name} ${label}'ta ortalama ${pctTxt(best.meanIn)} avantaj veriyor — bu dönem marj kademesini ${pctTxt(lowest)}'ten ${pctTxt(best.markup)}'e yükselteyim mi?`,
      rationale:
        `${name} için ${label} döneminde ${best.inside.length} kanal fiyatı karşılaştırması var: ortalama avantaj ${pctTxt(best.meanIn)}, ` +
        `alt çeyrek ${pctTxt(best.p25)}${contrast}. Kanal fiyatı girilemeyen (fiyat sınıfı "bilmiyorum") tekliflerde bugün en düşük kademe ` +
        `(${pctTxt(lowest)}) öneriliyor; bu kural onaylanırsa bu tedarikçi + dönem için ${pctTxt(best.markup)} önerilir. ` +
        `Kanal fiyatı olan tekliflerde kademe tablosu aynen geçerli kalır. Veri noktalarının %${Math.round(consistency * 100)}'i bu kademeyi destekliyor.`,
      evidence: evidence(
        [{ key: 'date', label: 'Tarih', format: 'date' }, { key: 'ref', label: 'Proje', format: 'text' }, { key: 'roomType', label: 'Oda', format: 'text' }, { key: 'advantage', label: 'Kanal avantajı', format: 'pct' }],
        [...best.inside].sort((a, b) => a.date.localeCompare(b.date)).map((x) => ({ date: x.date.slice(0, 10), ref: x.ref ?? null, roomType: x.roomType ?? null, advantage: r4(x.advantage) })),
        o.maxEvidenceRows,
        { supplier: name, period: label, meanAdvantage: r4(best.meanIn), p25Advantage: r4(best.p25), otherMonthsMeanAdvantage: best.meanOut == null ? null : r4(best.meanOut), currentMarkup: lowest, proposedMarkup: best.markup },
      ),
    });
  }
  return out;
}

function sameMonths(a: number[], b: number[]): boolean {
  return a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);
}

// ------------------------------------------------------------------ (b) markup tiers from consistent human edits
function markupTierSuggestions(input: RuleSuggestionInput, o: RuleSuggestionOptions): RuleSuggestion[] {
  const tiers = [...input.rules.markupTiers].sort((a, b) => a.minAdvantage - b.minAdvantage);
  if (!tiers.length) return [];
  const obs = (input.markupEdits ?? []).filter((x) => x.advantage != null && Number.isFinite(x.advantage) && Number.isFinite(x.appliedMarkup) && Number.isFinite(x.suggestedMarkup));
  const out: RuleSuggestion[] = [];
  for (let i = 0; i < tiers.length; i++) {
    const lo = tiers[i].minAdvantage;
    const hi = tiers[i + 1]?.minAdvantage ?? Number.POSITIVE_INFINITY;
    const inTier = obs.filter((x) => (i === 0 ? true : x.advantage! >= lo - 1e-9) && x.advantage! < hi - 1e-9 && Math.abs(x.suggestedMarkup - tiers[i].markup) < 1e-6);
    if (inTier.length < o.minSample) continue;
    const deltas = inTier.map((x) => x.appliedMarkup - x.suggestedMarkup);
    const up = deltas.filter((d) => d > 0.0049).length;
    const down = deltas.filter((d) => d < -0.0049).length;
    const dir = up >= down ? 1 : -1;
    const consistency = (dir > 0 ? up : down) / inTier.length;
    if (consistency < o.minEditConsistency) continue;
    const medDelta = quantile(deltas, 0.5);
    const target = halfPp(tiers[i].markup + medDelta);
    if (Math.abs(target - tiers[i].markup) < 0.0049) continue;
    const next = tiers[i + 1];
    const prev = tiers[i - 1];
    let newTiers: MarkupTier[];
    let what: string;
    if (dir > 0 && next && target >= next.markup - 0.0049) {
      // people apply (at least) the next tier's markup → move the NEXT tier's boundary down to where the data starts
      const boundary = halfPp(quantile(inTier.map((x) => x.advantage!), 0.25));
      if (!(boundary > lo + 0.0049 && boundary < next.minAdvantage - 0.0049)) continue;
      newTiers = tiers.map((t, j) => (j === i + 1 ? { ...t, minAdvantage: boundary } : { ...t }));
      what = `${pctTxt(next.markup)} kademesinin alt sınırını ${pctTxt(next.minAdvantage)}'ten ${pctTxt(boundary)}'e indireyim mi?`;
    } else if (dir < 0 && prev && target <= prev.markup + 0.0049) {
      // people apply (at most) the previous tier's markup → move THIS tier's boundary up
      const boundary = halfPp(quantile(inTier.map((x) => x.advantage!), 0.75));
      if (!(boundary > lo + 0.0049 && boundary < hi - 0.0049)) continue;
      newTiers = tiers.map((t, j) => (j === i ? { ...t, minAdvantage: boundary } : { ...t }));
      what = `${pctTxt(tiers[i].markup)} kademesinin alt sınırını ${pctTxt(lo)}'ten ${pctTxt(boundary)}'e yükselteyim mi?`;
    } else {
      // keep monotonic between neighbours
      const bounded = Math.min(next ? next.markup - 0.005 : Number.POSITIVE_INFINITY, Math.max(prev ? prev.markup + 0.005 : 0, target));
      if (Math.abs(bounded - tiers[i].markup) < 0.0049) continue;
      newTiers = tiers.map((t, j) => (j === i ? { ...t, markup: r4(bounded) } : { ...t }));
      what = `${pctTxt(lo)}+ avantaj kademesinin markup'ını ${pctTxt(tiers[i].markup)}'ten ${pctTxt(bounded)}'e ${dir > 0 ? 'yükselteyim' : 'düşüreyim'} mi?`;
    }
    out.push({
      kind: 'markup_tier', key: 'markupTiers', scope: { tierIndex: i },
      currentValue: { markupTiers: input.rules.markupTiers }, proposedValue: newTiers,
      patch: { op: 'set', values: { markupTiers: newTiers } },
      fingerprint: `markup_tier:${i}:${JSON.stringify(newTiers.map((t) => [r4(t.minAdvantage), r4(t.markup)]))}`,
      confidence: suggestionConfidence(inTier.length, o.minSample, consistency),
      sampleSize: inTier.length,
      title: `Önerilen markup ${inTier.length} teklifin %${Math.round(consistency * 100)}'inde ${dir > 0 ? 'yukarı' : 'aşağı'} düzeltildi — ${what}`,
      rationale:
        `${pctTxt(lo)}${Number.isFinite(hi) ? `–${pctTxt(hi)}` : '+'} kanal avantajı kademesinde sistem ${pctTxt(tiers[i].markup)} markup önerdi; ` +
        `onaylanan/gönderilen ${inTier.length} teklif satırının %${Math.round(consistency * 100)}'inde kullanıcı markup'ı ${dir > 0 ? 'artırdı' : 'azalttı'} ` +
        `(medyan fark ${medDelta > 0 ? '+' : ''}${Math.round(medDelta * 1000) / 10} puan). Öneri kademe tablosunu bu davranışa yaklaştırır; tablo sıralı (monoton) kalır.`,
      evidence: evidence(
        [{ key: 'date', label: 'Tarih', format: 'date' }, { key: 'ref', label: 'Teklif', format: 'text' }, { key: 'advantage', label: 'Avantaj', format: 'pct' },
          { key: 'suggestedMarkup', label: 'Önerilen markup', format: 'pct' }, { key: 'appliedMarkup', label: 'Uygulanan markup', format: 'pct' }],
        [...inTier].sort((a, b) => a.date.localeCompare(b.date)).map((x) => ({ date: x.date.slice(0, 10), ref: x.ref ?? null, advantage: r4(x.advantage!), suggestedMarkup: r4(x.suggestedMarkup), appliedMarkup: r4(x.appliedMarkup) })),
        o.maxEvidenceRows,
        { tierMinAdvantage: lo, currentMarkup: tiers[i].markup, medianDelta: r4(medDelta), editedShare: r4(consistency) },
      ),
    });
    break; // one tier change per run: later tiers are re-evaluated against the new table next week
  }
  return out;
}

// ------------------------------------------------------------------ (c) RFQ follow-up hours from response times
function rfqSuggestions(input: RuleSuggestionInput, o: RuleSuggestionOptions): RuleSuggestion[] {
  const { rules } = input;
  const responded = (input.rfqResponses ?? [])
    .filter((x) => x.respondedAt && Number.isFinite(hoursBetween(x.sentAt, x.respondedAt)) && hoursBetween(x.sentAt, x.respondedAt) >= 0)
    .map((x) => ({ ...x, hours: hoursBetween(x.sentAt, x.respondedAt!) }));
  const out: RuleSuggestion[] = [];
  const cols: EvidenceColumn[] = [{ key: 'sentAt', label: 'Gönderim', format: 'date' }, { key: 'supplier', label: 'Tedarikçi', format: 'text' }, { key: 'ref', label: 'Proje', format: 'text' }, { key: 'hours', label: 'Yanıt süresi', format: 'hours' }];
  const rowsOf = (xs: typeof responded) => [...xs].sort((a, b) => a.sentAt.localeCompare(b.sentAt)).map((x) => ({ sentAt: x.sentAt.slice(0, 10), supplier: x.supplierName, ref: x.ref ?? null, hours: r2(x.hours) }));
  const proposal = (hours: number[]) => {
    const p75 = quantile(hours, 0.75);
    const p90 = quantile(hours, 0.9);
    const reminder = Math.max(4, roundUpTo(p75, 4));
    const call = Math.max(reminder + 12, roundUpTo(p90, 4));
    return { p50: quantile(hours, 0.5), p75, p90, reminder, call };
  };
  const strong = (current: number, proposed: number) => Math.abs(proposed - current) >= 6 && Math.abs(proposed - current) / Math.max(1, current) >= o.minRfqRelativeGap;

  // global
  let globalReminder = rules.rfqReminderHours;
  if (responded.length >= Math.max(10, o.minSample)) {
    const g = proposal(responded.map((x) => x.hours));
    if (strong(rules.rfqReminderHours, g.reminder)) {
      globalReminder = g.reminder;
      const within = responded.filter((x) => x.hours <= rules.rfqReminderHours).length / responded.length;
      out.push({
        kind: 'rfq_hours', key: 'rfqReminderHours', scope: null,
        currentValue: { rfqReminderHours: rules.rfqReminderHours, rfqCallTaskHours: rules.rfqCallTaskHours },
        proposedValue: g.reminder,
        patch: { op: 'set', values: { rfqReminderHours: g.reminder, rfqCallTaskHours: g.call } },
        fingerprint: `rfq_hours:${g.reminder}:${g.call}`,
        confidence: suggestionConfidence(responded.length, 10, 1 - Math.abs(0.75 - within)),
        sampleSize: responded.length,
        title: `Tedarikçilerin %75'i ${Math.round(g.p75)} saatte yanıt veriyor — RFQ hatırlatmasını ${rules.rfqReminderHours} → ${g.reminder} saat, telefon görevini ${rules.rfqCallTaskHours} → ${g.call} saat yapayım mı?`,
        rationale:
          `${responded.length} yanıtlanmış RFQ'da medyan yanıt süresi ${Math.round(g.p50)} saat, %75'i ${Math.round(g.p75)} saat, %90'ı ${Math.round(g.p90)} saat içinde. ` +
          `Bugünkü ${rules.rfqReminderHours} saatlik hatırlatma anında yanıtların %${Math.round(within * 100)}'i zaten gelmiş oluyor. ` +
          `Öneri: hatırlatma normal yanıtların %75'i geldikten sonra, telefon görevi %90'ı geldikten sonra.`,
        evidence: evidence(cols, rowsOf(responded), o.maxEvidenceRows, { median: r2(g.p50), p75: r2(g.p75), p90: r2(g.p90), currentReminderHours: rules.rfqReminderHours, currentCallTaskHours: rules.rfqCallTaskHours }),
      });
    }
  }

  // per supplier (scoped): only when this supplier differs strongly from the (possibly proposed) global reminder
  const bySupplier = new Map<string, typeof responded>();
  for (const x of responded) (bySupplier.get(x.supplierId) ?? bySupplier.set(x.supplierId, []).get(x.supplierId)!).push(x);
  const minPerSupplier = Math.max(5, Math.ceil(o.minSample * 0.6));
  for (const [supplierId, xs] of bySupplier) {
    if (xs.length < minPerSupplier) continue;
    const s = proposal(xs.map((x) => x.hours));
    const existing = rules.supplierRfqHours?.find((x) => x.supplierId === supplierId) ?? null;
    const currentReminder = existing?.reminderHours ?? globalReminder;
    if (!strong(currentReminder, s.reminder)) continue;
    if (existing && existing.reminderHours === s.reminder && existing.callTaskHours === s.call) continue;
    const name = xs[0].supplierName;
    const entry: SupplierRfqHours = { supplierId, supplierName: name, reminderHours: s.reminder, callTaskHours: s.call, note: `medyan yanıt ${Math.round(s.p50)} saat (${xs.length} RFQ)` };
    const others = (rules.supplierRfqHours ?? []).filter((x) => x.supplierId !== supplierId);
    out.push({
      kind: 'supplier_rfq_hours', key: 'supplierRfqHours', scope: { supplierId, supplierName: name },
      currentValue: existing, proposedValue: [...others, entry],
      patch: { op: 'upsert_supplier_rfq_hours', entry },
      fingerprint: `supplier_rfq_hours:${supplierId}:${s.reminder}:${s.call}`,
      confidence: suggestionConfidence(xs.length, minPerSupplier, 0.8),
      sampleSize: xs.length,
      title: `${name} RFQ'lara medyan ${Math.round(s.p50)} saatte yanıt veriyor — bu tedarikçi için hatırlatma ${s.reminder} saat, telefon görevi ${s.call} saat olsun mu?`,
      rationale:
        `${name}: ${xs.length} RFQ'da medyan yanıt ${Math.round(s.p50)} saat, %75'i ${Math.round(s.p75)} saat (genel hatırlatma ${currentReminder} saat). ` +
        `Bu tedarikçi için kapsamlı (yalnız bu tedarikçi) bir takip süresi önerilir; diğer tedarikçiler genel kuralla devam eder.`,
      evidence: evidence(cols, rowsOf(xs), o.maxEvidenceRows, { supplier: name, median: r2(s.p50), p75: r2(s.p75), p90: r2(s.p90), currentReminderHours: currentReminder }),
    });
  }
  return out;
}

// ------------------------------------------------------------------ (d1) target margin from repeated admin overrides
function targetMarginSuggestions(input: RuleSuggestionInput, o: RuleSuggestionOptions): RuleSuggestion[] {
  const { rules } = input;
  const all = (input.marginOverrides ?? []).filter((x) => Number.isFinite(x.margin));
  if (all.length < o.minSample) return [];
  const approved = all.filter((x) => x.approved);
  const share = approved.length / all.length;
  if (approved.length < o.minSample || share < o.minEditConsistency) return [];
  const p25 = quantile(approved.map((x) => x.margin), 0.25);
  const target = Math.floor(p25 * 200) / 200; // round DOWN to 0.5pp so the evidence quotes pass
  // only a modest, clearly supported step down; never below current − 3pp in one go; never ≤ 0
  if (!(target < rules.targetMarginMin - 0.0049) || target < rules.targetMarginMin - 0.03 - 1e-9 || target <= 0) return [];
  const decided = approved.filter((x) => x.outcome === 'won' || x.outcome === 'lost');
  const won = decided.filter((x) => x.outcome === 'won').length;
  if (decided.length >= 4 && won / decided.length < 0.5) return []; // overrides that mostly lose are not evidence for a new target
  return [{
    kind: 'target_margin', key: 'targetMarginMin', scope: null,
    currentValue: { targetMarginMin: rules.targetMarginMin }, proposedValue: r4(target),
    patch: { op: 'set', values: { targetMarginMin: r4(target) } },
    fingerprint: `target_margin:${r4(target)}`,
    confidence: Math.min(0.8, suggestionConfidence(approved.length, o.minSample, share)), // financial threshold: capped
    sampleSize: approved.length,
    title: `Hedef marj altı ${all.length} tekliften ${approved.length}'i yönetici gerekçesiyle açıldı — hedef marjı ${pctTxt(rules.targetMarginMin)} → ${pctTxt(target)} yapayım mı?`,
    rationale:
      `Son dönemde ${all.length} teklif hedef marj (${pctTxt(rules.targetMarginMin)}) altında bloklandı; %${Math.round(share * 100)}'i gerekçeyle açıldı. ` +
      `Açılanların alt çeyrek marjı ${pctTxt(p25)}${decided.length ? `; sonuçlananların ${won}/${decided.length}'i kazanıldı` : ''}. ` +
      `Bu bir finansal eşiktir: yalnızca küçük bir adım önerilir ve yönetici onayı olmadan değişmez.`,
    evidence: evidence(
      [{ key: 'date', label: 'Tarih', format: 'date' }, { key: 'ref', label: 'Teklif', format: 'text' }, { key: 'margin', label: 'Marj', format: 'pct' }, { key: 'approved', label: 'Açıldı', format: 'text' }, { key: 'outcome', label: 'Sonuç', format: 'text' }],
      [...all].sort((a, b) => a.date.localeCompare(b.date)).map((x) => ({ date: x.date.slice(0, 10), ref: x.ref ?? null, margin: r4(x.margin), approved: x.approved, outcome: x.outcome ?? null })),
      o.maxEvidenceRows,
      { overrides: all.length, approvedShare: r4(share), p25Margin: r4(p25), currentTarget: rules.targetMarginMin },
    ),
  }];
}

// ------------------------------------------------------------------ (d2) customer option days from decision times
function optionDaysSuggestions(input: RuleSuggestionInput, o: RuleSuggestionOptions): RuleSuggestion[] {
  const { rules } = input;
  const cal = rules.businessHours;
  const perDay = businessMinutesPerDay(cal);
  if (!(perDay > 0)) return [];
  const obs = (input.quoteDecisions ?? []).filter((x) => x.outcome !== 'open');
  const decided = obs.filter((x) => x.decidedAt && x.outcome === 'accepted')
    .map((x) => ({ ...x, days: businessMinutesBetween(new Date(x.sentAt), new Date(x.decidedAt!), cal) / perDay }));
  if (decided.length < o.minSample) return [];
  const expired = obs.filter((x) => x.outcome === 'expired').length;
  const cur = rules.customerOptionBusinessDays;
  const p80 = quantile(decided.map((x) => x.days), 0.8);
  const p90 = quantile(decided.map((x) => x.days), 0.9);
  let proposed: number | null = null;
  let why = '';
  const late = decided.filter((x) => x.days > cur * 0.8).length / decided.length;
  if (p80 > cur && (late >= 0.3 || expired / Math.max(1, obs.length) >= 0.2)) {
    proposed = Math.min(cur + 5, Math.ceil(p80));
    why = `kabul edilen tekliflerin %80'i ${r2(p80)} iş gününde karar buldu (bugünkü opsiyon ${cur} iş günü); ${expired} teklif opsiyonu dolarak kapandı`;
  } else if (cur > 3 && p90 <= cur / 2) {
    proposed = Math.max(3, Math.ceil(p90) + 1);
    why = `kabul edilen tekliflerin %90'ı ${r2(p90)} iş gününde karar buldu; uzun opsiyon tedarikçi opsiyonu riskini gereksiz uzatıyor`;
  }
  if (proposed == null || proposed === cur) return [];
  return [{
    kind: 'customer_option_days', key: 'customerOptionBusinessDays', scope: null,
    currentValue: { customerOptionBusinessDays: cur }, proposedValue: proposed,
    patch: { op: 'set', values: { customerOptionBusinessDays: proposed } },
    fingerprint: `customer_option_days:${proposed}`,
    confidence: suggestionConfidence(decided.length, o.minSample, proposed > cur ? late : 1 - late),
    sampleSize: decided.length,
    title: `Müşteri opsiyon süresini ${cur} → ${proposed} iş günü yapayım mı?`,
    rationale: `${decided.length} kabul edilen teklifte ${why}. Opsiyon tarihi her durumda tedarikçi opsiyonunu aşamaz (§7 Adım 3).`,
    evidence: evidence(
      [{ key: 'sentAt', label: 'Gönderim', format: 'date' }, { key: 'ref', label: 'Teklif', format: 'text' }, { key: 'days', label: 'Karar süresi', format: 'days' }],
      [...decided].sort((a, b) => a.sentAt.localeCompare(b.sentAt)).map((x) => ({ sentAt: x.sentAt.slice(0, 10), ref: x.ref ?? null, days: r2(x.days) })),
      o.maxEvidenceRows,
      { accepted: decided.length, expired, p80Days: r2(p80), p90Days: r2(p90), currentDays: cur },
    ),
  }];
}

/** All evidence-backed suggestions for a tenant. Deterministic order; never touches forbidden keys. */
export function suggestRuleChanges(input: RuleSuggestionInput): RuleSuggestion[] {
  const o = { ...DEFAULT_RULE_SUGGESTION_OPTIONS, ...(input.options ?? {}) };
  const all = [
    ...supplierSeasonSuggestions(input, o),
    ...markupTierSuggestions(input, o),
    ...rfqSuggestions(input, o),
    ...targetMarginSuggestions(input, o),
    ...optionDaysSuggestions(input, o),
  ];
  return all.filter((s) => isSuggestableRuleKey(s.key) && patchKeys(s.patch).every(isSuggestableRuleKey));
}

/** Rule keys a patch touches. */
export function patchKeys(p: RuleSuggestionPatch): string[] {
  if (p.op === 'set') return Object.keys(p.values);
  return [p.op === 'upsert_supplier_season_markup' ? 'supplierSeasonMarkups' : 'supplierRfqHours'];
}

/**
 * Applies a suggestion patch to the CURRENT rules (pure). Returns the changed key → new value map.
 * 'set' refuses (stale) when a key no longer holds the value the suggestion was computed from.
 */
export function applyRuleSuggestionPatch(
  rules: TenantRules, patch: RuleSuggestionPatch, currentValue?: unknown,
): { ok: true; values: Partial<TenantRules> } | { ok: false; reason: 'forbidden_key' | 'stale' | 'invalid' } {
  if (!patchKeys(patch).every(isSuggestableRuleKey)) return { ok: false, reason: 'forbidden_key' };
  if (patch.op === 'set') {
    const cv = currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue) ? (currentValue as Record<string, unknown>) : null;
    for (const [k, v] of Object.entries(patch.values)) {
      if (!validValue(k as SuggestableRuleKey, v)) return { ok: false, reason: 'invalid' };
      if (cv && k in cv && JSON.stringify(cv[k]) !== JSON.stringify(rules[k as keyof TenantRules])) return { ok: false, reason: 'stale' };
    }
    return { ok: true, values: { ...patch.values } as Partial<TenantRules> };
  }
  if (patch.op === 'upsert_supplier_season_markup') {
    const e = patch.entry;
    if (!e?.supplierId || !Array.isArray(e.months) || !e.months.length || !e.months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12)
      || !Number.isFinite(e.markup) || e.markup < 0 || e.markup > 1) return { ok: false, reason: 'invalid' };
    const list = (rules.supplierSeasonMarkups ?? []).filter((x) => !(x.supplierId === e.supplierId && sameMonths(x.months, e.months)));
    return { ok: true, values: { supplierSeasonMarkups: [...list, e] } };
  }
  const e = patch.entry;
  if (!e?.supplierId || !(e.reminderHours > 0) || !(e.callTaskHours > e.reminderHours)) return { ok: false, reason: 'invalid' };
  const list = (rules.supplierRfqHours ?? []).filter((x) => x.supplierId !== e.supplierId);
  return { ok: true, values: { supplierRfqHours: [...list, e] } };
}

function validValue(k: SuggestableRuleKey, v: unknown): boolean {
  switch (k) {
    case 'markupTiers': {
      if (!Array.isArray(v) || !v.length) return false;
      const t = v as MarkupTier[];
      if (!t.every((x) => Number.isFinite(x?.minAdvantage) && Number.isFinite(x?.markup) && x.markup >= 0)) return false;
      const s = [...t].sort((a, b) => a.minAdvantage - b.minAdvantage);
      return s.every((x, i) => i === 0 || x.markup >= s[i - 1].markup);
    }
    case 'targetMarginMin': return typeof v === 'number' && v > 0 && v < 1;
    case 'rfqReminderHours': case 'rfqCallTaskHours': case 'customerOptionBusinessDays': return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 24 * 30;
    default: return Array.isArray(v);
  }
}
