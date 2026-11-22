// Delivery wiring: one EmailProvider (what services call via ctx.deps.email) that routes by channel —
//   email          → OAuthEmailProvider (EMAIL_PROVIDER=oauth: the sender's own Gmail / Microsoft mailbox, fallback per
//                    EMAIL_OAUTH_FALLBACK), SmtpEmailProvider (smtp) or OutboxEmailProvider (default)
//   sms / whatsapp → LiveMessagingProvider (MESSAGING_PROVIDER=whatsapp_cloud and/or SMS_PROVIDER=http) or the outbox
// plus the worker job that retries failed SMTP deliveries and tells the sender / admin when delivery was given up.
import type { Db } from '../db/pool.js';
import type { Ctx } from '../context.js';
import { loadDeliveryConfig, type DeliveryConfig } from '../delivery-config.js';
import { OutboxEmailProvider, type EmailMessage, type EmailProvider } from './email.js';
import { createSmtpTransport, SmtpEmailProvider, type MailTransport, type RetryResult } from './email-smtp.js';
import { LiveMessagingProvider, OutboxMessagingProvider, type MessagingProvider } from './messaging.js';
import { OAuthEmailProvider, type MailboxApi } from './email-oauth.js';
import { OAuthTokenStore } from './mail-accounts.js';
import { notify } from './notifications.js';

export interface RetryingEmailProvider extends EmailProvider {
  retryDue(db: Db, now: Date): Promise<RetryResult>;
}

export function isRetrying(p: EmailProvider): p is RetryingEmailProvider {
  return typeof (p as Partial<RetryingEmailProvider>).retryDue === 'function';
}

export class ChannelRouter implements EmailProvider {
  readonly name: string;
  constructor(readonly email: EmailProvider, readonly messaging: MessagingProvider) {
    this.name = email.name;
  }
  send(db: Db, msg: EmailMessage): Promise<{ id: string }> {
    if (msg.channel === 'sms' || msg.channel === 'whatsapp') {
      return this.messaging.send(db, {
        tenantId: msg.tenantId, draftId: msg.draftId, projectId: msg.projectId, channel: msg.channel, from: msg.from, to: msg.to,
        body: msg.body, secrets: msg.secrets, autonomous: msg.autonomous, waTemplate: msg.waTemplate,
      });
    }
    return this.email.send(db, msg);
  }
  /** a real SMS / WhatsApp channel is configured (else messages are only recorded in the outbox) */
  get messagingLive(): boolean {
    return this.messaging instanceof LiveMessagingProvider && this.messaging.live;
  }
  async retryDue(db: Db, now: Date): Promise<RetryResult> {
    const out = isRetrying(this.email) ? await this.email.retryDue(db, now) : { sent: 0, failed: 0, gaveUp: 0 };
    if (this.messaging instanceof LiveMessagingProvider) {
      const m = await this.messaging.retryDue(db, now);
      out.sent += m.sent; out.failed += m.failed; out.gaveUp += m.gaveUp;
    }
    return out;
  }
}

export interface DeliveryOverrides {
  /** tests: a mocked nodemailer transport */
  transport?: MailTransport;
  /** tests: mocked mailbox API clients (HTTP is mocked via setIntegrationFetch otherwise) */
  mailApis?: { google?: MailboxApi; microsoft?: MailboxApi };
  now?: () => Date;
  log?: boolean;
}

export function createDeliveryProvider(cfg: DeliveryConfig = loadDeliveryConfig(), o: DeliveryOverrides = {}): ChannelRouter {
  const log = o.log ?? cfg.email.log;
  let email: EmailProvider;
  const smtp = () => new SmtpEmailProvider(o.transport ?? createSmtpTransport(cfg.email.smtp!), {
    replyAddress: cfg.email.replyAddress, messageIdDomain: cfg.email.messageIdDomain, envelopeFrom: cfg.email.smtp?.envelopeFrom ?? null,
    dataKey: cfg.email.dataKey, maxAttempts: cfg.email.maxAttempts, sendMode: cfg.email.sendMode, log, now: o.now,
  });
  if (cfg.email.provider === 'smtp') {
    email = smtp();
  } else if (cfg.email.provider === 'oauth') {
    const oc = cfg.email.oauth;
    email = new OAuthEmailProvider(new OAuthTokenStore(oc, o.now), {
      replyAddress: cfg.email.replyAddress, messageIdDomain: cfg.email.messageIdDomain, dataKey: cfg.email.dataKey, fallback: oc.fallback,
      fallbackProvider: oc.fallback === 'smtp' ? smtp() : oc.fallback === 'outbox' ? new OutboxEmailProvider({ log }) : null,
      holdMaxHours: oc.holdMaxHours, maxAttempts: cfg.email.maxAttempts, sendMode: cfg.email.sendMode, timeoutMs: oc.timeoutMs, log, now: o.now, apis: o.mailApis,
    });
  } else {
    email = new OutboxEmailProvider({ log });
  }
  const m = cfg.messaging;
  const waLive = m.provider === 'whatsapp_cloud' && !!m.whatsapp.token && !!m.whatsapp.phoneNumberId;
  if (m.provider === 'whatsapp_cloud' && !waLive) console.warn('[delivery] MESSAGING_PROVIDER=whatsapp_cloud without WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID — WhatsApp disabled');
  const messaging: MessagingProvider = waLive || m.sms
    ? new LiveMessagingProvider({ whatsapp: waLive ? m.whatsapp : null, sms: m.sms, dataKey: m.dataKey, maxAttempts: m.maxAttempts, sendMode: cfg.email.sendMode, log, now: o.now })
    : new OutboxMessagingProvider({ log });
  return new ChannelRouter(email, messaging);
}

/** Worker job (per tenant): retry due SMTP deliveries; notify sender + admins once per given-up message. */
export async function runOutboxJobs(ctx: Ctx, now: Date): Promise<string[]> {
  const provider = ctx.deps.email;
  if (!isRetrying(provider)) return [];
  const r = await provider.retryDue(ctx.db, now);
  const out: string[] = [];
  if (r.sent) out.push(`outbox_sent:${r.sent}`);
  if (r.failed) out.push(`outbox_retry_failed:${r.failed}`);
  const { rows } = await ctx.db.query(
    `SELECT o.id, o.channel, o.to_address, o.subject, o.last_error, o.project_id, u.id AS sender_id FROM outbox o
       LEFT JOIN users u ON lower(u.email) = lower(o.from_address)
      WHERE o.status = 'failed' AND o.next_attempt_at IS NULL AND o.failure_notified_at IS NULL LIMIT 100`);
  for (const f of rows) {
    await notify(ctx, {
      userIds: f.sender_id ? [f.sender_id] : [], roles: ['admin'], priority: 'critical',
      title: `${f.channel === 'sms' ? 'SMS' : f.channel === 'whatsapp' ? 'WhatsApp mesajı' : 'E-posta'} gönderilemedi: ${f.to_address}`, body: `${f.subject ?? ''}\n${f.last_error ?? ''}`.trim(),
      projectId: f.project_id, entityType: 'outbox', entityId: f.id,
    });
    await ctx.db.query('UPDATE outbox SET failure_notified_at = $2 WHERE id = $1', [f.id, now]);
  }
  if (rows.length) out.push(`outbox_gave_up:${rows.length}`);
  return out;
}
