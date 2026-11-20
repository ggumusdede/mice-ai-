// Phase B worker jobs (run per tenant inside runFollowupsForTenant): event-ended marker (feeds the 30-day closing alarm),
// KVKK anonymization, routine-notification digests (morning / evening), daily 3-line summary drafts during events.
import { localDate } from '@mice/domain';
import type { Ctx } from './context.js';
import { runAnonymization } from './services/guests.js';
import { flushNotificationDigests, notify } from './services/notifications.js';
import { dailySummary, markEndedEvents } from './services/operations.js';
import { createDraft } from './services/drafts.js';
import { notifyUnbilledPayment } from './services/finance.js';

/** Before the follow-up scheduler: state the scheduler depends on. */
export async function runPreJobs(ctx: Ctx, now: Date): Promise<string[]> {
  const n = await markEndedEvents(ctx, now);
  return n ? [`events_ended:${n}`] : [];
}

/** After the follow-up scheduler. */
export async function runPostJobs(ctx: Ctx, now: Date, followupsDone: { type: string; bankTransactionId?: string; userId?: string | null }[] = []): Promise<string[]> {
  const out: string[] = [];
  for (const a of followupsDone) {
    if (a.type === 'unbilled_payment_daily_reminder' && a.bankTransactionId) await notifyUnbilledPayment(ctx, a.bankTransactionId, a.userId ?? null);
  }
  const anon = await runAnonymization(ctx, now);
  if (anon) out.push(`guests_anonymized:${anon}`);
  out.push(...(await dailySummaryDrafts(ctx, now)));
  const digests = await flushNotificationDigests(ctx, now);
  if (digests) out.push(`notification_digests:${digests}`);
  return out;
}

/** During an event, once per local day after 18:00: a 3-line summary draft for the customer (human sends) + admin notification. */
async function dailySummaryDrafts(ctx: Ctx, now: Date): Promise<string[]> {
  const rules = await ctx.rules();
  const tz = rules.businessHours.timezone;
  const today = localDate(now, tz);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(now)) % 24;
  if (hour < 18) return [];
  const { rows } = await ctx.db.query(
    `SELECT p.id, p.code, p.owner_id, c.contacts FROM projects p LEFT JOIN customers c ON c.id = p.customer_id
      WHERE p.outcome = 'won' AND p.start_date <= $1::date AND COALESCE(p.end_date, p.start_date) >= $1::date
        AND NOT EXISTS (SELECT 1 FROM message_drafts m WHERE m.project_id = p.id AND m.kind = 'daily_summary' AND m.created_at >= $2::date)`,
    [today, today]);
  const out: string[] = [];
  for (const p of rows) {
    const s = await dailySummary(ctx, p.id, now);
    const to = (p.contacts ?? []).find((c: { email?: string }) => c.email)?.email ?? null;
    await createDraft(ctx, {
      projectId: p.id, kind: 'daily_summary', to, subject: `${p.code} — günlük özet ${today}`, body: s.lines.map((l) => `- ${l}`).join('\n'),
      status: 'draft', requiresApproval: false, fromUserId: p.owner_id, aiGenerated: true, entityType: 'project', entityId: p.id,
    });
    await notify(ctx, { roles: ['admin'], priority: 'routine', title: `${p.code} günlük özet`, body: s.lines.join('\n'), projectId: p.id, entityType: 'project', entityId: p.id });
    out.push(`daily_summary:${p.id}`);
  }
  return out;
}
