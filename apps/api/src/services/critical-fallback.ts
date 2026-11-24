// §15 / docs/07 §1 öneri 2: a critical notification is pushed immediately; if it is not opened (acknowledged) within
// rule `criticalPushFallbackMinutes` (default 15, 0 = off; kill switch CRITICAL_FALLBACK=off) the admin gets ONE WhatsApp
// (template critical_alert outside the 24 h window) or SMS message per worker pass that lists the pending items.
// Acknowledged = notifications.read_at (service-worker click on the signed /api/push/ack link, or POST
// /api/notifications/:id/ack) — or the linked decision card is no longer open. Idempotent: the rows are locked
// (SKIP LOCKED) and fallback_at is set in the same transaction as the outbox row; the worker also holds the leader lock.
// This is an INTERNAL alert to the agency's own admin (not an external message), sent from the system, not on behalf of a human.
import type { Ctx } from '../context.js';
import { loadDeliveryConfig } from '../delivery-config.js';
import { ChannelRouter } from './delivery.js';
import { normalizeMsisdn } from './messaging.js';

export const CRITICAL_FALLBACK_FROM = 'system';

export async function runCriticalPushFallback(ctx: Ctx, now: Date, opts: { enabled?: boolean; maxAgeHours?: number } = {}): Promise<string[]> {
  const cfg = loadDeliveryConfig().criticalFallback;
  if (!(opts.enabled ?? cfg.enabled)) return [];
  const rules = await ctx.rules();
  const minutes = Number(rules.criticalPushFallbackMinutes ?? 15);
  if (!(minutes > 0)) return [];
  const router = ctx.deps.email;
  if (!(router instanceof ChannelRouter) || !router.messagingLive) return [];
  const { rows } = await ctx.db.query(
    `SELECT n.id, n.user_id, n.title, u.notify_phone FROM notifications n JOIN users u ON u.id = n.user_id
      WHERE n.priority = 'critical' AND n.read_at IS NULL AND n.fallback_at IS NULL AND n.status = 'sent'
        AND n.sent_at <= $1 AND n.sent_at > $2 AND u.active AND u.role = 'admin'
        AND NOT (n.entity_type = 'decision' AND EXISTS (SELECT 1 FROM decisions d WHERE d.id = n.entity_id AND d.status <> 'open'))
      ORDER BY n.user_id, n.sent_at FOR UPDATE OF n SKIP LOCKED`,
    [new Date(now.getTime() - minutes * 60_000), new Date(now.getTime() - (opts.maxAgeHours ?? cfg.maxAgeHours) * 3_600_000)]);
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  const out: string[] = [];
  const base = ctx.deps.config.publicBaseUrl || '';
  const minimal = loadDeliveryConfig().push.minimalPayload;
  for (const [, list] of byUser) {
    const ids = list.map((r) => r.id);
    const phone = list[0].notify_phone ? normalizeMsisdn(list[0].notify_phone) : null;
    if (!phone) {
      await ctx.db.query(`UPDATE notifications SET fallback_status = 'no_phone', fallback_at = $2 WHERE id = ANY($1)`, [ids, now]);
      out.push('critical_fallback_no_phone:1');
      continue;
    }
    const titles = minimal ? [] : list.slice(0, 3).map((r) => String(r.title).slice(0, 80));
    const body = `MICE OS: ${list.length} kritik bildirim ${minutes} dk içinde açılmadı.${titles.length ? `\n${titles.map((t) => `• ${t}`).join('\n')}` : ''}\nKarar kutusu: ${base}/`;
    const sent = await ctx.deps.email.send(ctx.db, {
      tenantId: ctx.tenantId, channel: 'whatsapp', from: CRITICAL_FALLBACK_FROM, to: phone, subject: null, body, autonomous: true,
      waTemplate: { key: 'critical_alert', params: [String(list.length), titles[0] ?? 'Karar kutusu', `${base}/`] },
    });
    await ctx.db.query(`UPDATE notifications SET fallback_status = 'sent', fallback_at = $2, fallback_outbox_id = $3 WHERE id = ANY($1)`, [ids, now, sent.id]);
    out.push(`critical_fallback:${list.length}`);
  }
  return out;
}
