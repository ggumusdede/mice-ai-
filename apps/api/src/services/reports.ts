// §16.6 Haftalık gelişim raporu (single screen) + §17.10 success metric definitions, and §4 per-user decision data (UserStats).
import type { UserStats, WeeklyReport } from '@mice/shared';
import { businessMinutesBetween, businessMinutesPerDay, localDate, localParts, median, startOfLocalDate } from '@mice/domain';
import type { Ctx } from '../context.js';
import { badRequest } from '../errors.js';
import { addDaysIso } from '../lib/dates.js';
import { logAiAction } from './ai-log.js';
import { currentFx, toEur } from './fx.js';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Monday (local) of the week containing `d`. */
export function mondayOf(d: Date, tz: string): string {
  const lp = localParts(d, tz);
  const day = localDate(d, tz);
  const shift = (lp.weekday + 6) % 7; // Monday = 0
  return addDaysIso(day, -shift);
}

async function correctionRate(ctx: Ctx, from: Date, to: Date): Promise<number | null> {
  // §17.10 correction rate: share of human-decided AI suggestions that were corrected (Düzelt) in the period;
  // plus AI drafts whose body was edited before sending.
  const d = (await ctx.db.query(
    `SELECT count(*) FILTER (WHERE action = 'edit')::int AS edited, count(*)::int AS total FROM decisions
      WHERE ai_action_type IS NOT NULL AND NOT auto_executed AND decided_at >= $1 AND decided_at < $2 AND action IS NOT NULL`, [from, to])).rows[0];
  const a = (await ctx.db.query(
    `SELECT count(*) FILTER (WHERE corrected)::int AS corrected, count(*)::int AS total FROM ai_actions
      WHERE action_type = 'draft_generation' AND decision_id IS NULL AND entity_type = 'message_draft' AND created_at >= $1 AND created_at < $2
        AND EXISTS (SELECT 1 FROM message_drafts m WHERE m.id = ai_actions.entity_id AND m.status = 'sent')`, [from, to])).rows[0];
  const total = d.total + a.total;
  return total ? r3((d.edited + a.corrected) / total) : null;
}

export async function weeklyReport(ctx: Ctx, weekStart?: string): Promise<WeeklyReport> {
  const rules = await ctx.rules();
  const cal = rules.businessHours;
  const tz = cal.timezone;
  const ws = weekStart ?? mondayOf(ctx.now(), tz);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ws)) throw badRequest('weekStart YYYY-MM-DD olmalı');
  const from = startOfLocalDate(ws, tz);
  const to = startOfLocalDate(ws, tz, 7);
  const perDay = businessMinutesPerDay(cal);

  // quote time (§17.10): start = request recorded, end = customer quote sent, business hours; customer wait reported separately
  const sent = (await ctx.db.query(
    `SELECT code, received_at, quote_sent_at, customer_wait_minutes, target_business_days, target_override_reason FROM projects
      WHERE quote_sent_at >= $1 AND quote_sent_at < $2`, [from, to])).rows;
  const agencyHours: number[] = [];
  let onTarget = 0;
  let waitMinutes = 0;
  for (const p of sent) {
    const total = businessMinutesBetween(new Date(p.received_at), new Date(p.quote_sent_at), cal);
    const wait = Math.min(total, Number(p.customer_wait_minutes ?? 0));
    waitMinutes += wait;
    const agency = total - wait;
    agencyHours.push(agency / 60);
    if (agency <= Number(p.target_business_days) * perDay) onTarget++;
  }
  const overrides = (await ctx.db.query(
    `SELECT code, target_override_reason FROM projects WHERE target_override_reason IS NOT NULL AND (quote_sent_at >= $1 AND quote_sent_at < $2 OR received_at >= $1 AND received_at < $2)`, [from, to])).rows
    .map((r) => ({ projectCode: r.code, reason: r.target_override_reason }));

  // corrections: this week + 8-week trend (oldest → newest)
  const trend: number[] = [];
  for (let i = 7; i >= 0; i--) {
    const f = startOfLocalDate(ws, tz, -7 * i);
    const t = startOfLocalDate(ws, tz, -7 * i + 7);
    trend.push((await correctionRate(ctx, f, t)) ?? 0);
  }
  const rate = await correctionRate(ctx, from, to);

  // won / lost (outcome transitions recorded in the audit log during the week)
  const outcomes = (await ctx.db.query(
    `SELECT DISTINCT ON (entity_id) entity_id, after->>'outcome' AS outcome, after->>'lost_reason' AS lost_reason FROM audit_log
      WHERE entity = 'projects' AND at >= $1 AND at < $2 AND after->>'outcome' IN ('won','lost')
        AND (before IS NULL OR before->>'outcome' IS DISTINCT FROM after->>'outcome') ORDER BY entity_id, at DESC`, [from, to])).rows;
  const lostReasons = new Map<string, number>();
  for (const o of outcomes.filter((x) => x.outcome === 'lost')) {
    const k = (o.lost_reason ?? '—').trim();
    lostReasons.set(k, (lostReasons.get(k) ?? 0) + 1);
  }

  const ev = (await ctx.db.query(
    `SELECT event, count(*)::int AS n FROM automation_events WHERE at >= $1 AND at < $2 GROUP BY event`, [from, to])).rows;
  const evn = (e: string) => ev.find((x) => x.event === e)?.n ?? 0;
  const sampled = (await ctx.db.query(`SELECT count(*)::int AS n FROM decisions WHERE kind = 'audit_sample' AND created_at >= $1 AND created_at < $2`, [from, to])).rows[0].n;

  const fx = await currentFx(ctx.db);
  const unreflectedTry = Number((await ctx.db.query(
    `SELECT COALESCE(sum(amount_try), 0) AS s FROM field_extras WHERE reflected_to_customer = false AND COALESCE(reflected_at, created_at) >= $1 AND COALESCE(reflected_at, created_at) < $2`, [from, to])).rows[0].s);

  const pending = (await ctx.db.query(
    `SELECT kind, count(*)::int AS n FROM decisions WHERE status = 'open' AND kind IN ('rule_suggestion','automation_promotion','checklist_question') GROUP BY kind`)).rows;
  const pn = (k: string) => pending.find((x) => x.kind === k)?.n ?? 0;

  const rfqOverrides = (await ctx.db.query(
    `SELECT DISTINCT ON (r.project_id, r.override_reason) p.code, r.override_reason FROM rfqs r JOIN projects p ON p.id = r.project_id
      WHERE r.override_reason IS NOT NULL AND r.created_at >= $1 AND r.created_at < $2`, [from, to])).rows
    .map((r) => ({ projectCode: r.code, reason: r.override_reason }));

  return {
    weekStart: ws,
    quoteTime: {
      medianBusinessHours: agencyHours.length ? r2(median(agencyHours)!) : null,
      targetBusinessHours: r2((rules.quoteTargetBusinessDays * perDay) / 60),
      onTargetRate: sent.length ? r3(onTarget / sent.length) : null,
      customerWaitHours: r2(waitMinutes / 60),
      overrides,
    },
    corrections: { rate, trend },
    quotes: { won: outcomes.filter((o) => o.outcome === 'won').length, lost: outcomes.filter((o) => o.outcome === 'lost').length, lostReasons: [...lostReasons.entries()].map(([reason, count]) => ({ reason, count })) },
    automation: { autoCount: evn('auto_executed'), sampled, sampleErrors: evn('sample_error'), demotions: evn('demoted') },
    unreflectedPriceDiffEur: r2(toEur(fx, unreflectedTry, 'TRY')),
    pending: { rules: pn('rule_suggestion'), automations: pn('automation_promotion'), checklist: pn('checklist_question') },
    styleUpdate: await monthlyStyleUpdate(ctx, ws),
    rfqOverrides,
  };
}

/** §15 "aylık üslubunda ne değişti" — one AI summary per month (cached in style_summaries). */
export async function monthlyStyleUpdate(ctx: Ctx, day: string): Promise<string | null> {
  const month = day.slice(0, 7);
  const cached = (await ctx.db.query(`SELECT summary FROM style_summaries WHERE month = $1 AND language = 'tr'`, [month])).rows[0];
  if (cached) return cached.summary;
  const from = `${month}-01`;
  const to = addDaysIso(`${month}-28`, 4).slice(0, 7) + '-01';
  const corrections = (await ctx.db.query(
    `SELECT original_body AS before, body AS after FROM message_drafts WHERE ai_generated AND original_body IS NOT NULL AND original_body <> body
       AND language = 'tr' AND updated_at >= $1::date AND updated_at < $2::date ORDER BY updated_at DESC LIMIT 50`, [from, to])).rows;
  if (!corrections.length) return null;
  const r = await ctx.deps.ai.summarizeStyle(corrections, 'tr');
  const aiActionId = await logAiAction(ctx, { actionType: 'draft_generation', result: r, inputSummary: { kind: 'style_summary', month, corrections: corrections.length } });
  await ctx.db.query(
    `INSERT INTO style_summaries (tenant_id, month, language, summary, corrections, ai_action_id) VALUES (app_tenant_id(), $1, 'tr', $2, $3, $4)
     ON CONFLICT (tenant_id, month, language) DO NOTHING`, [month, r.data.summary, corrections.length, aiActionId]);
  return r.data.summary;
}

/** §4 Kişi bazlı yetki verisi: quote corrections, average price / margin change, won / lost. */
export async function userStats(ctx: Ctx, userId: string): Promise<UserStats> {
  const quotes = (await ctx.db.query(`SELECT id, project_id, version, status, approval_decision_id FROM quotes WHERE created_by = $1 ORDER BY project_id, version`, [userId])).rows;
  const quoteIds = quotes.map((q) => q.id);
  const corrected = quoteIds.length ? (await ctx.db.query(
    `SELECT count(DISTINCT entity_id)::int AS n FROM decisions WHERE kind IN ('quote_approval','margin_override') AND entity_id = ANY($1) AND action IN ('edit','reject')`, [quoteIds])).rows[0].n : 0;
  // price / margin change between the first and the final version of the same project's quote (option 1 totals)
  const totals = quoteIds.length ? (await ctx.db.query(
    `SELECT quote_id, sum(unit_cost_eur * quantity * GREATEST(COALESCE(nights, 1), 1)) AS cost, sum(unit_price_eur * quantity * GREATEST(COALESCE(nights, 1), 1)) AS sale
       FROM quote_lines WHERE quote_id = ANY($1) AND option_no = 1 GROUP BY quote_id`, [quoteIds])).rows : [];
  const byProject = new Map<string, { first: string; last: string }>();
  for (const q of quotes) {
    const e = byProject.get(q.project_id);
    if (!e) byProject.set(q.project_id, { first: q.id, last: q.id });
    else e.last = q.id;
  }
  const priceChanges: number[] = [];
  const marginChanges: number[] = [];
  for (const { first, last } of byProject.values()) {
    if (first === last) continue;
    const a = totals.find((t) => t.quote_id === first);
    const b = totals.find((t) => t.quote_id === last);
    if (!a || !b || !Number(a.sale) || !Number(b.sale)) continue;
    priceChanges.push((Number(b.sale) - Number(a.sale)) / Number(a.sale));
    const ma = (Number(a.sale) - Number(a.cost)) / Number(a.sale);
    const mb = (Number(b.sale) - Number(b.cost)) / Number(b.sale);
    marginChanges.push(mb - ma);
  }
  const avg = (xs: number[]) => (xs.length ? r3((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) : 0);
  const outcome = (await ctx.db.query(
    `SELECT count(*) FILTER (WHERE outcome IN ('won','closed'))::int AS won, count(*) FILTER (WHERE outcome = 'lost')::int AS lost FROM projects WHERE owner_id = $1`, [userId])).rows[0];
  const decided = outcome.won + outcome.lost;
  return {
    userId, quotesTotal: quotes.length, quotesCorrected: corrected, avgPriceChangePct: avg(priceChanges), avgMarginChangePct: avg(marginChanges),
    won: outcome.won, lost: outcome.lost, winRate: decided ? r3(outcome.won / decided) : null,
  };
}
