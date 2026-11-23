// v0.5 S-10 / S-11 / S-12 / D-2 — performance views on top of the Q7 team report (services/reports.ts):
//  - admin: the named report + per sub-team aggregate (quote quality attributed to the author AND their team);
//  - team leader: their own team only (alphabetical, no rank numbers);
//  - everyone: "Benim panom" — own figures only, never other names (S-10), optional estimated bonus (S-11 showEstimatedBonus);
//  - promise keeping towards suppliers ("söz tutma") at agency / project level only — never per person (S-12).
import type { MyPerformance, PromiseKeepingReport, PromiseKeepingScore, TeamPerformanceReport, TeamPerformanceTeamRow } from '@mice/shared';
import { bonusExplanation, estimatedBonus, localDate, promiseKeepingScore } from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { forbidden } from '../errors.js';
import { teamPerformance } from './reports.js';
import { canSeeFinancials } from './visibility.js';

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;
export const FAIR_METRIC_NOTE = 'Bu rakamlar insan değerlendirmesinin girdisidir; otomatik yaptırım dayanağı değildir. Karar bekleme süreleri kişiye yazılmaz.';

type Row = TeamPerformanceReport['rows'][number];

function teamRow(teamId: string, name: string, leaderName: string | null, rows: Row[]): TeamPerformanceTeamRow {
  const sum = (k: keyof Row) => rows.reduce((s, r) => s + (Number(r[k] ?? 0) || 0), 0);
  const sumOrNull = (k: 'plannedProfitEur' | 'realizedProfitEur') => (rows.some((r) => r[k] != null) ? r2(rows.reduce((s, r) => s + Number(r[k] ?? 0), 0)) : null);
  const won = sum('won'), lost = sum('lost'), reviewed = sum('quotesReviewed'), corrected = sum('quotesCorrected');
  return {
    teamId, name, leaderName, memberCount: rows.length, requests: sum('requests'), quotesSent: sum('quotesSent'), won, lost,
    winRate: won + lost ? r3(won / (won + lost)) : null, quotesBuilt: sum('quotesBuilt'), quotesReviewed: reviewed, quotesCorrected: corrected,
    correctionRate: reviewed ? r3(corrected / reviewed) : null, approvalRequiredQuotes: sum('approvalRequiredQuotes'), freeQuotes: sum('freeQuotes'),
    blockedQuotes: sum('blockedQuotes'), plannedProfitEur: sumOrNull('plannedProfitEur'), realizedProfitEur: sumOrNull('realizedProfitEur'),
  };
}

async function teamsOf(ctx: Ctx): Promise<{ teams: { id: string; name: string; leader_id: string | null; leader_name: string | null }[]; userTeam: Map<string, string | null> }> {
  const teams = (await ctx.db.query(`SELECT t.id, t.name, t.leader_id, l.full_name AS leader_name FROM teams t LEFT JOIN users l ON l.id = t.leader_id WHERE t.active ORDER BY t.name`)).rows;
  const userTeam = new Map<string, string | null>((await ctx.db.query('SELECT id, team_id FROM users')).rows.map((r) => [r.id, r.team_id ?? null]));
  return { teams, userTeam };
}

/** D-2: adds the per-team aggregate (and each row's team) to the Q7 report. */
export async function withTeams(ctx: Ctx, rep: TeamPerformanceReport): Promise<TeamPerformanceReport> {
  const { teams, userTeam } = await teamsOf(ctx);
  return {
    ...rep,
    userTeams: Object.fromEntries(rep.rows.map((r) => [r.userId, userTeam.get(r.userId) ?? null])),
    teams: teams.map((t) => teamRow(t.id, t.name, t.leader_name, rep.rows.filter((r) => userTeam.get(r.userId) === t.id))),
  };
}

/** Team leader: their own team only, alphabetical (no ranking). */
export async function myTeamPerformance(ctx: Ctx, q: { from?: string; to?: string }): Promise<TeamPerformanceReport> {
  const user = requireUser(ctx);
  const team = (await ctx.db.query('SELECT id, name FROM teams WHERE active AND leader_id = $1 LIMIT 1', [user.id])).rows[0];
  if (!team) throw forbidden('Bu görünüm yalnız ekip lideri içindir', 'NOT_TEAM_LEADER');
  const rep = await withTeams(ctx, await teamPerformance(ctx, q));
  const rows = rep.rows.filter((r) => rep.userTeams?.[r.userId] === team.id).sort((a, b) => a.fullName.localeCompare(b.fullName, 'tr'));
  const t = rep.teams?.find((x) => x.teamId === team.id);
  return { ...rep, rows, teams: t ? [t] : [], totals: { ...rep.totals, ...(t ? { requests: t.requests, quotesSent: t.quotesSent, won: t.won, lost: t.lost, winRate: t.winRate, quotesBuilt: t.quotesBuilt, quotesReviewed: t.quotesReviewed, quotesCorrected: t.quotesCorrected, correctionRate: t.correctionRate, approvalRequiredQuotes: t.approvalRequiredQuotes, freeQuotes: t.freeQuotes, blockedQuotes: t.blockedQuotes, plannedProfitEur: t.plannedProfitEur, realizedProfitEur: t.realizedProfitEur } : {}) } };
}

/** S-10 "Benim panom": own figures only; S-11 estimated bonus when the agency enabled it. */
export async function myPerformance(ctx: Ctx, q: { from?: string; to?: string }): Promise<MyPerformance> {
  const user = requireUser(ctx);
  const rules = await ctx.rules();
  const rep = await teamPerformance(ctx, q);
  const mine = rep.rows.find((r) => r.userId === user.id) ?? null;
  const team = (await ctx.db.query('SELECT t.name FROM users u JOIN teams t ON t.id = u.team_id AND t.active WHERE u.id = $1', [user.id])).rows[0];
  let bonus: MyPerformance['estimatedBonus'] = null;
  if (rules.showEstimatedBonus && mine && (await canSeeFinancials(ctx))) {
    const collected = (await ctx.db.query(
      `SELECT sum(ci.s - COALESCE(si.s, 0)) AS profit FROM projects p
         JOIN LATERAL (SELECT sum(amount_eur) AS s, bool_and(status IN ('paid', 'matched')) AS all_paid FROM finance_entries
                        WHERE project_id = p.id AND kind = 'customer_invoice' AND status <> 'cancelled') ci ON ci.s IS NOT NULL
         LEFT JOIN LATERAL (SELECT sum(amount_eur) AS s FROM finance_entries WHERE project_id = p.id AND kind = 'supplier_invoice' AND status <> 'cancelled') si ON true
        WHERE p.owner_id = $1 AND p.outcome IN ('won', 'closed') AND ci.all_paid AND COALESCE(p.end_date, p.start_date) BETWEEN $2::date AND $3::date`,
      [user.id, rep.from, rep.to])).rows[0];
    const amount = estimatedBonus(rules.bonusFormula, {
      realizedProfit: mine.realizedProfitEur, realizedCollectedProfit: collected?.profit != null ? Number(collected.profit) : 0, plannedProfit: mine.plannedProfitEur,
    });
    if (amount != null) bonus = { amount, currency: 'EUR', ...rules.bonusFormula, explanation: bonusExplanation(rules.bonusFormula) };
  }
  let row: MyPerformance['row'] = null;
  if (mine) {
    const { fullName: _n, role: _r, authorityLevel: _a, active: _ac, ...own } = mine;
    row = own;
  }
  return { from: rep.from, to: rep.to, row, estimatedBonus: bonus, teamName: team?.name ?? null, note: FAIR_METRIC_NOTE };
}

/** S-12 tedarikçiye söz tutma: supplier payments paid by their due date + option cards handled before the option date. */
export async function promiseKeeping(ctx: Ctx): Promise<PromiseKeepingReport> {
  const user = requireUser(ctx);
  if (user.role === 'field') throw forbidden('Bu rapor saha rolüne açık değil');
  const rules = await ctx.rules();
  const today = localDate(ctx.now(), rules.businessHours.timezone);
  const pay = (await ctx.db.query(
    `SELECT project_id, count(*)::int AS due, count(*) FILTER (WHERE status IN ('paid', 'matched'))::int AS ok FROM finance_entries
      WHERE kind IN ('payable', 'supplier_invoice') AND status <> 'cancelled' AND due_date IS NOT NULL AND due_date < $1::date AND project_id IS NOT NULL
      GROUP BY project_id`, [today])).rows;
  const opt = (await ctx.db.query(
    `SELECT project_id, count(*)::int AS due,
            count(*) FILTER (WHERE status <> 'open' AND status <> 'expired' AND decided_at::date <= (detail->>'optionUntil')::date)::int AS ok
       FROM decisions WHERE project_id IS NOT NULL AND detail ? 'optionUntil' AND (detail->>'optionUntil') ~ '^\\d{4}-\\d{2}-\\d{2}' AND (detail->>'optionUntil')::date < $1::date
      GROUP BY project_id`, [today])).rows;
  const ids = [...new Set([...pay, ...opt].map((r) => r.project_id as string))];
  const projects = ids.length ? (await ctx.db.query('SELECT id, code, title FROM projects WHERE id = ANY($1)', [ids])).rows : [];
  const score = (p: { due: number; ok: number } | undefined, o: { due: number; ok: number } | undefined): PromiseKeepingScore => {
    const x = { paymentsDue: p?.due ?? 0, paymentsOnTime: p?.ok ?? 0, optionsDue: o?.due ?? 0, optionsHandled: o?.ok ?? 0 };
    return { ...x, score: promiseKeepingScore(x) };
  };
  const sumOf = (rows: { due: number; ok: number }[]) => ({ due: rows.reduce((s, r) => s + r.due, 0), ok: rows.reduce((s, r) => s + r.ok, 0) });
  return {
    agency: score(sumOf(pay), sumOf(opt)),
    projects: projects.map((p) => ({ projectId: p.id, code: p.code, title: p.title, ...score(pay.find((r) => r.project_id === p.id), opt.find((r) => r.project_id === p.id)) }))
      .sort((a, b) => (a.score ?? 101) - (b.score ?? 101)),
    note: 'Acenta ve proje düzeyinde; kişi sıralamasına girmez. Opsiyonu çoğu zaman müşterinin veya yöneticinin geç kararı kaçırır.',
  };
}
