// Wires decision-kind effects and document generators. Called once by buildApp() / the worker.
// Phase B adds: payment_approval, field_extra, unbilled_payment_escalation, low_supplier_score, closing_overdue effects
// and program / rooming_list / customer_invoice_draft / supplier_confirmation document generators.
import type { AiActionType, TenantRules } from '@mice/shared';
import { isPromotable } from '@mice/shared';
import { registerDecisionEffect, type DecisionEffect } from './decisions.js';
import { accreditSupplier } from './suppliers.js';
import { applyMarginOverride, approveQuote, registerQuoteDocuments, rejectQuote, returnQuoteForEdit } from './quotes.js';
import { rejectRfqs, sendApprovedRfqs } from './rfqs.js';
import { approveDraft, discardDraft, getDraftRow, sendDraft } from './drafts.js';
import { assignProject } from './projects.js';
import { promoteAction, recordAutomationOutcome } from './automation.js';
import { acceptConditionRisk, approveContract } from './contracts.js';
import { verifyOffer } from './offers.js';
import { setRule } from './rules.js';
import { forbidden } from '../errors.js';
import { registerPhaseB } from './phase-b-registry.js';

let registered = false;

/** approve/edit → approve the draft (with edits) and send it from the responsible user's address; reject → discard. */
const draftEffect: DecisionEffect = async (ctx, d, input) => {
  const draftId = (d.detail?.draftId as string | undefined) ?? (d.entity_type === 'message_draft' ? d.entity_id : null);
  if (!draftId) return ['no_draft'];
  if (input.action === 'reject') {
    await discardDraft(ctx, draftId);
    if (d.kind === 'negotiation_message') await ctx.db.query(`UPDATE negotiation_rounds SET status = 'rejected' WHERE draft_id = $1`, [draftId]);
    return ['draft_discarded'];
  }
  await approveDraft(ctx, draftId, input.decidedBy, input.action === 'edit' ? input.edits : undefined);
  const out = ['draft_approved'];
  const draft = await getDraftRow(ctx, draftId);
  if (d.kind === 'negotiation_message') await ctx.db.query(`UPDATE negotiation_rounds SET status = 'approved' WHERE draft_id = $1`, [draftId]);
  if (draft.to_address) {
    await sendDraft(ctx, draftId, { approvedByDecision: true, fromUserId: draft.from_user_id ?? undefined, autonomous: input.auto });
    if (d.kind === 'negotiation_message') await ctx.db.query(`UPDATE negotiation_rounds SET status = 'sent' WHERE draft_id = $1`, [draftId]);
    out.push('draft_sent');
  }
  return out;
};

export function registerAll(): void {
  if (registered) return;
  registered = true;
  registerQuoteDocuments();

  registerDecisionEffect('quote_approval', async (ctx, d, input) => {
    const quoteId = d.entity_id as string;
    if (input.action === 'approve') return approveQuote(ctx, quoteId, input.decidedBy, d.id);
    if (input.action === 'edit') return returnQuoteForEdit(ctx, quoteId, JSON.stringify(input.edits ?? {}));
    return rejectQuote(ctx, quoteId);
  });

  registerDecisionEffect('margin_override', async (ctx, d, input) => {
    if (input.action === 'reject') return ['margin_override_rejected'];
    return applyMarginOverride(ctx, d.entity_id, input.decidedBy!, input.reason!);
  });

  registerDecisionEffect('supplier_accreditation', async (ctx, d, input) => {
    if (input.auto || !input.decidedBy) throw forbidden('Akreditasyon yalnızca yönetici kararıyla verilir', 'AI_FORBIDDEN_ACTION');
    if (input.action === 'reject') return ['accreditation_rejected'];
    await accreditSupplier(ctx, d.entity_id, input.decidedBy);
    return ['supplier_accredited'];
  });

  registerDecisionEffect('rfq_send', async (ctx, d, input) => {
    const ids = (d.detail?.rfqIds ?? []) as string[];
    if (input.action === 'reject') return rejectRfqs(ctx, ids, input.reason);
    return sendApprovedRfqs(ctx, ids, input.action === 'edit' ? input.edits : undefined);
  });

  registerDecisionEffect('outbound_message', draftEffect);
  registerDecisionEffect('negotiation_message', draftEffect);

  registerDecisionEffect('contract_diff', async (ctx, d, input) => {
    if (input.action === 'reject') {
      if (d.detail?.draftId) await discardDraft(ctx, d.detail.draftId as string);
      return ['diff_dismissed'];
    }
    return draftEffect(ctx, d, input).then((r) => r.map((x) => (x === 'draft_sent' ? 'revision_request_sent' : x)));
  });

  registerDecisionEffect('contract_approval', async (ctx, d, input) => {
    if (input.action === 'reject') {
      await ctx.db.query(`UPDATE contracts SET status = 'draft' WHERE id = $1 AND status = 'pending_approval'`, [d.entity_id]);
      return ['contract_returned'];
    }
    return approveContract(ctx, d.entity_id, input.decidedBy);
  });

  registerDecisionEffect('condition_risk', async (ctx, d, input) => {
    if (input.action === 'reject') return ['condition_risk_not_accepted'];
    if (d.detail?.impact) return ['acknowledged'];
    return acceptConditionRisk(ctx, d.entity_id, input.decidedBy);
  });

  registerDecisionEffect('assignment', async (ctx, d, input) => {
    if (input.action === 'reject') return ['assignment_rejected'];
    const userId = (input.action === 'edit' ? (input.edits?.userId as string | undefined) : undefined) ?? (d.detail?.userId as string);
    await assignProject(ctx, d.project_id, userId);
    return [`project_assigned:${userId}`];
  });

  registerDecisionEffect('automation_promotion', async (ctx, d, input) => {
    const actionType = d.detail?.actionType as AiActionType;
    if (input.action === 'reject') return ['promotion_declined'];
    if (!input.decidedBy || !isPromotable(actionType)) throw forbidden('Bu iş türü otomatiğe alınamaz', 'NOT_PROMOTABLE');
    await promoteAction(ctx, actionType, input.decidedBy);
    return [`automation_promoted:${actionType}`];
  });

  registerDecisionEffect('automation_demotion', async () => ['acknowledged']);

  registerDecisionEffect('audit_sample', async () => ['sample_reviewed']); // counter outcome handled in decide()

  registerDecisionEffect('checklist_question', async (ctx, d, input) => {
    const id = d.entity_id as string;
    if (input.action === 'reject') {
      await ctx.db.query(`UPDATE checklist_questions SET status = 'rejected', decision_id = $2 WHERE id = $1`, [id, d.id]);
      return ['checklist_question_rejected'];
    }
    const q = input.action === 'edit' && typeof input.edits?.question === 'string' ? input.edits.question : null;
    await ctx.db.query(`UPDATE checklist_questions SET status = 'active', question = COALESCE($2, question), decision_id = $3 WHERE id = $1`, [id, q, d.id]);
    return ['checklist_question_activated'];
  });

  registerDecisionEffect('rule_suggestion', async (ctx, d, input) => {
    // §6: rule changes are forbidden for AI — only an admin decision applies them
    if (input.auto || !input.decidedBy) throw forbidden('Kural değişikliği yalnızca yönetici kararıyla', 'AI_FORBIDDEN_ACTION');
    if (input.action === 'reject') {
      if (d.entity_id) await ctx.db.query(`UPDATE rule_suggestions SET status = 'rejected' WHERE id = $1`, [d.entity_id]);
      return ['rule_suggestion_rejected'];
    }
    const key = d.detail?.key as keyof TenantRules;
    const value = input.action === 'edit' && input.edits?.value !== undefined ? input.edits.value : d.detail?.proposedValue;
    await setRule(ctx.db, key, value, input.decidedBy, `Kural önerisi kararı ${d.id}`);
    if (d.entity_id) await ctx.db.query(`UPDATE rule_suggestions SET status = 'accepted' WHERE id = $1`, [d.entity_id]);
    return [`rule_changed:${String(key)}`];
  });

  registerDecisionEffect('low_confidence_review', async (ctx, d, input) => {
    const offerId = (d.detail?.offerId as string) ?? d.entity_id;
    if (input.action === 'reject') return ['reading_rejected'];
    const patch = input.action === 'edit' ? (input.edits ?? {}) : {};
    const o = await verifyOffer(ctx, offerId, patch);
    return [`offer_verified:${o.id}`];
  });

  void recordAutomationOutcome;
  // phase B: payment_approval, field_extra, low_confidence_review (bank match), unbilled_payment_escalation,
  // low_supplier_score, closing_overdue effects + customer_invoice_draft generator + notification hook
  registerPhaseB();
}
