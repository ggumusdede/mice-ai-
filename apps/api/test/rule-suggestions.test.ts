// §16.5 Kural önerisi üreticisi: weekly idempotent generator → admin-only 'rule_suggestion' decisions with evidence;
// the effect applies the patch only through the admin path (audited) and AI actors stay blocked (rules_change_guard).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, closeApp, login, makeApp, newTenant, ownerSql, resetClock, clock, type Client, type TestApp } from './helpers.js';
import { withSystemCtx } from '../src/context.js';
import { runFollowupsForTenant } from '../src/worker.js';
import { setRule } from '../src/services/rules.js';
import { runDecisionEffect } from '../src/services/decisions.js';
import { generateRuleSuggestions } from '../src/services/rule-suggestions.js';

let T: TestApp;
let t: Awaited<ReturnType<typeof newTenant>>;
let admin: Client, clerk: Client;

async function seedSeasonPattern(supplierId: string): Promise<void> {
  // Jan–Feb: 8 stays at 18–21% under the channel price; Jun–Aug: 6 stays at ~5%
  const rows: [string, number][] = [];
  for (const [m, advs] of [['01', [0.18, 0.19, 0.2, 0.21]], ['02', [0.18, 0.19, 0.2, 0.21]], ['06', [0.04, 0.06]], ['07', [0.05, 0.05]], ['08', [0.04, 0.06]]] as const) {
    advs.forEach((a, i) => rows.push([`2026-${m}-${String(10 + i).padStart(2, '0')}`, a]));
  }
  for (const [d, a] of rows) {
    await ownerSql(
      `INSERT INTO channel_prices (tenant_id, supplier_id, stay_date, room_type, board, cancellation, price, currency, price_eur, source)
       VALUES ($1,$2,$3,'DBL','BB','flexible',200,'EUR',200,'test')`, [t.tenantId, supplierId, d]);
    await ownerSql(
      `INSERT INTO price_history (tenant_id, supplier_id, kind, description, service_date, room_type, board, unit, price_type, unit_price, currency, unit_price_eur, verified)
       VALUES ($1,$2,'accommodation','Oda DBL BB',$3,'DBL','BB','room_night','negotiated',$4,'EUR',$4,true)`, [t.tenantId, supplierId, d, Math.round(200 * (1 - a) * 100) / 100]);
  }
}

async function seedMarginOverrides(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await ownerSql(
      `INSERT INTO decisions (tenant_id, kind, badge, summary, detail, primary_action_label, required_role, status, action, decided_at, created_at, decided_by)
       VALUES ($1,'margin_override','critical','test',$2::jsonb,'Gerekçeyle aç','admin',$3,$4,now(),$5,$6)`,
      [t.tenantId, JSON.stringify({ options: [{ optionNo: 1, totals: { margin: 0.068 + (i % 3) * 0.002 } }] }), i === 9 ? 'rejected' : 'approved', i === 9 ? 'reject' : 'approve',
        new Date(clock.now.getTime() - (i + 1) * 86_400_000), t.users.admin.id]);
  }
}

beforeAll(async () => {
  T = await makeApp();
  t = await newTenant('rulesugg');
  admin = client(T.app, await login(T.app, t.users.admin.email));
  clerk = client(T.app, await login(T.app, t.users.clerk.email));
  resetClock();
  await seedSeasonPattern(t.suppliers.moda);
  await seedMarginOverrides();
});
afterAll(() => closeApp(T));

const openRuleCards = async () => (await admin.get('/api/decisions')).body.items.filter((d: any) => d.kind === 'rule_suggestion');

describe('§16.5 rule suggestion generator', () => {
  it('only an admin can run it; it opens admin-only cards with evidence rows', async () => {
    expect((await clerk.post('/api/rules/suggestions/run')).status).toBe(403);
    const r = await admin.post('/api/rules/suggestions/run');
    expect(r.status).toBe(200);
    expect(r.body.created.length).toBeGreaterThanOrEqual(2);
    const cards = await openRuleCards();
    const season = cards.find((d: any) => d.detail.suggestionKind === 'supplier_season_markup');
    expect(season.summary).toMatch(/Moda Sahil Otel Ocak–Şubat'ta ortalama %19\.5 avantaj veriyor/);
    expect(season.requiredRole).toBe('admin');
    expect(season.badge).toBe('suggestion');
    expect(season.detail.evidence.rows).toHaveLength(8);
    expect(season.detail.evidence.columns.map((c: any) => c.key)).toContain('advantage');
    expect(season.detail.scope).toMatchObject({ supplierName: 'Moda Sahil Otel', months: [1, 2] });
    expect(season.aiNote).toMatch(/Yalnızca yönetici onayıyla/);
    const margin = cards.find((d: any) => d.detail.suggestionKind === 'target_margin');
    expect(margin.detail.proposedValue).toBe(0.065);
    // clerk does not see admin-only cards
    expect((await clerk.get('/api/decisions')).body.items.some((d: any) => d.kind === 'rule_suggestion')).toBe(false);
    const rows = await ownerSql(`SELECT * FROM rule_suggestions WHERE tenant_id = $1 AND source = 'generator'`, [t.tenantId]);
    expect(rows.length).toBe(r.body.created.length);
    expect(rows.every((x) => x.status === 'open' && x.decision_id && x.fingerprint && x.patch)).toBe(true);
  });

  it('is idempotent: open identical suggestions are not re-created; weekly report counts them', async () => {
    const before = (await openRuleCards()).length;
    const again = await admin.post('/api/rules/suggestions/run');
    expect(again.body.created).toEqual([]);
    expect(again.body.skipped.every((s: any) => s.reason === 'open')).toBe(true);
    expect((await openRuleCards()).length).toBe(before);
    const rep = await admin.get('/api/reports/weekly');
    expect(rep.status).toBe(200);
    expect(rep.body.pending.rules).toBe(before);
  });

  it('worker runs it at most once a week per tenant (job_runs)', async () => {
    const first = await runFollowupsForTenant(T.app.deps, t.tenantId, clock.now);
    expect(first).toContain('rule_suggestions:0'); // nothing new (all open)
    const second = await runFollowupsForTenant(T.app.deps, t.tenantId, new Date(clock.now.getTime() + 3_600_000));
    expect(second.some((x) => x.startsWith('rule_suggestions:'))).toBe(false);
    const later = await runFollowupsForTenant(T.app.deps, t.tenantId, new Date(clock.now.getTime() + 8 * 86_400_000));
    expect(later.some((x) => x.startsWith('rule_suggestions:'))).toBe(true);
    expect((await ownerSql(`SELECT count(*)::int AS n FROM job_runs WHERE tenant_id = $1 AND job = 'rule_suggestions_weekly'`, [t.tenantId]))[0].n).toBe(2);
  });

  it('approve applies the scoped override through the admin path (audited); evaluation then uses it', async () => {
    const season = (await openRuleCards()).find((d: any) => d.detail.suggestionKind === 'supplier_season_markup');
    const r = await admin.post(`/api/decisions/${season.id}/decide`, { action: 'approve' });
    expect(r.status).toBe(200);
    expect(r.body.effects).toContain('rule_changed:supplierSeasonMarkups');
    const rules = (await admin.get('/api/rules')).body;
    expect(rules.supplierSeasonMarkups).toEqual([expect.objectContaining({ supplierId: t.suppliers.moda, months: [1, 2], markup: 0.2 })]);
    const audit = await admin.get('/api/audit?entity=rules');
    expect(audit.body.items.some((a: any) => a.after?.key === 'supplierSeasonMarkups' && a.actorId === t.users.admin.id)).toBe(true);
    const row = (await ownerSql(`SELECT status, decided_at FROM rule_suggestions WHERE decision_id = $1`, [season.id]))[0];
    expect(row.status).toBe('accepted');
    expect(row.decided_at).toBeTruthy();
  });

  it('reject → identical suggestion is not proposed again within the cooldown', async () => {
    const margin = (await openRuleCards()).find((d: any) => d.detail.suggestionKind === 'target_margin');
    expect((await admin.post(`/api/decisions/${margin.id}/decide`, { action: 'reject', reason: 'Marj politikası değişmeyecek' })).body.effects).toContain('rule_suggestion_rejected');
    expect((await admin.get('/api/rules')).body.targetMarginMin).toBe(0.08);
    const r = await withSystemCtx(T.app.deps, t.tenantId, { type: 'system', id: null }, (ctx) => generateRuleSuggestions(ctx, clock.now));
    expect(r.created).toEqual([]);
    expect(r.skipped.some((s) => s.reason === 'rejected_recently')).toBe(true);
  });

  it('§6: AI actors can never change rules — effect refuses auto execution, DB guard refuses AI writes', async () => {
    await ownerSql(`UPDATE rule_suggestions SET status = 'open' WHERE tenant_id = $1 AND kind = 'target_margin'`, [t.tenantId]);
    const d = (await ownerSql(`SELECT d.* FROM decisions d JOIN rule_suggestions s ON s.decision_id = d.id WHERE s.tenant_id = $1 AND s.kind = 'target_margin'`, [t.tenantId]))[0];
    await expect(withSystemCtx(T.app.deps, t.tenantId, { type: 'ai', id: null }, (ctx) => runDecisionEffect(ctx, d, { action: 'approve', decidedBy: null, auto: true })))
      .rejects.toMatchObject({ code: 'AI_FORBIDDEN_ACTION' });
    // even with a (forged) decidedBy, a non-user actor is refused by the effect
    await expect(withSystemCtx(T.app.deps, t.tenantId, { type: 'ai', id: null }, (ctx) => runDecisionEffect(ctx, d, { action: 'approve', decidedBy: t.users.admin.id })))
      .rejects.toMatchObject({ code: 'AI_FORBIDDEN_ACTION' });
    await expect(withSystemCtx(T.app.deps, t.tenantId, { type: 'ai', id: null }, (ctx) => setRule(ctx.db, 'targetMarginMin', 0.01, t.users.admin.id, 'x')))
      .rejects.toMatchObject({ code: 'MI006' });
    expect((await admin.get('/api/rules')).body.targetMarginMin).toBe(0.08);
  });

  it('stale suggestion: rule changed after the suggestion → refused with a clear error', async () => {
    const d = (await ownerSql(`SELECT d.id FROM decisions d JOIN rule_suggestions s ON s.decision_id = d.id WHERE s.tenant_id = $1 AND s.kind = 'target_margin'`, [t.tenantId]))[0];
    await ownerSql(`UPDATE decisions SET status = 'open', action = NULL, decided_by = NULL WHERE id = $1`, [d.id]);
    expect((await admin.patch('/api/rules', { targetMarginMin: 0.09, reason: 'politika' })).status).toBe(200);
    const r = await admin.post(`/api/decisions/${d.id}/decide`, { action: 'approve' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('RULE_SUGGESTION_STALE');
    expect((await admin.get('/api/rules')).body.targetMarginMin).toBe(0.09);
  });
});
