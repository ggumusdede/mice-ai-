// §16.6 Haftalık gelişim raporu (single screen) + §17.10 success metric definitions, and §4 per-user decision data (UserStats).
import type { TeamPerformanceLostProject, TeamPerformanceReport, TeamPerformanceRow, UserStats, WeeklyReport } from '@mice/shared';
import { businessMinutesBetween, businessMinutesPerDay, localDate, localParts, median, profitSummary, startOfLocalDate } from '@mice/domain';
import type { Ctx } from '../context.js';
import { badRequest } from '../errors.js';
import { addDaysIso } from '../lib/dates.js';
import { logAiAction } from './ai-log.js';
import { agencyBase, currentFx, toEur } from './fx.js';
import { canSeeFinancials } from './visibility.js';
import { projectRealizedFx } from './realized-fx.js';

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
      WHERE entity = 'projects' AND at >= $1 AND at < $2 AND after->>'outcome' IN ('won','lost') AND COALESCE((after->>'historical')::boolean, false) = false
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

  // v0.5 S-19: agency-level report → the agency's CURRENT base currency, rate source shown
  const agency = await agencyBase(ctx.db);
  const fx = await currentFx(ctx.db, agency);
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
    baseCurrency: agency as WeeklyReport['baseCurrency'], fxNote: agency === 'TRY' ? null : `${fx.source} ${fx.date}`,
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

// ------------------------------------------------------------------ Q7: Ekip performansı (§4 karar verisi, §16.7 6. ay yetki gözden geçirmesi)
const MAX_SPAN_DAYS = 5 * 366;
interface PerfAcc {
  requests: number; quotesSent: number; won: number; lost: number; lostProjects: TeamPerformanceLostProject[];
  quoteHours: number[]; onTarget: number; margins: number[]; markups: number[]; plannedProfit: number;
  realizedEur: number; realizedTry: number; realizedProjects: number; realizedTryKnown: number; realizedTryMissing: number;
  quotesBuilt: number; quotesReviewed: number; quotesCorrected: number; approvalRequired: number; free: number; blocked: number; historical: number;
}
const emptyAcc = (): PerfAcc => ({
  requests: 0, quotesSent: 0, won: 0, lost: 0, lostProjects: [], quoteHours: [], onTarget: 0, margins: [], markups: [], plannedProfit: 0,
  realizedEur: 0, realizedTry: 0, realizedProjects: 0, realizedTryKnown: 0, realizedTryMissing: 0,
  quotesBuilt: 0, quotesReviewed: 0, quotesCorrected: 0, approvalRequired: 0, free: 0, blocked: 0, historical: 0,
});
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Rolling period report per salesperson. Projects (requests, sends, outcomes, quote time, planned / realized profit) are attributed
 *  to the project OWNER; quote-quality data (corrections, approval-required vs free) to the quote AUTHOR. Imported historical
 *  projects count when their owner is known. Default period: the last 12 months up to today (inclusive). */
export async function teamPerformance(ctx: Ctx, q: { from?: string; to?: string } = {}): Promise<TeamPerformanceReport> {
  const rules = await ctx.rules();
  const cal = rules.businessHours;
  const tz = cal.timezone;
  const perDay = businessMinutesPerDay(cal);
  const today = localDate(ctx.now(), tz);
  const to = q.to ?? today;
  const from = q.from ?? addDaysIso(`${Number(to.slice(0, 4)) - 1}${to.slice(4, 10)}`, 1);
  for (const d of [from, to]) if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw badRequest('from / to YYYY-MM-DD olmalı', undefined, 'INVALID_PERIOD');
  if (from > to) throw badRequest('Başlangıç bitişten sonra olamaz', undefined, 'INVALID_PERIOD');
  const fromTs = startOfLocalDate(from, tz);
  const toTs = startOfLocalDate(to, tz, 1); // inclusive end day
  if ((toTs.getTime() - fromTs.getTime()) / 86_400_000 > MAX_SPAN_DAYS) throw badRequest('Dönem en fazla 5 yıl olabilir', undefined, 'INVALID_PERIOD');
  const fin = await canSeeFinancials(ctx);
  // v0.5 S-19: projects may have different base currencies — summed through their EUR equivalent (*_eur) and shown in the agency's
  // CURRENT base currency at today's system rate (source shown in fxNote)
  const agency = await agencyBase(ctx.db);
  const eurFx = await currentFx(ctx.db);
  const kAgency = agency === 'EUR' ? 1 : eurFx.rates[agency] ?? 1;

  const acc = new Map<string, PerfAcc>();
  const a = (uid: string) => { let x = acc.get(uid); if (!x) acc.set(uid, (x = emptyAcc())); return x; };

  // requests received in the period
  for (const r of (await ctx.db.query(
    `SELECT owner_id, count(*)::int AS n, count(*) FILTER (WHERE historical)::int AS h FROM projects
      WHERE owner_id IS NOT NULL AND received_at >= $1 AND received_at < $2 GROUP BY owner_id`, [fromTs, toTs])).rows) {
    a(r.owner_id).requests += r.n;
    a(r.owner_id).historical += r.h;
  }
  // quotes sent in the period (each sent revision counts)
  for (const r of (await ctx.db.query(
    `SELECT p.owner_id, count(*)::int AS n FROM quotes q JOIN projects p ON p.id = q.project_id
      WHERE p.owner_id IS NOT NULL AND q.sent_at >= $1 AND q.sent_at < $2 GROUP BY p.owner_id`, [fromTs, toTs])).rows) a(r.owner_id).quotesSent += r.n;
  // quote time: first send in the period, agency business hours (customer wait excluded) vs target
  for (const p of (await ctx.db.query(
    `SELECT owner_id, received_at, quote_sent_at, customer_wait_minutes, target_business_days FROM projects
      WHERE owner_id IS NOT NULL AND NOT historical AND quote_sent_at >= $1 AND quote_sent_at < $2`, [fromTs, toTs])).rows) {
    const total = businessMinutesBetween(new Date(p.received_at), new Date(p.quote_sent_at), cal);
    const agency = total - Math.min(total, Number(p.customer_wait_minutes ?? 0));
    a(p.owner_id).quoteHours.push(agency / 60);
    if (agency <= Number(p.target_business_days) * perDay) a(p.owner_id).onTarget++;
  }

  // outcomes decided in the period: live projects → the audit transition time; historical → event start (import has no decision date)
  const decided = (await ctx.db.query(
    `SELECT * FROM (
       SELECT p.id, p.owner_id, p.code, p.title, p.customer_name, p.outcome, p.lost_reason, p.historical, p.historical_cost_eur, p.historical_sale_eur,
         CASE WHEN p.historical THEN COALESCE(p.start_date::timestamp AT TIME ZONE $3::text, p.received_at)
           ELSE COALESCE((SELECT min(al.at) FROM audit_log al WHERE al.entity = 'projects' AND al.entity_id = p.id::text
                  AND al.after->>'outcome' = CASE WHEN p.outcome = 'lost' THEN 'lost' ELSE 'won' END
                  AND (al.before IS NULL OR al.before->>'outcome' IS DISTINCT FROM al.after->>'outcome')), p.received_at) END AS decided_at
       FROM projects p WHERE p.owner_id IS NOT NULL AND p.outcome IN ('won','closed','lost')) x
     WHERE decided_at >= $1 AND decided_at < $2 ORDER BY decided_at DESC`, [fromTs, toTs, tz])).rows;
  const wonRows = decided.filter((r) => r.outcome !== 'lost');
  for (const r of decided) {
    if (r.outcome === 'lost') {
      a(r.owner_id).lost++;
      a(r.owner_id).lostProjects.push({
        projectId: r.id, code: r.code, title: r.title, customerName: r.customer_name, lostReason: r.lost_reason,
        decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null, historical: r.historical,
      });
    } else a(r.owner_id).won++;
  }

  if (fin && wonRows.length) {
    const ids = wonRows.map((r) => r.id);
    // planned: accepted option of the accepted quote (else option 1 of the latest live revision)
    const planned = (await ctx.db.query(
      `WITH ref AS (SELECT DISTINCT ON (q.project_id) q.project_id, q.id, COALESCE(q.accepted_option_no, 1) AS opt FROM quotes q
                     WHERE q.project_id = ANY($1) ORDER BY q.project_id, (q.status = 'accepted') DESC, (q.status <> 'superseded') DESC, q.version DESC)
       SELECT ref.project_id, sum(l.unit_cost_eur * l.quantity * GREATEST(COALESCE(l.nights, 1), 1)) AS cost,
              sum(l.unit_price_eur * l.quantity * GREATEST(COALESCE(l.nights, 1), 1)) AS sale
         FROM ref JOIN quote_lines l ON l.quote_id = ref.id AND l.option_no = ref.opt GROUP BY ref.project_id`, [ids])).rows;
    const invoiced = (await ctx.db.query(
      `SELECT project_id, kind, sum(amount_eur) AS s FROM finance_entries WHERE project_id = ANY($1) AND status <> 'cancelled'
         AND kind IN ('supplier_invoice','customer_invoice') GROUP BY project_id, kind`, [ids])).rows;
    for (const r of wonRows) {
      const x = a(r.owner_id);
      const pl = planned.find((p) => p.project_id === r.id);
      const cost = pl ? Number(pl.cost) : r.historical_cost_eur != null ? Number(r.historical_cost_eur) : null;
      const sale = pl ? Number(pl.sale) : r.historical_sale_eur != null ? Number(r.historical_sale_eur) : null;
      if (cost != null && sale != null && sale > 0) {
        const ps = profitSummary(cost, sale);
        x.margins.push(ps.margin);
        if (cost > 0) x.markups.push(ps.markup);
        x.plannedProfit += ps.profitEur;
      }
      // realized (EUR, same basis as ProjectDetail.profit.realized; historical without movements → imported totals)
      const ci = invoiced.find((i) => i.project_id === r.id && i.kind === 'customer_invoice')?.s;
      const si = invoiced.find((i) => i.project_id === r.id && i.kind === 'supplier_invoice')?.s;
      let realizedEur: number | null = null;
      if (ci != null || si != null) realizedEur = Number(ci ?? 0) - Number(si ?? 0);
      else if (r.historical && r.historical_sale_eur != null && r.historical_cost_eur != null) realizedEur = Number(r.historical_sale_eur) - Number(r.historical_cost_eur);
      if (realizedEur == null) continue;
      x.realizedEur += realizedEur;
      x.realizedProjects++;
      const tryProfit = await realizedTry(ctx, r.id);
      if (tryProfit == null) x.realizedTryMissing++;
      else { x.realizedTry += tryProfit; x.realizedTryKnown++; }
    }
  }

  // quote quality — by author, quotes created in the period
  for (const r of (await ctx.db.query(
    `SELECT q.created_by AS uid, count(*)::int AS built,
            count(*) FILTER (WHERE q.requires_approval)::int AS approval,
            count(*) FILTER (WHERE NOT q.requires_approval AND q.approved_by IS NOT NULL AND q.approved_by = q.created_by AND q.margin_override_by IS NULL)::int AS free,
            count(DISTINCT d.entity_id) FILTER (WHERE d.action IS NOT NULL AND NOT d.auto_executed)::int AS reviewed,
            count(DISTINCT d.entity_id) FILTER (WHERE d.action IN ('edit','reject') AND NOT d.auto_executed)::int AS corrected
       FROM quotes q LEFT JOIN decisions d ON d.entity_type = 'quote' AND d.entity_id = q.id AND d.kind IN ('quote_approval','margin_override')
      WHERE q.created_by IS NOT NULL AND q.created_at >= $1 AND q.created_at < $2 GROUP BY q.created_by`, [fromTs, toTs])).rows) {
    const x = a(r.uid);
    x.quotesBuilt += r.built;
    x.approvalRequired += r.approval;
    x.free += r.free;
    x.blocked += r.built - r.approval - r.free;
    x.quotesReviewed += r.reviewed;
    x.quotesCorrected += r.corrected;
  }

  const users = (await ctx.db.query(
    `SELECT id, full_name, role, authority_level, active FROM users WHERE id = ANY($1) OR (active AND role IN ('admin','clerk_sales','clerk_ops'))`,
    [[...acc.keys()]])).rows;
  const targetHours = r2((rules.quoteTargetBusinessDays * perDay) / 60);
  const toRow = (x: PerfAcc) => {
    const reasons = new Map<string, number>();
    for (const l of x.lostProjects) { const k = (l.lostReason ?? '—').trim() || '—'; reasons.set(k, (reasons.get(k) ?? 0) + 1); }
    const m = mean(x.margins), mk = mean(x.markups), qh = mean(x.quoteHours);
    return {
      requests: x.requests, quotesSent: x.quotesSent, won: x.won, lost: x.lost, winRate: x.won + x.lost ? r3(x.won / (x.won + x.lost)) : null,
      lostReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((p, q2) => q2.count - p.count || p.reason.localeCompare(q2.reason, 'tr')),
      avgQuoteBusinessHours: qh == null ? null : r2(qh), quoteTargetBusinessHours: targetHours,
      onTargetRate: x.quoteHours.length ? r3(x.onTarget / x.quoteHours.length) : null,
      avgPlannedMargin: fin && m != null ? r3(m) : null, avgPlannedMarkup: fin && mk != null ? r3(mk) : null,
      plannedProfitEur: fin && x.margins.length ? r2(x.plannedProfit * kAgency) : null,
      realizedProfitEur: fin && x.realizedProjects ? r2(x.realizedEur * kAgency) : null,
      realizedProfitTry: fin && x.realizedTryKnown ? r2(x.realizedTry) : null,
      realizedProjects: fin ? x.realizedProjects : 0, realizedTryMissing: fin ? x.realizedTryMissing : 0,
      quotesBuilt: x.quotesBuilt, quotesReviewed: x.quotesReviewed, quotesCorrected: x.quotesCorrected,
      correctionRate: x.quotesReviewed ? r3(x.quotesCorrected / x.quotesReviewed) : null,
      approvalRequiredQuotes: x.approvalRequired, freeQuotes: x.free, blockedQuotes: x.blocked, historicalProjects: x.historical,
    };
  };
  const rows: TeamPerformanceRow[] = users.map((u) => {
    const x = acc.get(u.id) ?? emptyAcc();
    return { userId: u.id, fullName: u.full_name, role: u.role, authorityLevel: u.authority_level, active: u.active, lostProjects: x.lostProjects, ...toRow(x) };
  }).sort((p, q2) => q2.won - p.won || q2.requests - p.requests || p.fullName.localeCompare(q2.fullName, 'tr'));

  const all = emptyAcc();
  for (const x of acc.values()) {
    for (const k of Object.keys(all) as (keyof PerfAcc)[]) {
      const v = x[k];
      if (Array.isArray(v)) (all[k] as unknown[]).push(...(v as unknown[]));
      else (all[k] as number) += v as number;
    }
  }
  const totals = toRow(all);
  return { from, to, financialsVisible: fin, rows, totals, baseCurrency: agency as TeamPerformanceReport['baseCurrency'], fxNote: agency === 'EUR' ? null : `1 EUR = ${kAgency} ${agency} (${eurFx.source} ${eurFx.date})` };
}

/** Realized profit in TRY from the evidence-based realized-FX feature (null = no proof / feature unavailable — degrade gracefully). */
async function realizedTry(ctx: Ctx, projectId: string): Promise<number | null> {
  try {
    const r = await projectRealizedFx(ctx, projectId);
    const v = r?.profit?.try;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
