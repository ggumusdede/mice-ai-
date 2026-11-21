// Web Push (VAPID, RFC 8030/8292) behind NotificationService (§15 bildirim).
// - Subscriptions: POST /api/push/subscribe (upsert per endpoint), POST /api/push/unsubscribe (active=false; nothing deleted).
// - Delivery: notify() calls deliver() immediately for critical notifications; routine ones arrive in the morning / evening
//   digest (flushNotificationDigests) — both through this service.
// - Without VAPID keys createNotificationService() returns the console fallback (the `notifications` table is the record).
// - SSRF guard: the API only POSTs to endpoints of known browser push services (WEB_PUSH_ALLOWED_HOSTS).
// - Payloads are end-to-end encrypted (aes128gcm) to the browser; WEB_PUSH_MINIMAL_PAYLOAD=1 sends a generic text only.
import * as webpush from 'web-push';
import type { Ctx } from '../context.js';
import type { Db } from '../db/pool.js';
import { loadDeliveryConfig, type DeliveryConfig } from '../delivery-config.js';
import { badRequest } from '../errors.js';
import { ConsoleNotificationService, type NotificationService, type PushMessage } from './notifications.js';

export interface PushSubscriptionKeys { endpoint: string; keys: { p256dh: string; auth: string } }
export interface PushSendOptions {
  TTL: number;
  urgency: 'very-low' | 'low' | 'normal' | 'high';
  topic?: string;
  timeout: number;
  vapidDetails: { subject: string; publicKey: string; privateKey: string };
}
/** The part of `web-push` we use (mockable in tests). */
export interface PushSender {
  send(sub: PushSubscriptionKeys, payload: string, opts: PushSendOptions): Promise<{ statusCode: number }>;
}

export const webPushSender: PushSender = {
  send: (sub, payload, opts) => webpush.sendNotification(sub, payload, opts),
};

export function isAllowedPushEndpoint(endpoint: string, allowedHosts: string[]): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase();
  return allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
}

export function pushPayload(msg: PushMessage, minimal: boolean): string {
  const title = minimal ? 'MICE OS' : msg.title;
  const body = minimal ? (msg.priority === 'digest' ? 'Rutin bildirim özetiniz hazır' : 'Karar kutunuzda yeni bir iş var') : msg.body ?? '';
  return JSON.stringify({ title, body, url: msg.url ?? '/', priority: msg.priority, tag: msg.priority === 'digest' ? 'mice-digest' : undefined });
}

const MAX_FAILURES = 10;

/** Runs `fn` inside a savepoint so a failing bookkeeping query never aborts the caller's transaction. */
async function safely(db: Db, fn: () => Promise<unknown>): Promise<void> {
  await db.query('SAVEPOINT push_delivery');
  try {
    await fn();
    await db.query('RELEASE SAVEPOINT push_delivery');
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT push_delivery').catch(() => {});
    console.error('[push] bookkeeping failed', (e as Error).message);
  }
}

export class WebPushNotificationService implements NotificationService {
  readonly name = 'webpush';
  constructor(
    private cfg: DeliveryConfig['push'] & { vapid: NonNullable<DeliveryConfig['push']['vapid']> },
    private sender: PushSender = webPushSender,
    private fallback: NotificationService = new ConsoleNotificationService({ log: process.env.NODE_ENV === 'development' }),
  ) {}

  async deliver(msg: PushMessage, db?: Db): Promise<void> {
    await this.fallback.deliver(msg, db);
    if (!db) return;
    let subs: { id: string; endpoint: string; p256dh: string; auth_secret: string; failure_count: number }[] = [];
    await safely(db, async () => {
      subs = (await db.query('SELECT id, endpoint, p256dh, auth_secret, failure_count FROM push_subscriptions WHERE user_id = $1 AND active', [msg.userId])).rows;
    });
    const payload = pushPayload(msg, this.cfg.minimalPayload);
    for (const s of subs) {
      if (!isAllowedPushEndpoint(s.endpoint, this.cfg.allowedHosts)) continue;
      try {
        await this.sender.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_secret } }, payload, {
          TTL: msg.priority === 'digest' ? Math.min(this.cfg.ttlSeconds, 12 * 3600) : this.cfg.ttlSeconds,
          urgency: msg.priority === 'critical' ? 'high' : 'normal',
          ...(msg.priority === 'digest' ? { topic: 'mice-digest' } : {}),
          timeout: this.cfg.timeoutMs,
          vapidDetails: this.cfg.vapid,
        });
        await safely(db, () => db.query('UPDATE push_subscriptions SET last_success_at = now(), failure_count = 0, last_error = NULL, updated_at = now() WHERE id = $1', [s.id]));
      } catch (e) {
        const status = Number((e as { statusCode?: number }).statusCode);
        const error = String((e as Error).message ?? e).slice(0, 300);
        const expired = status === 404 || status === 410;
        const tooMany = s.failure_count + 1 >= MAX_FAILURES;
        await safely(db, () => db.query(
          `UPDATE push_subscriptions SET failure_count = failure_count + 1, last_failure_at = now(), last_error = $2, updated_at = now(),
                  active = CASE WHEN $3 THEN false ELSE active END, deactivated_at = CASE WHEN $3 THEN now() ELSE deactivated_at END,
                  deactivated_reason = CASE WHEN $3 THEN $4 ELSE deactivated_reason END WHERE id = $1`,
          [s.id, error, expired || tooMany, expired ? 'expired' : 'failures']));
        if (!expired) console.error(`[push] delivery failed sub=${s.id} status=${status || '-'}: ${error}`);
      }
    }
  }
}

/** VAPID keys present → Web Push (with console log in dev); else the console / outbox fallback. */
export function createNotificationService(cfg: DeliveryConfig = loadDeliveryConfig(), sender?: PushSender): NotificationService {
  const log = process.env.NODE_ENV === 'development';
  if (!cfg.push.vapid) return new ConsoleNotificationService({ log });
  return new WebPushNotificationService({ ...cfg.push, vapid: cfg.push.vapid }, sender, new ConsoleNotificationService({ log }));
}

// ---------------------------------------------------------------- subscriptions

export interface SubscribeInput { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string | null }

export async function subscribePush(ctx: Ctx, input: SubscribeInput, allowedHosts: string[]): Promise<{ id: string; active: true }> {
  const user = ctx.user!;
  if (!isAllowedPushEndpoint(input.endpoint, allowedHosts)) throw badRequest('Desteklenmeyen push servisi', undefined, 'PUSH_ENDPOINT_NOT_ALLOWED');
  const { rows } = await ctx.db.query(
    `INSERT INTO push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth_secret, user_agent, device)
     VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth_secret = EXCLUDED.auth_secret,
       user_agent = EXCLUDED.user_agent, device = EXCLUDED.device, active = true, failure_count = 0, last_error = NULL,
       deactivated_at = NULL, deactivated_reason = NULL, updated_at = now()
     RETURNING id`,
    [user.id, input.endpoint, input.keys.p256dh, input.keys.auth, input.userAgent?.slice(0, 300) ?? null, ctx.actor.device?.slice(0, 200) ?? null]);
  return { id: rows[0].id, active: true };
}

export async function unsubscribePush(ctx: Ctx, endpoint: string): Promise<{ ok: true; deactivated: number }> {
  const { rowCount } = await ctx.db.query(
    `UPDATE push_subscriptions SET active = false, deactivated_at = $3, deactivated_reason = 'user', updated_at = $3
      WHERE endpoint = $1 AND user_id = $2 AND active`, [endpoint, ctx.user!.id, ctx.now()]);
  return { ok: true, deactivated: rowCount ?? 0 };
}
