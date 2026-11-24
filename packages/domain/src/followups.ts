// §7 Adım 1 RFQ takip (24h hatırlatma / 48h telefon görevi), Adım 4 teklif takibi, opsiyon alarmı
import type { TenantRules } from '@mice/shared';
import { addBusinessDays, localDate, startOfLocalDate, type BusinessCalendar } from './business-time.js';

export type FollowupAction =
  | { type: 'supplier_reminder'; rfqId: string } // autonomous (approved template)
  | { type: 'call_task'; rfqId: string }
  | { type: 'quote_followup_draft'; quoteId: string; reason: 'no_response' | 'option_expiring' }
  | { type: 'option_expiry_alarm'; offerId: string; optionUntil: string }
  | { type: 'unbilled_payment_escalation'; bankTransactionId: string }
  | { type: 'unbilled_payment_daily_reminder'; bankTransactionId: string; userId: string | null }
  | { type: 'closing_overdue'; projectId: string };

export interface FollowupState {
  now: Date;
  rfqs: { id: string; status: string; sentAt: string | null; reminderSentAt: string | null; callTaskCreatedAt: string | null; reminderHours?: number; callHours?: number }[];
  quotes: { id: string; status: string; sentAt: string | null; optionUntil: string | null; lastFollowupAt: string | null }[];
  offers: { id: string; optionUntil: string | null; selected: boolean; alarmedAt: string | null }[];
  unmatchedPayments: { id: string; since: string; payerUserId: string | null; escalatedAt: string | null; lastReminderAt: string | null }[];
  projects: { id: string; eventEndedAt: string | null; closedAt: string | null; overdueAlertedAt: string | null }[];
}

const H = 3_600_000;
const D = 86_400_000;
const ts = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const t = Date.parse(s.length === 10 ? s + 'T00:00:00Z' : s);
  return Number.isNaN(t) ? null : t;
};

/** Pure scheduler: returns idempotent actions due at `now` (does not repeat already-recorded actions).
 *  - RFQ (status 'sent'): reminder after reminderHours (default 24h) unless reminderSentAt; call task after callHours (48h) unless callTaskCreatedAt.
 *  - Quote (status 'sent'): 'option_expiring' draft from optionUntil − optionExpiryWarningDays (calendar days, local tz) until the option ends,
 *    unless a follow-up was already recorded inside that window; otherwise 'no_response' draft once quoteFollowupBusinessDays business days
 *    after sending when no follow-up was recorded yet. At most one draft per quote per run.
 *  - Selected supplier offers: option expiry alarm from optionUntil − optionExpiryWarningDays (also when already expired), once.
 *  - Unmatched payments: one reminder per local day to the payer; escalation once after unbilledPaymentEscalationDays.
 *  - Projects: closing overdue once when not closed more than closingDeadlineDays after event end. */
export function dueFollowups(state: FollowupState, rules: TenantRules, cal: BusinessCalendar): FollowupAction[] {
  const now = state.now.getTime();
  const tz = cal.timezone;
  const today = localDate(state.now, tz);
  const out: FollowupAction[] = [];

  for (const r of state.rfqs) {
    if (r.status !== 'sent') continue;
    const sent = ts(r.sentAt);
    if (sent == null) continue;
    const elapsedH = (now - sent) / H;
    if (!r.reminderSentAt && elapsedH >= (r.reminderHours ?? rules.rfqReminderHours)) out.push({ type: 'supplier_reminder', rfqId: r.id });
    if (!r.callTaskCreatedAt && elapsedH >= (r.callHours ?? rules.rfqCallTaskHours)) out.push({ type: 'call_task', rfqId: r.id });
  }

  for (const q of state.quotes) {
    if (q.status !== 'sent') continue;
    const sent = ts(q.sentAt);
    const last = ts(q.lastFollowupAt);
    if (q.optionUntil) {
      const warnStart = startOfLocalDate(q.optionUntil, tz, -rules.optionExpiryWarningDays).getTime();
      const optionEnd = startOfLocalDate(q.optionUntil, tz, 1).getTime();
      if (now >= warnStart && now < optionEnd && (last == null || last < warnStart)) {
        out.push({ type: 'quote_followup_draft', quoteId: q.id, reason: 'option_expiring' });
        continue;
      }
    }
    if (sent != null && last == null) {
      const dueAt = addBusinessDays(new Date(sent), rules.quoteFollowupBusinessDays, cal).getTime();
      if (now >= dueAt) out.push({ type: 'quote_followup_draft', quoteId: q.id, reason: 'no_response' });
    }
  }

  for (const o of state.offers) {
    if (!o.selected || !o.optionUntil || o.alarmedAt) continue;
    const warnStart = startOfLocalDate(o.optionUntil, tz, -rules.optionExpiryWarningDays).getTime();
    if (now >= warnStart) out.push({ type: 'option_expiry_alarm', offerId: o.id, optionUntil: o.optionUntil.slice(0, 10) });
  }

  for (const p of state.unmatchedPayments) {
    const since = ts(p.since);
    if (since == null || since > now) continue;
    if (!p.escalatedAt && now - since >= rules.unbilledPaymentEscalationDays * D) out.push({ type: 'unbilled_payment_escalation', bankTransactionId: p.id });
    const lastReminderDay = p.lastReminderAt ? localDate(new Date(p.lastReminderAt), tz) : null;
    if (lastReminderDay == null || lastReminderDay < today) out.push({ type: 'unbilled_payment_daily_reminder', bankTransactionId: p.id, userId: p.payerUserId });
  }

  for (const pr of state.projects) {
    if (pr.closedAt || pr.overdueAlertedAt) continue;
    const ended = ts(pr.eventEndedAt);
    if (ended == null) continue;
    if (now - ended > rules.closingDeadlineDays * D) out.push({ type: 'closing_overdue', projectId: pr.id });
  }

  return out;
}
