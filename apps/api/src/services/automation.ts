// §16 Kendini geliştiren yapı: counters per AI action type, promotion proposals, ~1/20 sample audit, auto-demotion.
// Every suggest-type AI action passes through aiGate(). Forbidden actions (§6) can never be executed by AI paths.
import { aiAuthorityOf, isPromotable, type AiActionType, type AutomationCounter, type DecisionKind } from '@mice/shared';
import { applyAutomationOutcome, promote, shouldSample, type AutomationOutcome } from '@mice/domain';
import type { Ctx } from '../context.js';
import { setActor } from '../db/pool.js';
import { forbidden } from '../errors.js';
import { mapCounter } from '../lib/mappers.js';
import { createDecision, runDecisionEffect, type DecisionSpec } from './decisions.js';
import { logAiAction } from './ai-log.js';
import type { Decision } from '@mice/shared';
import { mapDecision } from '../lib/mappers.js';

/** Decision kinds whose effect is a §6 FORBIDDEN action for AI (money, contract, accreditation, rules, automation itself).
 *  aiGate refuses to auto-execute them no matter what the counter says. */
export const NEVER_AUTO_KINDS: ReadonlySet<DecisionKind> = new Set<DecisionKind>([
  'supplier_accreditation', 'payment_approval', 'contract_approval', 'contract_diff', 'condition_risk', 'rule_suggestion',
  'margin_override', 'automation_promotion', 'automation_demotion', 'audit_sample', 'field_extra', 'unbilled_payment_escalation',
  'low_supplier_score', 'closing_overdue',
]);

export function assertAiMayExecute(actionType: string, kind?: DecisionKind): void {
  const authority = aiAuthorityOf(actionType);
  if (authority === 'forbidden') throw forbidden(`Yapay zekâ bu işlemi yapamaz (§6 yasak liste): ${actionType}`, 'AI_FORBIDDEN_ACTION');
  if (kind && NEVER_AUTO_KINDS.has(kind)) throw forbidden(`Yapay zekâ bu karar türünü otomatik uygulayamaz: ${kind}`, 'AI_FORBIDDEN_ACTION');
}

export async function getCounter(ctx: Ctx, actionType: AiActionType): Promise<AutomationCounter & { id: string }> {
  const rules = await ctx.rules();
  await ctx.db.query(
    `INSERT INTO automation_counters (tenant_id, action_type, threshold, sample_rate) VALUES (app_tenant_id(), $1, $2, $3)
     ON CONFLICT (tenant_id, action_type) DO NOTHING`,
    [actionType, rules.automationPromotionThreshold, rules.automationSampleRate],
  );
  const { rows } = await ctx.db.query('SELECT * FROM automation_counters WHERE action_type = $1 FOR UPDATE', [actionType]);
  return { ...mapCounter(rows[0]), id: rows[0].id };
}

async function saveCounter(ctx: Ctx, c: AutomationCounter, extra: { promotedBy?: string | null; demotedReason?: string | null } = {}): Promise<void> {
  await ctx.db.query(
    `UPDATE automation_counters SET mode = $2, consecutive_clean = $3, threshold = $4, sample_rate = $5, promoted_at = $6,
       demoted_at = $7, total_auto = $8, total_sampled = $9, sample_errors = $10,
       promoted_by = COALESCE($11, promoted_by), demoted_reason = COALESCE($12, demoted_reason)
     WHERE action_type = $1`,
    [c.actionType, c.mode, c.consecutiveClean, c.threshold, c.sampleRate, c.promotedAt, c.demotedAt, c.totalAuto, c.totalSampled,
      c.sampleErrors, extra.promotedBy ?? null, extra.demotedReason ?? null],
  );
}

async function event(ctx: Ctx, actionType: string, ev: string, decisionId: string | null): Promise<void> {
  await ctx.db.query('INSERT INTO automation_events (tenant_id, action_type, event, decision_id) VALUES (app_tenant_id(), $1, $2, $3)', [actionType, ev, decisionId]);
}

/** Applies an outcome to the counter; proposes promotion / records demotion as decisions. */
export async function recordAutomationOutcome(ctx: Ctx, actionType: AiActionType, outcome: AutomationOutcome, decisionId: string | null): Promise<string[]> {
  const effects: string[] = [];
  const counter = await getCounter(ctx, actionType);
  const t = applyAutomationOutcome(counter, outcome, ctx.now());
  await saveCounter(ctx, t.counter, t.demoted ? { demotedReason: outcome } : {});
  await event(ctx, actionType, outcome, decisionId);
  if (t.demoted) {
    await event(ctx, actionType, 'demoted', decisionId);
    await createDecision(ctx, {
      kind: 'automation_demotion', badge: 'critical', urgent: true,
      summary: `Otomasyon geri alındı: ${actionType} yeniden onay moduna döndü`,
      detail: { actionType, reason: outcome, sourceDecisionId: decisionId },
      primaryActionLabel: 'Anladım', requiredRole: 'admin',
    });
    effects.push(`automation_demoted:${actionType}`);
  }
  if (t.proposePromotion && isPromotable(actionType)) {
    const open = await ctx.db.query(
      `SELECT 1 FROM decisions WHERE kind = 'automation_promotion' AND status = 'open' AND detail->>'actionType' = $1`, [actionType]);
    if (!open.rowCount) {
      await createDecision(ctx, {
        kind: 'automation_promotion', badge: 'suggestion',
        summary: `"${actionType}" ${t.counter.consecutiveClean} kez düzeltmesiz onaylandı. Artık otomatik yapayım mı?`,
        detail: { actionType, consecutiveClean: t.counter.consecutiveClean, threshold: t.counter.threshold, sampleRate: t.counter.sampleRate },
        aiNote: `Otomatiğe geçerse yaklaşık her ${Math.round(1 / (t.counter.sampleRate || 0.05))} işten biri örneklem denetimine gelir; hata görülürse otomatik geri dönülür.`,
        primaryActionLabel: 'Otomatiğe al', requiredRole: 'admin',
      });
      effects.push(`automation_promotion_proposed:${actionType}`);
    }
  }
  return effects;
}

export async function promoteAction(ctx: Ctx, actionType: AiActionType, adminId: string): Promise<void> {
  if (!isPromotable(actionType)) throw forbidden(`${actionType} otomatiğe alınamaz (§16: yasak/otonom liste)`, 'NOT_PROMOTABLE');
  const counter = await getCounter(ctx, actionType);
  await saveCounter(ctx, promote(counter, ctx.now()), { promotedBy: adminId });
  await event(ctx, actionType, 'promoted', null);
}

export interface GateResult {
  mode: 'approval' | 'auto';
  decision: Decision;
  effects: string[];
}

/**
 * Single entry point for every SUGGEST-type AI action (§6 "Öneri", §16).
 *  - counter mode 'approval' → an open decision card is created for a human.
 *  - counter mode 'auto'     → the decision's effect is executed immediately (actor = ai), recorded as an auto-executed
 *                              decision, and ~sampleRate of them are sent to the admin as 'audit_sample'.
 *  - forbidden actions / kinds → refused.
 */
export async function aiGate(ctx: Ctx, actionType: AiActionType, spec: DecisionSpec & { forceApproval?: boolean }): Promise<GateResult> {
  const authority = aiAuthorityOf(actionType);
  if (authority === 'forbidden') {
    await logAiAction(ctx, { actionType, mode: 'blocked', projectId: spec.projectId ?? null, inputSummary: { kind: spec.kind } });
    throw forbidden(`Yapay zekâ bu işlemi yapamaz (§6 yasak liste): ${actionType}`, 'AI_FORBIDDEN_ACTION');
  }
  if (authority !== 'suggest') throw forbidden(`aiGate yalnızca öneri türü işler içindir: ${actionType}`, 'AI_GATE_MISUSE');
  const counter = await getCounter(ctx, actionType);
  const canAuto = counter.mode === 'auto' && !spec.forceApproval && !NEVER_AUTO_KINDS.has(spec.kind);
  if (!canAuto) {
    const decision = await createDecision(ctx, { ...spec, aiActionType: actionType });
    return { mode: 'approval', decision, effects: [] };
  }
  assertAiMayExecute(actionType, spec.kind);
  const decision = await createDecision(ctx, { ...spec, aiActionType: actionType, autoExecuted: true });
  const prevActor = ctx.actor;
  await setActor(ctx.db, { type: 'ai', id: null });
  let effects: string[];
  try {
    const row = (await ctx.db.query('SELECT * FROM decisions WHERE id = $1', [decision.id])).rows[0];
    effects = await runDecisionEffect(ctx, row, { action: 'approve', decidedBy: null, auto: true });
  } finally {
    await setActor(ctx.db, prevActor);
  }
  counter.totalAuto += 1;
  const sampled = shouldSample(counter.sampleRate, ctx.deps.rng);
  if (sampled) counter.totalSampled += 1;
  await saveCounter(ctx, counter);
  await event(ctx, actionType, 'auto_executed', decision.id);
  if (sampled) {
    await createDecision(ctx, {
      projectId: spec.projectId ?? null, kind: 'audit_sample', badge: 'suggestion',
      summary: `Örneklem denetimi: ${spec.summary}`,
      detail: { sampledDecisionId: decision.id, kind: spec.kind, actionType, original: spec.detail ?? {} },
      aiNote: 'Otomatik yapılan bir iş rastgele seçildi. Doğruysa onaylayın; hatalıysa reddedin (iş türü onay moduna döner).',
      primaryActionLabel: 'Doğru', requiredRole: 'admin', aiActionType: actionType,
      entityType: 'decision', entityId: decision.id,
    });
    effects.push('audit_sample_created');
  }
  const fresh = (await ctx.db.query('SELECT * FROM decisions WHERE id = $1', [decision.id])).rows[0];
  return { mode: 'auto', decision: mapDecision(fresh), effects };
}
