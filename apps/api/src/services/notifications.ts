// §15 Bildirim: critical notifications (option expiry, contract risk, urgent payment) are delivered immediately;
// routine ones are batched into two digests per day (morning / evening, tenant business-hours timezone).
// NotificationService is the abstraction; OutboxNotificationService stores every notification in `notifications`
// (and logs to the console in development). A real push provider (APNs / FCM / Web Push) implements `deliver`.
import type { Decision, Role } from '@mice/shared';
import { localParts, zonedTimeToUtc } from '@mice/domain';
import type { Ctx } from '../context.js';

export type NotificationPriority = 'critical' | 'routine';

export interface NotificationInput {
  /** explicit recipients; or `roles` → every active user with one of these roles */
  userIds?: string[];
  roles?: Role[];
  priority: NotificationPriority;
  title: string;
  body?: string | null;
  projectId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export interface PushMessage { tenantId: string; userId: string; title: string; body: string | null; priority: 'critical' | 'digest' }

export interface NotificationService {
  readonly name: string;
  /** physical delivery of one push message (critical or digest). */
  deliver(msg: PushMessage): Promise<void>;
}

export class ConsoleNotificationService implements NotificationService {
  readonly name = 'console';
  readonly delivered: PushMessage[] = [];
  constructor(private opts: { log?: boolean } = {}) {}
  async deliver(msg: PushMessage): Promise<void> {
    this.delivered.push(msg);
    if (this.opts.log) console.log(`[push:${msg.priority}] → ${msg.userId}: ${msg.title}${msg.body ? `\n${msg.body}` : ''}`);
  }
}

let service: NotificationService = new ConsoleNotificationService({ log: process.env.NODE_ENV === 'development' });
export function setNotificationService(s: NotificationService): void {
  service = s;
}
export function getNotificationService(): NotificationService {
  return service;
}

/** Digest slots (local time): morning 08:30, evening 18:00. */
export const DIGEST_SLOTS = [{ h: 8, m: 30 }, { h: 18, m: 0 }] as const;

/** Next digest slot strictly after `now` in timezone `tz`. Pure. */
export function nextDigestSlot(now: Date, tz: string): Date {
  const lp = localParts(now, tz);
  for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
    for (const s of DIGEST_SLOTS) {
      const t = zonedTimeToUtc(lp.year, lp.month, lp.day + dayOffset, s.h, s.m, tz);
      if (t > now.getTime()) return new Date(t);
    }
  }
  return new Date(now.getTime() + 12 * 3_600_000);
}

async function recipients(ctx: Ctx, n: NotificationInput): Promise<string[]> {
  const ids = new Set(n.userIds?.filter(Boolean) ?? []);
  if (n.roles?.length) {
    const { rows } = await ctx.db.query('SELECT id FROM users WHERE active AND role = ANY($1)', [n.roles]);
    for (const r of rows) ids.add(r.id);
  }
  return [...ids];
}

/** Stores the notification; critical → delivered now, routine → pending until the next digest slot. */
export async function notify(ctx: Ctx, n: NotificationInput): Promise<number> {
  const rules = await ctx.rules();
  const tz = rules.businessHours.timezone;
  const now = ctx.now();
  const users = await recipients(ctx, n);
  for (const userId of users) {
    const critical = n.priority === 'critical';
    await ctx.db.query(
      `INSERT INTO notifications (tenant_id, user_id, project_id, priority, title, body, entity_type, entity_id, status, deliver_after, sent_at)
       VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [userId, n.projectId ?? null, n.priority, n.title, n.body ?? null, n.entityType ?? null, n.entityId ?? null,
        critical ? 'sent' : 'pending', critical ? now : nextDigestSlot(now, tz), critical ? now : null],
    );
    if (critical) await service.deliver({ tenantId: ctx.tenantId, userId, title: n.title, body: n.body ?? null, priority: 'critical' });
  }
  return users.length;
}

/** Worker hook: routine notifications whose slot has come are folded into ONE digest per user. */
export async function flushNotificationDigests(ctx: Ctx, now: Date): Promise<number> {
  const { rows } = await ctx.db.query(
    `SELECT * FROM notifications WHERE status = 'pending' AND priority = 'routine' AND deliver_after <= $1 ORDER BY user_id, created_at`, [now]);
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  for (const [userId, list] of byUser) {
    const title = `${list.length} rutin bildirim`;
    const body = list.map((r) => `• ${r.title}`).join('\n');
    const digest = (await ctx.db.query(
      `INSERT INTO notifications (tenant_id, user_id, priority, title, body, status, sent_at) VALUES (app_tenant_id(), $1, 'digest', $2, $3, 'sent', $4) RETURNING id`,
      [userId, title, body, now])).rows[0];
    await ctx.db.query(`UPDATE notifications SET status = 'batched', digest_id = $2, sent_at = $3 WHERE id = ANY($1)`, [list.map((r) => r.id), digest.id, now]);
    await service.deliver({ tenantId: ctx.tenantId, userId, title, body, priority: 'digest' });
  }
  return byUser.size;
}

/** Decision cards → push: urgent / critical immediately; the rest in the next digest. */
export async function notifyDecision(ctx: Ctx, d: Decision): Promise<void> {
  const critical = d.urgent || d.badge === 'critical';
  await notify(ctx, {
    roles: d.requiredRole === 'admin' ? ['admin'] : ['admin', d.requiredRole],
    priority: critical ? 'critical' : 'routine',
    title: d.summary,
    body: d.aiNote,
    projectId: d.projectId,
    entityType: 'decision',
    entityId: d.id,
  });
}
