// §15 Bildirim: critical notifications (option expiry, contract risk, urgent payment) are delivered immediately;
// routine ones are batched into two digests per day (morning / evening, tenant business-hours timezone).
// NotificationService is the abstraction; OutboxNotificationService stores every notification in `notifications`
// (and logs to the console in development). WebPushNotificationService (push.ts, VAPID) implements `deliver` when keys are set.
import type { Decision, Role } from '@mice/shared';
import { effectiveQuietHours, inQuietHours, localParts, zonedTimeToUtc } from '@mice/domain';
import type { Ctx } from '../context.js';
import type { Db } from '../db/pool.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { purposeKey } from '../lib/signed-token.js';

/** Signed acknowledge token for one notification (no login needed: it can only mark that notification as opened).
 *  Compact (< 100 chars, Fastify's path-parameter limit): hex(tenant) . hex(notification) . 128-bit HMAC. */
export function pushAckToken(secret: string, tenantId: string, notificationId: string): string {
  const body = `${tenantId.replace(/-/g, '')}.${notificationId.replace(/-/g, '')}`;
  return `${body}.${createHmac('sha256', purposeKey(secret, 'push-ack')).update(body).digest().subarray(0, 16).toString('base64url')}`;
}
const uuidOf = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
export function verifyPushAckToken(secret: string, token: string): { tenantId: string; notificationId: string } | null {
  const m = /^([0-9a-f]{32})\.([0-9a-f]{32})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return null;
  const expected = Buffer.from(createHmac('sha256', purposeKey(secret, 'push-ack')).update(`${m[1]}.${m[2]}`).digest().subarray(0, 16).toString('base64url'));
  const given = Buffer.from(m[3]);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { tenantId: uuidOf(m[1]), notificationId: uuidOf(m[2]) };
}

/** Marks a notification opened (push click / in-app) — stops the §15 WhatsApp / SMS fallback. */
export async function ackNotification(db: Db, id: string, via: 'push_click' | 'api', now: Date, userId?: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE notifications SET read_at = COALESCE(read_at, $2), status = CASE WHEN status = 'sent' THEN 'read' ELSE status END, acked_via = COALESCE(acked_via, $3)
      WHERE id = $1 AND ($4::uuid IS NULL OR user_id = $4)`, [id, now, via, userId ?? null]);
  return (r.rowCount ?? 0) > 0;
}

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

export interface PushMessage {
  tenantId: string; userId: string; title: string; body: string | null; priority: 'critical' | 'digest';
  /** page opened on notificationclick (default: the decision inbox) */
  url?: string;
  /** critical: notification row id + signed acknowledge link (the service worker POSTs it on click, §15 fallback) */
  notificationId?: string;
  ackUrl?: string;
}

export interface NotificationService {
  readonly name: string;
  /** physical delivery of one push message (critical or digest). `db` is the caller's tenant transaction (RLS). Must not throw. */
  deliver(msg: PushMessage, db?: Db): Promise<void>;
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
    const row = (await ctx.db.query(
      `INSERT INTO notifications (tenant_id, user_id, project_id, priority, title, body, entity_type, entity_id, status, deliver_after, sent_at)
       VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [userId, n.projectId ?? null, n.priority, n.title, n.body ?? null, n.entityType ?? null, n.entityId ?? null,
        critical ? 'sent' : 'pending', critical ? now : nextDigestSlot(now, tz), critical ? now : null],
    )).rows[0];
    if (critical) {
      const ackUrl = `/api/push/ack/${pushAckToken(ctx.deps.config.jwtSecret, ctx.tenantId, row.id)}`;
      await service.deliver({ tenantId: ctx.tenantId, userId, title: n.title, body: n.body ?? null, priority: 'critical', url: '/', notificationId: row.id, ackUrl }, ctx.db);
    }
  }
  return users.length;
}

/** Worker hook: routine notifications whose slot has come are folded into ONE digest per user. */
export async function flushNotificationDigests(ctx: Ctx, now: Date): Promise<number> {
  const { rows } = await ctx.db.query(
    `SELECT * FROM notifications WHERE status = 'pending' AND priority = 'routine' AND deliver_after <= $1 ORDER BY user_id, created_at`, [now]);
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  // v0.5 S-14: default "her zaman"; when the agency or the person turned quiet hours on, routine digests wait until the window
  // ends (critical notifications are never held back — they do not go through this digest).
  const rules = await ctx.rules();
  const qh = new Map<string, unknown>((await ctx.db.query('SELECT id, quiet_hours FROM users WHERE id = ANY($1)', [[...byUser.keys()]])).rows.map((u) => [u.id, u.quiet_hours]));
  for (const userId of [...byUser.keys()]) {
    if (inQuietHours(now, rules.businessHours.timezone, effectiveQuietHours(rules.quietHours, (qh.get(userId) ?? null) as never))) byUser.delete(userId);
  }
  for (const [userId, list] of byUser) {
    const title = `${list.length} rutin bildirim`;
    const body = list.map((r) => `• ${r.title}`).join('\n');
    const digest = (await ctx.db.query(
      `INSERT INTO notifications (tenant_id, user_id, priority, title, body, status, sent_at) VALUES (app_tenant_id(), $1, 'digest', $2, $3, 'sent', $4) RETURNING id`,
      [userId, title, body, now])).rows[0];
    await ctx.db.query(`UPDATE notifications SET status = 'batched', digest_id = $2, sent_at = $3 WHERE id = ANY($1)`, [list.map((r) => r.id), digest.id, now]);
    await service.deliver({ tenantId: ctx.tenantId, userId, title, body, priority: 'digest', url: '/' }, ctx.db);
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
