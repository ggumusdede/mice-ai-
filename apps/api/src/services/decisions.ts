// §15 Karar kutusu. Services create decision cards; humans decide (approve / edit / reject).
// Effects per decision kind are registered by services/decision-effects.ts (extension point for phase B:
// registerDecisionEffect('payment_approval', ...)).
import type { DecideResponse, Decision, DecisionBadge, DecisionInput, DecisionKind, Role, AiActionType } from '@mice/shared';
import { canDecide, requiresBiometric } from '@mice/domain';
import type { AutomationOutcome } from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { mapDecision, mapDelegation, type Row } from '../lib/mappers.js';
import { verifyStepUp } from '../auth/webauthn.js';
import { recordAutomationOutcome } from './automation.js';
import { recordAiOutcome, recordCorrection } from './ai-log.js';

export interface DecisionSpec {
  projectId?: string | null;
  kind: DecisionKind;
  badge: DecisionBadge;
  summary: string;
  detail?: Record<string, unknown>;
  aiNote?: string | null;
  primaryActionLabel?: string;
  requiredRole?: Role;
  requiresBiometric?: boolean;
  urgent?: boolean;
  entityType?: string | null;
  entityId?: string | null;
  draft?: Record<string, unknown> | null;
  aiActionType?: AiActionType | null;
  aiActionId?: string | null;
  /** set by aiGate when the counter is in 'auto' mode */
  autoExecuted?: boolean;
}

const DEFAULT_LABELS: Partial<Record<DecisionKind, string>> = {
  quote_approval: 'Face ID ile onayla',
  margin_override: 'Gerekçeyle aç',
  contract_diff: 'Revizyon talebini gönder',
  contract_approval: 'Face ID ile onayla',
  condition_risk: 'Riski kabul et',
  payment_approval: 'Face ID ile onayla',
  supplier_accreditation: 'Akredite et',
  automation_promotion: 'Otomatiğe al',
  rfq_send: 'RFQ gönder',
  negotiation_message: 'Pazarlık mesajını onayla',
  outbound_message: 'Mesajı onayla',
  assignment: 'Atamayı onayla',
  checklist_question: 'Listeye ekle',
  rule_suggestion: 'Kuralı uygula',
  low_confidence_review: 'Doğrula',
};

export async function createDecision(ctx: Ctx, spec: DecisionSpec): Promise<Decision> {
  const bio = spec.requiresBiometric ?? requiresBiometric(spec.kind);
  const auto = spec.autoExecuted === true;
  const { rows } = await ctx.db.query(
    `INSERT INTO decisions (tenant_id, project_id, kind, badge, summary, detail, ai_note, primary_action_label, required_role,
       requires_biometric, urgent, entity_type, entity_id, draft, ai_action_type, ai_action_id, created_by,
       status, auto_executed, action, decided_at)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
    [
      spec.projectId ?? null, spec.kind, spec.badge, spec.summary, JSON.stringify(spec.detail ?? {}), spec.aiNote ?? null,
      spec.primaryActionLabel ?? DEFAULT_LABELS[spec.kind] ?? 'Onayla', spec.requiredRole ?? 'admin', bio, spec.urgent ?? false,
      spec.entityType ?? null, spec.entityId ?? null, spec.draft ? JSON.stringify(spec.draft) : null, spec.aiActionType ?? null,
      spec.aiActionId ?? null, ctx.user?.id ?? null, auto ? 'approved' : 'open', auto, auto ? 'approve' : null, auto ? ctx.now() : null,
    ],
  );
  if (spec.aiActionId) await ctx.db.query('UPDATE ai_actions SET decision_id = $2 WHERE id = $1', [spec.aiActionId, rows[0].id]);
  const decision = mapDecision(rows[0]);
  if (!auto) for (const h of createdHooks) await h(ctx, decision);
  return decision;
}

/** Phase B extension point: called after every open decision card is created (push notifications, §15). */
export type DecisionCreatedHook = (ctx: Ctx, decision: Decision) => Promise<void>;
const createdHooks: DecisionCreatedHook[] = [];
export function onDecisionCreated(fn: DecisionCreatedHook): void {
  if (!createdHooks.includes(fn)) createdHooks.push(fn);
}

// ------------------------------------------------------------------ effects registry
export interface EffectInput {
  action: 'approve' | 'edit' | 'reject';
  edits?: Record<string, unknown>;
  reason?: string;
  /** null when executed automatically by aiGate */
  decidedBy: string | null;
  auto?: boolean;
}
export type DecisionEffect = (ctx: Ctx, decision: Row, input: EffectInput) => Promise<string[]>;
const effects = new Map<DecisionKind, DecisionEffect>();

export function registerDecisionEffect(kind: DecisionKind, fn: DecisionEffect): void {
  effects.set(kind, fn);
}

/** The currently registered effect of a kind (lets phase B wrap a phase-A effect). */
export function getDecisionEffect(kind: DecisionKind): DecisionEffect | undefined {
  return effects.get(kind);
}

export async function runDecisionEffect(ctx: Ctx, decision: Row, input: EffectInput): Promise<string[]> {
  const fn = effects.get(decision.kind as DecisionKind);
  if (!fn) return input.action === 'reject' ? ['rejected'] : ['recorded'];
  return fn(ctx, decision, input);
}

// ------------------------------------------------------------------ listing & deciding
async function activeDelegations(ctx: Ctx) {
  const { rows } = await ctx.db.query('SELECT * FROM delegations WHERE ended_at IS NULL AND ends_at > $1', [ctx.now()]);
  return rows.map(mapDelegation);
}

const SELECT_DECISION = `SELECT d.*, p.code AS project_code FROM decisions d LEFT JOIN projects p ON p.id = d.project_id`;

export async function listDecisions(ctx: Ctx, opts: { status?: string; projectId?: string } = {}): Promise<Decision[]> {
  const user = requireUser(ctx);
  const status = opts.status ?? 'open';
  const params: unknown[] = [status];
  let where = 'd.status = $1';
  if (opts.projectId) {
    params.push(opts.projectId);
    where += ` AND d.project_id = $${params.length}`;
  }
  const { rows } = await ctx.db.query(`${SELECT_DECISION} WHERE ${where} ORDER BY d.urgent DESC, d.created_at ASC LIMIT 500`, params);
  const delegations = await activeDelegations(ctx);
  const now = ctx.now();
  return rows
    .map(mapDecision)
    .filter((d) => canDecide(user, { kind: d.kind, requiredRole: d.requiredRole }, delegations, now).allowed);
}

export async function getDecision(ctx: Ctx, id: string): Promise<Decision> {
  const { rows } = await ctx.db.query(`${SELECT_DECISION} WHERE d.id = $1`, [id]);
  if (!rows[0]) throw notFound('Karar');
  return mapDecision(rows[0]);
}

function outcomeFor(kind: string, action: DecisionInput['action']): AutomationOutcome {
  if (kind === 'audit_sample') return action === 'approve' ? 'sample_ok' : 'sample_error';
  return action === 'approve' ? 'approved_clean' : action === 'edit' ? 'edited' : 'rejected';
}

export async function decide(ctx: Ctx, id: string, input: DecisionInput): Promise<DecideResponse> {
  const user = requireUser(ctx);
  const { rows } = await ctx.db.query('SELECT * FROM decisions WHERE id = $1 FOR UPDATE', [id]);
  const row = rows[0];
  if (!row) throw notFound('Karar');
  if (row.status !== 'open') throw conflict('Bu karar zaten verilmiş', 'DECISION_CLOSED');
  const delegations = await activeDelegations(ctx);
  const perm = canDecide(user, { kind: row.kind, requiredRole: row.required_role }, delegations, ctx.now());
  if (!perm.allowed) throw forbidden(perm.reason ?? 'Bu kararı verme yetkiniz yok', 'DECISION_FORBIDDEN');
  if (input.action === 'edit' && (!input.edits || Object.keys(input.edits).length === 0)) {
    throw badRequest('Düzelt eylemi düzeltilmiş içerik gerektirir (edits)', undefined, 'EDITS_REQUIRED');
  }
  if (row.kind === 'margin_override' && input.action !== 'reject' && !input.reason?.trim()) {
    throw badRequest('Hedef marj altı teklif yalnızca gerekçe yazılarak açılabilir', undefined, 'REASON_REQUIRED');
  }
  let bio: { method: string; credentialId: string | null } | null = null;
  if (row.requires_biometric && input.action !== 'reject') bio = await verifyStepUp(ctx, input.biometric);

  const effectList = await runDecisionEffect(ctx, row, {
    action: input.action, edits: input.edits, reason: input.reason, decidedBy: user.id,
  });

  const status = input.action === 'approve' ? 'approved' : input.action === 'edit' ? 'edited' : 'rejected';
  await ctx.db.query(
    `UPDATE decisions SET status = $2, action = $3, edits = $4, reason = $5, decided_by = $6, decided_at = $7, decided_device = $8,
       via_delegation = $9, biometric_method = $10, webauthn_credential_id = $11 WHERE id = $1`,
    [id, status, input.action, input.edits ? JSON.stringify(input.edits) : null, input.reason ?? null, user.id, ctx.now(),
      input.device ?? ctx.actor.device ?? null, perm.viaDelegation, bio?.method ?? null, bio?.credentialId ?? null],
  );

  // §16: every human outcome on an AI suggestion feeds the automation counter; edits are learning data.
  if (row.ai_action_type) {
    const outcome = outcomeFor(row.kind, input.action);
    effectList.push(...(await recordAutomationOutcome(ctx, row.ai_action_type, outcome, id)));
    if (input.action === 'edit') await recordCorrection(ctx, row.ai_action_id, { edits: input.edits, draft: row.draft }, outcome);
    else await recordAiOutcome(ctx, row.ai_action_id, outcome);
  }
  return { decision: await getDecision(ctx, id), effects: effectList };
}

/** Closes open decisions about an entity that became moot (e.g. quote superseded). */
export async function expireDecisionsFor(ctx: Ctx, entityType: string, entityId: string, kinds?: DecisionKind[]): Promise<void> {
  await ctx.db.query(
    `UPDATE decisions SET status = 'expired' WHERE status = 'open' AND entity_type = $1 AND entity_id = $2 AND ($3::text[] IS NULL OR kind = ANY($3))`,
    [entityType, entityId, kinds ?? null],
  );
}
