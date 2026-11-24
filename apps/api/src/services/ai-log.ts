// Every AI call is logged in ai_actions (§6 confidence, §16 corrections = learning data).
import { aiAuthorityOf, type AiActionType } from '@mice/shared';
import type { AiResult } from '@mice/ai';
import type { Ctx } from '../context.js';

export interface LogAiInput {
  actionType: AiActionType;
  result?: Pick<AiResult<unknown>, 'confidence' | 'model' | 'tokens' | 'data'> | null;
  projectId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  inputSummary?: Record<string, unknown>;
  mode?: 'autonomous' | 'approval' | 'auto' | 'blocked';
  decisionId?: string | null;
}

export async function logAiAction(ctx: Ctx, input: LogAiInput): Promise<string> {
  const authority = aiAuthorityOf(input.actionType);
  const mode = input.mode ?? (authority === 'autonomous' ? 'autonomous' : authority === 'forbidden' ? 'blocked' : 'approval');
  const { rows } = await ctx.db.query(
    `INSERT INTO ai_actions (tenant_id, project_id, action_type, authority, mode, model, confidence, input_summary, output,
       entity_type, entity_id, decision_id, tokens, created_by)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [
      input.projectId ?? null, input.actionType, authority, mode, input.result?.model ?? null,
      input.result?.confidence ?? null, input.inputSummary ? JSON.stringify(input.inputSummary) : null,
      input.result ? JSON.stringify(input.result.data ?? null) : null, input.entityType ?? null, input.entityId ?? null,
      input.decisionId ?? null, input.result?.tokens ? JSON.stringify(input.result.tokens) : null, ctx.user?.id ?? null,
    ],
  );
  return rows[0].id;
}

export async function attachAiActionEntity(ctx: Ctx, aiActionId: string, entityType: string, entityId: string): Promise<void> {
  await ctx.db.query('UPDATE ai_actions SET entity_type = $2, entity_id = $3 WHERE id = $1', [aiActionId, entityType, entityId]);
}

/** A human corrected an AI output (draft edit, verified reading, edited decision) → learning data (§16.4). */
export async function recordCorrection(ctx: Ctx, aiActionId: string | null, correction: unknown, outcome?: string): Promise<void> {
  if (!aiActionId) return;
  await ctx.db.query(
    `UPDATE ai_actions SET corrected = true, correction = $2, corrected_by = $3, corrected_at = now(), outcome = COALESCE($4, outcome) WHERE id = $1`,
    [aiActionId, JSON.stringify(correction), ctx.user?.id ?? null, outcome ?? null],
  );
}

export async function recordAiOutcome(ctx: Ctx, aiActionId: string | null, outcome: string): Promise<void> {
  if (!aiActionId) return;
  await ctx.db.query('UPDATE ai_actions SET outcome = $2 WHERE id = $1', [aiActionId, outcome]);
}
