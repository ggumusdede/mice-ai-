// Phase B wiring (called from registerAll): decision effects for steps 6–8, the customer invoice draft generator and the
// push-notification hook on new decision cards.
import { forbidden } from '../errors.js';
import { getDecisionEffect, onDecisionCreated, registerDecisionEffect, type DecisionEffect } from './decisions.js';
import { notifyDecision } from './notifications.js';
import { manualMatch, paymentDecisionEffect, paymentMatchEffect } from './finance.js';
import { registerClosingDocuments } from './closing.js';
import { registerPhaseBDocuments } from './documents-b.js';

let done = false;

export function registerPhaseB(): void {
  if (done) return;
  done = true;
  registerClosingDocuments();
  registerPhaseBDocuments();
  onDecisionCreated(notifyDecision);

  // §7 Adım 7: every payment individually, Face ID (requiresBiometric), admin or delegate; AI never (money_movement)
  registerDecisionEffect('payment_approval', async (ctx, d, input) => {
    if (input.auto || !input.decidedBy) throw forbidden('Ödeme onayı yapay zekâ tarafından verilemez (§6)', 'AI_FORBIDDEN_ACTION');
    return paymentDecisionEffect(ctx, d.entity_id, input.action, input.decidedBy, input.auto);
  });

  // §17.1 field extra above the field lead's limits: admin / delegate decides (Face ID)
  registerDecisionEffect('field_extra', async (ctx, d, input) => {
    if (input.auto || !input.decidedBy) throw forbidden('Saha ekstra onayı yapay zekâ tarafından verilemez', 'AI_FORBIDDEN_ACTION');
    const status = input.action === 'reject' ? 'rejected' : 'approved';
    if (status === 'approved' && ctx.user?.role !== 'admin') {
      // §17.1: above the field lead's limit someone else decides — a delegated field lead cannot approve their own extra
      const own = (await ctx.db.query('SELECT 1 FROM field_extras WHERE id = $1 AND entered_by = $2', [d.entity_id, input.decidedBy])).rowCount;
      if (own) throw forbidden('Kendi girdiğiniz limit üstü ekstrayı onaylayamazsınız (dört göz ilkesi)', 'SELF_APPROVAL_FORBIDDEN');
    }
    await ctx.db.query(`UPDATE field_extras SET admin_status = $2 WHERE id = $1`, [d.entity_id, status]);
    return [`field_extra_${status}`];
  });

  // low_confidence_review is shared with phase A (offer readings); bank-transaction suggestions are dispatched here
  const offerReview: DecisionEffect | undefined = getDecisionEffect('low_confidence_review');
  registerDecisionEffect('low_confidence_review', async (ctx, d, input) => {
    if (d.entity_type === 'bank_transaction') {
      return paymentMatchEffect(ctx, d.entity_id, (d.detail?.entryId as string) ?? '', input.action, input.edits);
    }
    return offerReview ? offerReview(ctx, d, input) : ['recorded'];
  });

  registerDecisionEffect('unbilled_payment_escalation', async (ctx, d, input) => {
    if (input.action === 'edit' && typeof input.edits?.entryId === 'string') { await manualMatch(ctx, d.entity_id, input.edits.entryId); return ['payment_matched']; }
    return [input.action === 'reject' ? 'escalation_dismissed' : 'acknowledged'];
  });

  registerDecisionEffect('low_supplier_score', async (ctx, d, input) => {
    if (input.auto || !input.decidedBy) throw forbidden('Akreditasyon kararı yöneticidedir', 'AI_FORBIDDEN_ACTION');
    if (input.action === 'edit' && input.edits?.status === 'passive') {
      await ctx.db.query(`UPDATE suppliers SET status = 'passive' WHERE id = $1`, [d.entity_id]);
      return ['supplier_passive'];
    }
    return ['acknowledged'];
  });

  registerDecisionEffect('closing_overdue', async () => ['acknowledged']);
}
