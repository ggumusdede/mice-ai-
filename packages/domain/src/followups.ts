// §7 Adım 1 RFQ takip (24h hatırlatma / 48h telefon görevi), Adım 4 teklif takibi, opsiyon alarmı
import type { TenantRules } from '@mice/shared';
import type { BusinessCalendar } from './business-time.js';
import { notImplemented } from './_todo.js';

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
/** Pure scheduler: returns idempotent actions due at `now` (does not repeat already-recorded actions). */
export function dueFollowups(state: FollowupState, rules: TenantRules, cal: BusinessCalendar): FollowupAction[] { return notImplemented('dueFollowups'); }
