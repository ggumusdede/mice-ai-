// Delivery wiring: one EmailProvider (what services call via ctx.deps.email) that routes by channel —
//   email          → SmtpEmailProvider (EMAIL_PROVIDER=smtp) or OutboxEmailProvider (default)
//   sms / whatsapp → MessagingProvider (outbox; WhatsApp Cloud API is a skeleton, see messaging.ts)
// plus the worker job that retries failed SMTP deliveries and tells the sender / admin when delivery was given up.
import type { Db } from '../db/pool.js';
import type { Ctx } from '../context.js';
import { loadDeliveryConfig, type DeliveryConfig } from '../delivery-config.js';
import { OutboxEmailProvider, type EmailMessage, type EmailProvider } from './email.js';
import { createSmtpTransport, SmtpEmailProvider, type MailTransport, type RetryResult } from './email-smtp.js';
import { OutboxMessagingProvider, type MessagingProvider } from './messaging.js';
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
        body: msg.body, secrets: msg.secrets, autonomous: msg.autonomous,
      });
    }
    return this.email.send(db, msg);
  }
  async retryDue(db: Db, now: Date): Promise<RetryResult> {
    return isRetrying(this.email) ? this.email.retryDue(db, now) : { sent: 0, failed: 0, gaveUp: 0 };
  }
}

export interface DeliveryOverrides {
  /** tests: a mocked nodemailer transport */
  transport?: MailTransport;
  now?: () => Date;
  log?: boolean;
}

export function createDeliveryProvider(cfg: DeliveryConfig = loadDeliveryConfig(), o: DeliveryOverrides = {}): ChannelRouter {
  const log = o.log ?? cfg.email.log;
  let email: EmailProvider;
  if (cfg.email.provider === 'smtp') {
    const transport = o.transport ?? createSmtpTransport(cfg.email.smtp!);
    email = new SmtpEmailProvider(transport, {
      replyAddress: cfg.email.replyAddress, messageIdDomain: cfg.email.messageIdDomain, envelopeFrom: cfg.email.smtp?.envelopeFrom ?? null,
      dataKey: cfg.email.dataKey, maxAttempts: cfg.email.maxAttempts, sendMode: cfg.email.sendMode, log, now: o.now,
    });
  } else {
    email = new OutboxEmailProvider({ log });
  }
  if (cfg.messaging.provider === 'whatsapp_cloud') {
    console.warn('[delivery] MESSAGING_PROVIDER=whatsapp_cloud is not live yet — SMS / WhatsApp messages go to the outbox');
  }
  return new ChannelRouter(email, new OutboxMessagingProvider({ log }));
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
    `SELECT o.id, o.to_address, o.subject, o.last_error, o.project_id, u.id AS sender_id FROM outbox o
       LEFT JOIN users u ON lower(u.email) = lower(o.from_address)
      WHERE o.status = 'failed' AND o.next_attempt_at IS NULL AND o.failure_notified_at IS NULL LIMIT 100`);
  for (const f of rows) {
    await notify(ctx, {
      userIds: f.sender_id ? [f.sender_id] : [], roles: ['admin'], priority: 'critical',
      title: `E-posta gönderilemedi: ${f.to_address}`, body: `${f.subject ?? ''}\n${f.last_error ?? ''}`.trim(),
      projectId: f.project_id, entityType: 'outbox', entityId: f.id,
    });
    await ctx.db.query('UPDATE outbox SET failure_notified_at = $2 WHERE id = $1', [f.id, now]);
  }
  if (rows.length) out.push(`outbox_gave_up:${rows.length}`);
  return out;
}
