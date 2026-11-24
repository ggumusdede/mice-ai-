// Real e-mail delivery over SMTP (nodemailer) behind the EmailProvider interface.
//
// §3.3 "kendi adresinden gönderim": From is ALWAYS the responsible human's own address (the caller resolves it). The SMTP
// relay must be allowed to send as the agency's users (Google Workspace SMTP relay / M365 "send as", SPF + DKIM for the
// domain). Optional SMTP_ENVELOPE_FROM sets the envelope sender / `Sender:` header (bounce address) without changing From.
//
// Reply linking: every message gets a Message-ID `<outbox-id@EMAIL_MESSAGE_ID_DOMAIN>`, In-Reply-To / References to the
// previous message to the same recipient in the same project, an `X-MICE-Project` header, and — when EMAIL_REPLY_ADDRESS
// is set — a plus-addressed Reply-To (`replies+prj-0042@agency.com`) next to the sender's own address, so an inbound
// processor can link replies to the project by address tag or by In-Reply-To.
//
// Audit: the outbox row (redacted body) is written in the caller's transaction for every message. The unredacted body is
// kept pgcrypto-encrypted in `outbox_payloads` only until delivery succeeds or is given up, so the worker can retry.
// Failures are recorded (status 'failed', attempts, last_error, next_attempt_at with exponential backoff); permanent SMTP
// errors (5xx) are not retried.
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { Db } from '../db/pool.js';
import type { SmtpConfig } from '../delivery-config.js';
import { redact, type EmailMessage, type EmailProvider } from './email.js';

export interface MailOptions {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string[];
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  headers: Record<string, string>;
  envelope?: { from: string; to: string };
  sender?: string;
}

export interface MailSendInfo { messageId?: string; response?: string; accepted?: unknown[]; rejected?: unknown[] }

/** The part of a nodemailer transporter we use (mockable in tests). */
export interface MailTransport {
  sendMail(mail: MailOptions): Promise<MailSendInfo>;
  verify?(): Promise<unknown>;
  close?(): void;
}

export function createSmtpTransport(cfg: SmtpConfig): MailTransport {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? '' } : undefined,
    connectionTimeout: cfg.connectionTimeoutMs,
    greetingTimeout: cfg.connectionTimeoutMs,
    socketTimeout: cfg.socketTimeoutMs,
    tls: { rejectUnauthorized: cfg.rejectUnauthorized },
  }) as unknown as MailTransport;
}

/** `PRJ-0042-MARMARA-…` → `prj-0042` (stable even when the venue / date parts of the code change, §5). */
export function projectReplyTag(projectCode: string): string {
  const m = /^([A-Za-z]+-\d+)/.exec(projectCode.trim());
  return (m ? m[1] : projectCode).toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/** Plus addressing: `replies@agency.com` + `PRJ-0042-…` → `replies+prj-0042@agency.com`. */
export function projectReplyAddress(base: string, projectCode: string): string {
  const at = base.lastIndexOf('@');
  if (at <= 0) return base;
  const local = base.slice(0, at).split('+')[0];
  return `${local}+${projectReplyTag(projectCode)}${base.slice(at)}`;
}

/** Inbound side (future reply ingestion): `replies+prj-0042@agency.com` → `PRJ-0042`. */
export function parseProjectReplyTag(address: string): string | null {
  const m = /\+([a-z]+-\d+)@/i.exec(address);
  return m ? m[1].toUpperCase() : null;
}

export interface BuildMailInput {
  outboxId: string;
  from: string;
  to: string;
  subject: string | null;
  body: string;
  projectCode?: string | null;
  replyAddress?: string | null;
  messageIdDomain: string;
  /** Message-ID of the previous message in this project thread (same recipient) */
  previousMessageId?: string | null;
  envelopeFrom?: string | null;
  autonomous?: boolean;
}

/** Pure: the MIME envelope / headers for one outbox message. */
export function buildMail(i: BuildMailInput): MailOptions {
  const messageId = `<${i.outboxId}@${i.messageIdDomain}>`;
  const headers: Record<string, string> = { 'X-MICE-Outbox-Id': i.outboxId };
  // short reference only (PRJ-0042): the full project code contains the customer name and the header reaches suppliers too
  if (i.projectCode) headers['X-MICE-Project'] = projectReplyTag(i.projectCode).toUpperCase();
  // RFC 3834: the pre-approved autonomous RFQ reminder / KVKK notice is machine-generated (suppresses auto-replies)
  if (i.autonomous) headers['Auto-Submitted'] = 'auto-generated';
  const replyTo = i.replyAddress && i.projectCode ? [projectReplyAddress(i.replyAddress, i.projectCode), i.from] : undefined;
  const mail: MailOptions = {
    from: i.from,
    to: i.to,
    subject: i.subject ?? '',
    text: i.body,
    messageId,
    headers,
    ...(replyTo ? { replyTo } : {}),
    ...(i.previousMessageId ? { inReplyTo: i.previousMessageId, references: [i.previousMessageId] } : {}),
  };
  if (i.envelopeFrom) {
    mail.envelope = { from: i.envelopeFrom, to: i.to };
    mail.sender = i.envelopeFrom;
  }
  return mail;
}

/** Exponential backoff: 1, 2, 4 … minutes, capped at 6 h. */
export function retryDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 6 * 3_600_000);
}

/** SMTP 5xx replies are permanent (RFC 5321 §4.2.1): no retry. 4xx and network errors are retried. */
export function isPermanentSmtpError(e: unknown): boolean {
  const code = Number((e as { responseCode?: number })?.responseCode);
  return code >= 500 && code < 600;
}

export interface SmtpProviderOptions {
  replyAddress?: string | null;
  messageIdDomain: string;
  envelopeFrom?: string | null;
  /** pgcrypto key for the retry payload */
  dataKey: string;
  maxAttempts?: number;
  sendMode?: 'immediate' | 'queue';
  log?: boolean;
  now?: () => Date;
}

export interface RetryResult { sent: number; failed: number; gaveUp: number }

export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly maxAttempts: number;
  constructor(private transport: MailTransport, private opts: SmtpProviderOptions) {
    this.maxAttempts = opts.maxAttempts ?? 8;
  }

  private now(): Date {
    return this.opts.now ? this.opts.now() : new Date();
  }

  async send(db: Db, msg: EmailMessage): Promise<{ id: string }> {
    const id = randomUUID();
    const project = await this.resolveProject(db, msg);
    const previous = project
      ? (await db.query(
          `SELECT message_id FROM outbox WHERE project_id = $1 AND lower(to_address) = lower($2) AND message_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
          [project.id, msg.to])).rows[0]?.message_id ?? null
      : null;
    const mail = buildMail({
      outboxId: id, from: msg.from, to: msg.to, subject: msg.subject, body: msg.body, projectCode: project?.code ?? null,
      replyAddress: this.opts.replyAddress, messageIdDomain: this.opts.messageIdDomain, previousMessageId: previous,
      envelopeFrom: this.opts.envelopeFrom, autonomous: msg.autonomous,
    });
    const now = this.now();
    await db.query(
      `INSERT INTO outbox (id, tenant_id, draft_id, channel, from_address, to_address, subject, body, provider, autonomous, status,
                           project_id, message_id, in_reply_to, reply_to, next_attempt_at)
       VALUES ($1,$2,$3,'email',$4,$5,$6,$7,'smtp',$8,'queued',$9,$10,$11,$12,$13)`,
      [id, msg.tenantId, msg.draftId ?? null, msg.from, msg.to, msg.subject, redact(msg.body, msg.secrets), msg.autonomous ?? false,
        project?.id ?? null, mail.messageId, mail.inReplyTo ?? null, mail.replyTo?.join(', ') ?? null, now],
    );
    await db.query(
      `INSERT INTO outbox_payloads (tenant_id, outbox_id, body_enc) VALUES ($1, $2, pgp_sym_encrypt($3, $4))`,
      [msg.tenantId, id, msg.body, this.opts.dataKey],
    );
    if ((this.opts.sendMode ?? 'immediate') === 'immediate') await this.attempt(db, id, mail, 0, now);
    return { id };
  }

  /** Worker: deliver queued rows and retry failed ones whose backoff has elapsed (current tenant — RLS). */
  async retryDue(db: Db, now: Date = this.now(), limit = 50): Promise<RetryResult> {
    const { rows } = await db.query(
      `SELECT o.*, p.code AS project_code, pgp_sym_decrypt(pl.body_enc, $2) AS full_body
         FROM outbox o JOIN outbox_payloads pl ON pl.outbox_id = o.id LEFT JOIN projects p ON p.id = o.project_id
        WHERE o.provider = 'smtp' AND o.status IN ('queued', 'failed') AND o.next_attempt_at <= $1 AND pl.body_enc IS NOT NULL
        ORDER BY o.next_attempt_at LIMIT $3 FOR UPDATE OF o SKIP LOCKED`,
      [now, this.opts.dataKey, limit]);
    const out: RetryResult = { sent: 0, failed: 0, gaveUp: 0 };
    for (const r of rows) {
      const mail = buildMail({
        outboxId: r.id, from: r.from_address, to: r.to_address, subject: r.subject, body: r.full_body, projectCode: r.project_code,
        replyAddress: this.opts.replyAddress, messageIdDomain: this.opts.messageIdDomain, previousMessageId: r.in_reply_to,
        envelopeFrom: this.opts.envelopeFrom, autonomous: r.autonomous,
      });
      mail.messageId = r.message_id ?? mail.messageId;
      if (r.reply_to) mail.replyTo = String(r.reply_to).split(',').map((s: string) => s.trim()).filter(Boolean);
      const res = await this.attempt(db, r.id, mail, r.attempts, now);
      if (res === 'sent') out.sent++;
      else if (res === 'gave_up') out.gaveUp++;
      else out.failed++;
    }
    return out;
  }

  private async attempt(db: Db, id: string, mail: MailOptions, attemptsSoFar: number, now: Date): Promise<'sent' | 'retry' | 'gave_up'> {
    const attempts = attemptsSoFar + 1;
    try {
      const info = await this.transport.sendMail(mail);
      await db.query(
        `UPDATE outbox SET status = 'sent', sent_at = $2, attempts = $3, last_error = NULL, next_attempt_at = NULL, provider_message_id = $4 WHERE id = $1`,
        [id, now, attempts, info?.messageId ?? null]);
      await db.query('UPDATE outbox_payloads SET body_enc = NULL, purged_at = $2 WHERE outbox_id = $1', [id, now]);
      if (this.opts.log) console.log(`[smtp] ${mail.from} → ${mail.to}: ${mail.subject} (${mail.messageId})`);
      return 'sent';
    } catch (e) {
      const giveUp = attempts >= this.maxAttempts || isPermanentSmtpError(e);
      const error = String((e as Error)?.message ?? e).slice(0, 500);
      await db.query(
        `UPDATE outbox SET status = 'failed', attempts = $2, last_error = $3, next_attempt_at = $4 WHERE id = $1`,
        [id, attempts, error, giveUp ? null : new Date(now.getTime() + retryDelayMs(attempts))]);
      if (giveUp) await db.query('UPDATE outbox_payloads SET body_enc = NULL, purged_at = $2 WHERE outbox_id = $1', [id, now]);
      console.error(`[smtp] delivery ${giveUp ? 'failed permanently' : 'failed (will retry)'} outbox=${id} attempt=${attempts}: ${error}`);
      return giveUp ? 'gave_up' : 'retry';
    }
  }

  private async resolveProject(db: Db, msg: EmailMessage): Promise<{ id: string; code: string } | null> {
    if (msg.projectId) {
      const r = (await db.query('SELECT id, code FROM projects WHERE id = $1', [msg.projectId])).rows[0];
      return r ?? null;
    }
    if (msg.draftId) {
      const r = (await db.query('SELECT p.id, p.code FROM message_drafts d JOIN projects p ON p.id = d.project_id WHERE d.id = $1', [msg.draftId])).rows[0];
      return r ?? null;
    }
    return null;
  }
}
