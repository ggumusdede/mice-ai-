// §16.5 Kural önerisi üreticisi — weekly worker job + admin-only decision effect.
// Data (price history × channel prices, quote-line markup edits, RFQ response times, margin overrides, customer decision
// times) → @mice/domain suggestRuleChanges() (pure) → one 'rule_suggestion' decision per new suggestion (admin only).
// The generator NEVER changes a rule: rules change only in the decision effect below, with a human admin as decidedBy
// (setRule → audited rules row; the DB rules_change_guard additionally refuses AI actors, §6 rule_change forbidden).
import { DEFAULT_RULES, type TenantRules } from '@mice/shared';
import {
  applyRuleSuggestionPatch, isSuggestableRuleKey, NEVER_SUGGESTED_RULE_KEYS, suggestRuleChanges,
  type RuleSuggestion, type RuleSuggestionInput, type RuleSuggestionPatch,
} from '@mice/domain';
import type { Ctx } from '../context.js';
import { badRequest, conflict, forbidden } from '../errors.js';
import type { Row } from '../lib/mappers.js';
import { createDecision, type EffectInput } from './decisions.js';
import { logAiAction } from './ai-log.js';
import { loadRules, setRule } from './rules.js';

export const RULE_SUGGESTION_JOB = 'rule_suggestions_weekly';
/** run at most once per this many hours per tenant */
export const RULE_SUGGESTION_INTERVAL_HOURS = 7 * 24 - 1;
/** an identical suggestion that was rejected is not proposed again within this many days */
export const RULE_SUGGESTION_COOLDOWN_DAYS = 90;

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const dateStr = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** Reads the learning data the generator needs (tenant-scoped by RLS). */
export async function collectRuleSuggestionInput(ctx: Ctx, now: Date, rules: TenantRules): Promise<RuleSuggestionInput> {
  const q = <T = Row>(sql: string, params: unknown[]) => ctx.db.query(sql, params).then((r) => r.rows as T[]);
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);

  // (a) accommodation: final price per item × supplier × room type vs channel price on the same stay date & conditions
  const adv = await q(
    `WITH ph AS (
       SELECT DISTINCT ON (COALESCE(ph.service_item_id, ph.id), ph.supplier_id, lower(ph.room_type)) ph.*, p.code
         FROM price_history ph LEFT JOIN projects p ON p.id = ph.project_id
        WHERE ph.kind = 'accommodation' AND ph.service_date IS NOT NULL AND ph.room_type IS NOT NULL AND ph.supplier_id IS NOT NULL
          AND ph.service_date >= $1::date
        ORDER BY COALESCE(ph.service_item_id, ph.id), ph.supplier_id, lower(ph.room_type), ph.created_at DESC)
     SELECT ph.supplier_id, s.name AS supplier_name, ph.service_date, ph.room_type, ph.unit_price_eur, ph.code, avg(cp.price_eur)::float8 AS channel
       FROM ph JOIN suppliers s ON s.id = ph.supplier_id
       JOIN channel_prices cp ON cp.supplier_id = ph.supplier_id AND cp.stay_date = ph.service_date
        AND lower(cp.room_type) = lower(ph.room_type) AND lower(cp.board) = lower(COALESCE(ph.board, cp.board))
        AND cp.cancellation = COALESCE(ph.cancellation, 'flexible')
      GROUP BY ph.supplier_id, s.name, ph.service_date, ph.room_type, ph.unit_price_eur, ph.code`,
    [dateStr(days(730))]);

  // (b) tier suggestion vs applied markup on human-approved / sent quotes (edits made before or after a returned approval)
  const markups = await q(
    `SELECT ql.advantage, ql.suggested_markup, ql.markup, q.created_at, p.code, q.version
       FROM quote_lines ql JOIN quotes q ON q.id = ql.quote_id JOIN projects p ON p.id = q.project_id
      WHERE q.status IN ('approved','sent','accepted') AND ql.suggested_markup IS NOT NULL AND NOT ql.value_add AND q.created_at >= $1`,
    [days(365)]);

  // (c) RFQ → first offer of that supplier for that item
  const rfqs = await q(
    `SELECT r.supplier_id, s.name AS supplier_name, r.sent_at, p.code,
            (SELECT min(o.created_at) FROM supplier_offers o
              WHERE o.rfq_id = r.id OR (o.rfq_id IS NULL AND o.service_item_id = r.service_item_id AND o.supplier_id = r.supplier_id AND o.created_at >= r.sent_at)) AS responded_at
       FROM rfqs r JOIN suppliers s ON s.id = r.supplier_id JOIN projects p ON p.id = r.project_id
      WHERE r.sent_at IS NOT NULL AND r.sent_at >= $1`,
    [days(365)]);

  // (d1) margin overrides decided by an admin
  const overrides = await q(
    `SELECT d.status, d.created_at, d.detail, p.code, p.outcome FROM decisions d LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.kind = 'margin_override' AND d.status IN ('approved','edited','rejected') AND d.created_at >= $1`,
    [days(180)]);

  // (d2) customer decision times on sent quotes
  const quotes = await q(
    `SELECT q.status, q.sent_at, q.accepted_at, q.updated_at, q.option_until, p.code, q.version FROM quotes q JOIN projects p ON p.id = q.project_id
      WHERE q.sent_at IS NOT NULL AND q.sent_at >= $1`,
    [days(365)]);
  const today = dateStr(now);

  return {
    rules,
    advantages: adv.filter((r) => Number(r.channel) > 0).map((r) => ({
      supplierId: r.supplier_id, supplierName: r.supplier_name, date: dateStr(r.service_date), roomType: r.room_type, ref: r.code ?? null,
      advantage: (Number(r.channel) - Number(r.unit_price_eur)) / Number(r.channel),
    })),
    markupEdits: markups.map((r) => ({
      advantage: r.advantage == null ? null : Number(r.advantage), suggestedMarkup: Number(r.suggested_markup), appliedMarkup: Number(r.markup),
      date: iso(r.created_at), ref: `${r.code} v${r.version}`,
    })),
    rfqResponses: rfqs.map((r) => ({ supplierId: r.supplier_id, supplierName: r.supplier_name, sentAt: iso(r.sent_at), respondedAt: r.responded_at ? iso(r.responded_at) : null, ref: r.code })),
    marginOverrides: overrides.map((r) => {
      const opts = (r.detail?.options ?? []) as { totals?: { margin?: number } }[];
      const margins = opts.map((o) => Number(o.totals?.margin)).filter(Number.isFinite);
      return {
        date: iso(r.created_at), margin: margins.length ? Math.min(...margins) : NaN, approved: r.status !== 'rejected',
        outcome: r.outcome === 'won' || r.outcome === 'lost' ? r.outcome : r.outcome ? 'open' : null, ref: r.code ?? null,
      };
    }),
    quoteDecisions: quotes.map((r) => ({
      sentAt: iso(r.sent_at),
      decidedAt: r.accepted_at ? iso(r.accepted_at) : r.status === 'rejected' ? iso(r.updated_at) : null,
      outcome: r.accepted_at || r.status === 'accepted' ? 'accepted' : r.status === 'rejected' ? 'rejected'
        : r.status === 'sent' && r.option_until && dateStr(r.option_until) < today ? 'expired' : 'open',
      ref: `${r.code} v${r.version}`,
    })),
  };
}

function scopeKey(s: Pick<RuleSuggestion, 'kind' | 'scope'>): string {
  return `${s.kind}:${s.scope?.supplierId ?? ''}:${(s.scope?.months ?? []).join('-')}`;
}

export interface RuleSuggestionRunResult { ran: boolean; created: string[]; skipped: { fingerprint: string; reason: string }[] }

/**
 * Generates suggestions and opens one admin-only decision for each NEW one. Idempotent:
 *  - identical suggestion (fingerprint) open → skipped; rejected within RULE_SUGGESTION_COOLDOWN_DAYS → skipped;
 *  - another open suggestion for the same kind + scope → skipped (decide that one first).
 */
export async function generateRuleSuggestions(ctx: Ctx, now: Date = ctx.now()): Promise<RuleSuggestionRunResult> {
  const rules = await ctx.rules();
  const suggestions = suggestRuleChanges(await collectRuleSuggestionInput(ctx, now, rules));
  const existing = (await ctx.db.query(
    `SELECT fingerprint, kind, scope, status, created_at FROM rule_suggestions WHERE source = 'generator' AND (status = 'open' OR created_at >= $1)`,
    [new Date(now.getTime() - RULE_SUGGESTION_COOLDOWN_DAYS * 86_400_000)])).rows;
  const out: RuleSuggestionRunResult = { ran: true, created: [], skipped: [] };
  for (const s of suggestions) {
    if (existing.some((e) => e.fingerprint === s.fingerprint && e.status === 'open')) { out.skipped.push({ fingerprint: s.fingerprint, reason: 'open' }); continue; }
    if (existing.some((e) => e.fingerprint === s.fingerprint && e.status === 'rejected')) { out.skipped.push({ fingerprint: s.fingerprint, reason: 'rejected_recently' }); continue; }
    if (existing.some((e) => e.status === 'open' && scopeKey({ kind: e.kind, scope: e.scope }) === scopeKey(s))) { out.skipped.push({ fingerprint: s.fingerprint, reason: 'scope_open' }); continue; }
    const row = (await ctx.db.query(
      `INSERT INTO rule_suggestions (tenant_id, key, proposed_value, evidence, status, kind, fingerprint, scope, patch, current_value, confidence,
         sample_size, rationale, supplier_id, source)
       VALUES (app_tenant_id(), $1, $2::jsonb, $3::jsonb, 'open', $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12, 'generator') RETURNING id`,
      [s.key, JSON.stringify(s.proposedValue), JSON.stringify(s.evidence), s.kind, s.fingerprint, JSON.stringify(s.scope), JSON.stringify(s.patch),
        JSON.stringify(s.currentValue ?? null), s.confidence, s.sampleSize, s.rationale, s.scope?.supplierId ?? null])).rows[0];
    const decision = await createDecision(ctx, {
      kind: 'rule_suggestion', badge: 'suggestion', urgent: false, summary: s.title,
      aiNote: `${s.rationale}\n\nGüven: %${Math.round(s.confidence * 100)} · ${s.sampleSize} veri noktası. Yalnızca yönetici onayıyla yürürlüğe girer.`,
      detail: {
        key: s.key, suggestionKind: s.kind, scope: s.scope ? { supplierName: s.scope.supplierName ?? null, months: s.scope.months ?? null, tierIndex: s.scope.tierIndex ?? null } : null,
        currentValue: s.currentValue ?? null, proposedValue: s.proposedValue, confidence: s.confidence, sampleSize: s.sampleSize, evidence: s.evidence,
      },
      requiredRole: 'admin', entityType: 'rule_suggestion', entityId: row.id, primaryActionLabel: 'Kuralı uygula',
    });
    await ctx.db.query('UPDATE rule_suggestions SET decision_id = $2 WHERE id = $1', [row.id, decision.id]);
    existing.push({ fingerprint: s.fingerprint, kind: s.kind, scope: s.scope, status: 'open', created_at: now });
    out.created.push(decision.id);
  }
  // the generator is a deterministic statistic (no LLM text); logged for the weekly report / audit trail
  await logAiAction(ctx, {
    actionType: 'calculation_normalization', entityType: 'rule_suggestions', result: {
      confidence: 1, model: 'domain:rule-suggestions', data: { suggestions: suggestions.length, created: out.created.length, skipped: out.skipped },
    },
  });
  return out;
}

/** Worker entry: at most once per RULE_SUGGESTION_INTERVAL_HOURS per tenant (job_runs). */
export async function runWeeklyRuleSuggestions(ctx: Ctx, now: Date): Promise<string[]> {
  const last = (await ctx.db.query(`SELECT max(ran_at) AS t FROM job_runs WHERE job = $1`, [RULE_SUGGESTION_JOB])).rows[0]?.t as Date | null;
  if (last && now.getTime() - new Date(last).getTime() < RULE_SUGGESTION_INTERVAL_HOURS * 3_600_000) return [];
  const r = await generateRuleSuggestions(ctx, now);
  await ctx.db.query(`INSERT INTO job_runs (tenant_id, job, ran_at, result) VALUES (app_tenant_id(), $1, $2, $3::jsonb)`,
    [RULE_SUGGESTION_JOB, now, JSON.stringify({ created: r.created.length, skipped: r.skipped.length })]);
  return [`rule_suggestions:${r.created.length}`];
}

// ------------------------------------------------------------------ decision effect (admin path only)
function editedPatch(patch: RuleSuggestionPatch, edits: Record<string, unknown> | undefined, key: string): RuleSuggestionPatch {
  if (!edits) return patch;
  if (patch.op === 'set') {
    const values: Record<string, unknown> = { ...patch.values };
    const keys = Object.keys(values);
    if (keys.length === 1 && edits.value !== undefined) values[keys[0]] = edits.value;
    for (const k of keys) if (edits[k] !== undefined) values[k] = edits[k];
    if (edits.value !== undefined && keys.length > 1 && key in values) values[key] = edits.value;
    return { op: 'set', values: values as never };
  }
  if (patch.op === 'upsert_supplier_season_markup') {
    const m = edits.markup ?? edits.value;
    return { ...patch, entry: { ...patch.entry, ...(typeof m === 'number' ? { markup: m } : {}), ...(Array.isArray(edits.months) ? { months: edits.months as number[] } : {}) } };
  }
  const rh = edits.reminderHours ?? edits.value;
  return { ...patch, entry: { ...patch.entry, ...(typeof rh === 'number' ? { reminderHours: rh } : {}), ...(typeof edits.callTaskHours === 'number' ? { callTaskHours: edits.callTaskHours } : {}) } };
}

/** The 'rule_suggestion' decision effect. Caller (registry) already refused auto / non-human execution. */
export async function applyRuleSuggestionDecision(ctx: Ctx, d: Row, input: EffectInput): Promise<string[]> {
  if (input.auto || !input.decidedBy || ctx.actor.type !== 'user') throw forbidden('Kural değişikliği yalnızca yönetici kararıyla', 'AI_FORBIDDEN_ACTION');
  const sug = d.entity_id ? (await ctx.db.query('SELECT * FROM rule_suggestions WHERE id = $1 FOR UPDATE', [d.entity_id])).rows[0] : null;
  if (input.action === 'reject') {
    if (sug) await ctx.db.query(`UPDATE rule_suggestions SET status = 'rejected', decided_at = $2, decision_id = COALESCE(decision_id, $3) WHERE id = $1`, [sug.id, ctx.now(), d.id]);
    return ['rule_suggestion_rejected'];
  }
  const rules = await loadRules(ctx.db);
  const reason = `Kural önerisi kararı ${d.id}${input.reason ? ` — ${input.reason}` : ''}`;
  let values: Partial<TenantRules>;
  if (sug?.patch) {
    const patch = editedPatch(sug.patch as RuleSuggestionPatch, input.action === 'edit' ? input.edits : undefined, sug.key);
    // 'set' applies only while the affected keys still hold the values the evidence was computed against (else: stale)
    const r = applyRuleSuggestionPatch(rules, patch, sug.current_value);
    if (!r.ok) {
      if (r.reason === 'stale') throw conflict('Kural, öneri hazırlandıktan sonra değişti. Öneriyi reddedin; gelecek hafta güncel veriyle yeniden hesaplanır.', 'RULE_SUGGESTION_STALE');
      if (r.reason === 'forbidden_key') throw forbidden('Bu ayar kural önerisiyle değiştirilemez (§6)', 'AI_FORBIDDEN_ACTION');
      throw badRequest('Geçersiz kural değeri', undefined, 'INVALID_RULE_VALUE');
    }
    values = r.values;
  } else {
    // legacy card (key + proposedValue in detail)
    const key = d.detail?.key as string;
    if (!key || !(key in DEFAULT_RULES) || (NEVER_SUGGESTED_RULE_KEYS as readonly string[]).includes(key) || !isSuggestableRuleKey(key)) {
      throw forbidden('Bu ayar kural önerisiyle değiştirilemez (§6)', 'AI_FORBIDDEN_ACTION');
    }
    values = { [key]: input.action === 'edit' && input.edits?.value !== undefined ? input.edits.value : d.detail?.proposedValue } as Partial<TenantRules>;
  }
  const changed: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    await setRule(ctx.db, k as keyof TenantRules, v, input.decidedBy, reason);
    changed.push(`rule_changed:${k}`);
  }
  if (sug) await ctx.db.query(`UPDATE rule_suggestions SET status = 'accepted', decided_at = $2, decision_id = COALESCE(decision_id, $3) WHERE id = $1`, [sug.id, ctx.now(), d.id]);
  return changed;
}
