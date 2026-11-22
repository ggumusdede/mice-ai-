// Per-user OAuth "send as me" e-mail (§3.3, docs/07 §6) behind the EmailProvider interface (EMAIL_PROVIDER=oauth).
//
// OAuthEmailProvider: From = the responsible human (resolved by the caller, unchanged); the message is delivered through THAT
// user's connected mailbox (user_mail_accounts, services/mail-accounts.ts):
//   - Google Workspace → GmailApiProvider: POST gmail/v1/users/me/messages/send {raw: base64url(RFC 822), threadId?}
//   - Microsoft 365   → GraphMailProvider: POST /me/messages (MIME, base64) = draft in the user's mailbox, then
//     POST /me/messages/{id}/send (Sent Items; the returned internetMessageId replaces our Message-ID for reply linking).
// The RFC 822 message is built exactly like the SMTP one (buildMail(): Message-ID <outbox-id@domain>, In-Reply-To /
// References to the previous message to the same recipient in the project, X-MICE-Project, plus-addressed Reply-To,
// Auto-Submitted for the pre-approved autonomous reminder) so reply linking does not depend on the provider; Gmail threadId /
// Graph conversationId are kept in outbox.provider_thread_id.
// Sender without a connected mailbox (or needs_reauth): EMAIL_OAUTH_FALLBACK = smtp (SMTP send-as) | outbox (record only) |
// hold (queued + the sender is notified to connect; delivered by the worker once connected; given up after
// EMAIL_OAUTH_HOLD_MAX_HOURS). 401 → one forced token refresh + retry; 429 / 5xx / network → worker retry with backoff;
// other 4xx → permanent. Audit: redacted outbox row + encrypted retry payload (outbox_payloads) as for SMTP.
// Implemented and unit-tested with mocked HTTP; NOT yet tested against live Google / Microsoft mailboxes.
// [Doğrulanmalı] Gmail keeps a client-supplied Message-ID on users.messages.send; Exchange Online may replace it (we then
// store Graph's internetMessageId).
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { Db } from '../db/pool.js';
import { redact, type EmailMessage, type EmailProvider } from './email.js';
import { buildMail, retryDelayMs, type MailOptions, type RetryResult } from './email-smtp.js';
import { HttpError, httpCall, isRetryableStatus } from './integrations-http.js';
import { MailboxNeedsReauth, notifyUserDirect, type OAuthTokenStore } from './mail-accounts.js';

/** Kept for compatibility with the earlier sketch: access token source for a sender address. */
export interface UserMailTokenStore {
  accessToken(db: Db, tenantId: string, fromAddress: string): Promise<{ token: string; provider: 'google' | 'microsoft' } | null>;
}

/** RFC 822 bytes for MailOptions (nodemailer's stream transport — same encoder as the SMTP path, CRLF line ends). */
export async function renderRfc822(mail: MailOptions): Promise<Buffer> {
  const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  const { envelope: _e, sender: _s, ...rest } = mail;
  const info = await t.sendMail({ ...rest, date: new Date() });
  return info.message as Buffer;
}

export interface MailboxSendResult { messageId: string; threadId: string | null; internetMessageId?: string | null; draftId?: string | null }

/** Thin client of one mailbox API. */
export interface MailboxApi {
  readonly name: 'gmail_api' | 'ms_graph';
  send(token: string, raw: Buffer, opts: { threadId?: string | null; existingDraftId?: string | null; timeoutMs?: number }): Promise<MailboxSendResult>;
}

function apiError(r: { status: number; text: string; json: unknown }, what: string): HttpError {
  const j = (r.json ?? {}) as { error?: { message?: string; code?: string | number } };
  return new HttpError(r.status, `${what} ${r.status}: ${j.error?.message ?? r.text.slice(0, 200)}`, isRetryableStatus(r.status), j.error?.code !== undefined ? String(j.error.code) : undefined);
}

export class GmailApiProvider implements MailboxApi {
  readonly name = 'gmail_api' as const;
  constructor(private base = 'https://gmail.googleapis.com/gmail/v1/users/me') {}
  async send(token: string, raw: Buffer, opts: { threadId?: string | null; timeoutMs?: number }): Promise<MailboxSendResult> {
    const r = await httpCall(`${this.base}/messages/send`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: raw.toString('base64url'), ...(opts.threadId ? { threadId: opts.threadId } : {}) }),
    }, opts.timeoutMs);
    const j = (r.json ?? {}) as { id?: string; threadId?: string };
    if (r.status === 200 && j.id) return { messageId: j.id, threadId: j.threadId ?? null };
    throw apiError(r, 'gmail send');
  }
}

export class GraphMailProvider implements MailboxApi {
  readonly name = 'ms_graph' as const;
  constructor(private base = 'https://graph.microsoft.com/v1.0/me') {}
  async send(token: string, raw: Buffer, opts: { existingDraftId?: string | null; timeoutMs?: number }): Promise<MailboxSendResult> {
    let draft: { id: string; conversationId: string | null; internetMessageId: string | null } | null = null;
    if (!opts.existingDraftId) {
      // create in MIME format (Content-Type text/plain, base64 body) → keeps our In-Reply-To / References / X-MICE-* headers
      const c = await httpCall(`${this.base}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' }, body: raw.toString('base64') }, opts.timeoutMs);
      const j = (c.json ?? {}) as { id?: string; conversationId?: string; internetMessageId?: string };
      if (c.status !== 201 || !j.id) throw apiError(c, 'graph create');
      draft = { id: j.id, conversationId: j.conversationId ?? null, internetMessageId: j.internetMessageId ?? null };
    }
    const id = opts.existingDraftId ?? draft!.id;
    const s = await httpCall(`${this.base}/messages/${encodeURIComponent(id)}/send`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0' } }, opts.timeoutMs);
    if (s.status !== 202 && s.status !== 200) {
      const err = apiError(s, 'graph send');
      throw Object.assign(err, { draftId: id });
    }
    return { messageId: id, threadId: draft?.conversationId ?? null, internetMessageId: draft?.internetMessageId ?? null, draftId: id };
  }
}

export interface OAuthEmailOptions {
  replyAddress?: string | null;
  messageIdDomain: string;
  dataKey: string;
  fallback: 'smtp' | 'outbox' | 'hold';
  /** delegate for senders without a mailbox (fallback smtp / outbox) */
  fallbackProvider?: EmailProvider | null;
  holdMaxHours?: number;
  maxAttempts?: number;
  sendMode?: 'immediate' | 'queue';
  timeoutMs?: number;
  log?: boolean;
  now?: () => Date;
  apis?: { google?: MailboxApi; microsoft?: MailboxApi };
}

interface StoredMail { body: string; secrets?: string[] }
const HOLD_RETRY_MS = 10 * 60_000;

export class OAuthEmailProvider implements EmailProvider {
  readonly name = 'oauth';
  private apis: { google: MailboxApi; microsoft: MailboxApi };
  constructor(private tokens: OAuthTokenStore, private opts: OAuthEmailOptions) {
    this.apis = { google: opts.apis?.google ?? new GmailApiProvider(), microsoft: opts.apis?.microsoft ?? new GraphMailProvider() };
  }
  private now(): Date {
    return this.opts.now ? this.opts.now() : new Date();
  }

  async send(db: Db, msg: EmailMessage): Promise<{ id: string }> {
    const account = await this.tokens.accountFor(db, msg.from);
    if (!account && this.opts.fallback !== 'hold' && this.opts.fallbackProvider) return this.opts.fallbackProvider.send(db, msg);
    const id = randomUUID();
    const project = await this.resolveProject(db, msg);
    const prev = project
      ? (await db.query(
          `SELECT message_id, provider, provider_thread_id, from_address FROM outbox WHERE project_id = $1 AND lower(to_address) = lower($2) AND message_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
          [project.id, msg.to])).rows[0] ?? null
      : null;
    const now = this.now();
    const messageId = `<${id}@${this.opts.messageIdDomain}>`;
    const replyTo = this.opts.replyAddress && project ? buildMail({ outboxId: id, from: msg.from, to: msg.to, subject: msg.subject, body: '', projectCode: project.code, replyAddress: this.opts.replyAddress, messageIdDomain: this.opts.messageIdDomain }).replyTo : undefined;
    const threadId = prev && prev.provider === 'gmail_api' && String(prev.from_address).toLowerCase() === msg.from.toLowerCase() ? prev.provider_thread_id : null;
    await db.query(
      `INSERT INTO outbox (id, tenant_id, draft_id, channel, from_address, to_address, subject, body, provider, autonomous, status,
                           project_id, message_id, in_reply_to, reply_to, next_attempt_at, provider_thread_id)
       VALUES ($1,$2,$3,'email',$4,$5,$6,$7,'oauth',$8,'queued',$9,$10,$11,$12,$13,$14)`,
      [id, msg.tenantId, msg.draftId ?? null, msg.from, msg.to, msg.subject, redact(msg.body, msg.secrets), msg.autonomous ?? false,
        project?.id ?? null, messageId, prev?.message_id ?? null, replyTo?.join(', ') ?? null, now, threadId]);
    await db.query(`INSERT INTO outbox_payloads (tenant_id, outbox_id, body_enc) VALUES ($1, $2, pgp_sym_encrypt($3, $4))`,
      [msg.tenantId, id, JSON.stringify({ body: msg.body, secrets: msg.secrets ?? [] } satisfies StoredMail), this.opts.dataKey]);
    if (!account) {
      await this.hold(db, id, msg.from, now, true);
      return { id };
    }
    if ((this.opts.sendMode ?? 'immediate') === 'immediate') {
      const row = (await db.query(`SELECT o.*, p.code AS project_code FROM outbox o LEFT JOIN projects p ON p.id = o.project_id WHERE o.id = $1`, [id])).rows[0];
      await this.attempt(db, row, { body: msg.body, secrets: msg.secrets }, account, now);
    }
    return { id };
  }

  /** No mailbox: keep queued (attempts unchanged), tell the sender once. */
  private async hold(db: Db, id: string, from: string, now: Date, first: boolean): Promise<void> {
    await db.query(`UPDATE outbox SET status = 'queued', last_error = 'MAILBOX_NOT_CONNECTED', next_attempt_at = $2 WHERE id = $1`, [id, new Date(now.getTime() + HOLD_RETRY_MS)]);
    if (!first) return;
    const u = (await db.query('SELECT id FROM users WHERE lower(email) = lower($1) AND active', [from])).rows[0];
    if (u) await notifyUserDirect(db, u.id, 'E-postanız bekletiliyor: posta kutusu bağlı değil', 'Profil → "E-posta hesabını bağla" (Google / Microsoft). Bağladığınızda bekleyen mesajlar kendi adresinizden gider.', 'outbox', id, now);
  }

  private async attempt(db: Db, r: Record<string, any>, p: StoredMail, account: { id: string; provider: 'google' | 'microsoft' }, now: Date): Promise<'sent' | 'retry' | 'gave_up'> {
    const attempts = Number(r.attempts ?? 0) + 1;
    const api = this.apis[account.provider];
    const mail = buildMail({
      outboxId: r.id, from: r.from_address, to: r.to_address, subject: r.subject, body: p.body, projectCode: r.project_code ?? null,
      replyAddress: this.opts.replyAddress, messageIdDomain: this.opts.messageIdDomain, previousMessageId: r.in_reply_to, autonomous: r.autonomous,
    });
    mail.messageId = r.message_id ?? mail.messageId;
    if (r.reply_to) mail.replyTo = String(r.reply_to).split(',').map((s: string) => s.trim()).filter(Boolean);
    try {
      const raw = await renderRfc822(mail);
      const existingDraftId = api.name === 'ms_graph' && r.provider_message_id && r.status !== 'sent' ? r.provider_message_id : null;
      const call = (token: string) => api.send(token, raw, { threadId: r.provider_thread_id, existingDraftId, timeoutMs: this.opts.timeoutMs });
      let res: MailboxSendResult;
      try {
        res = await call(await this.tokens.accessToken(db, account.id));
      } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 401) throw e;
        res = await call(await this.tokens.accessToken(db, account.id, { force: true }));
      }
      await db.query(
        `UPDATE outbox SET status = 'sent', provider = $2, sent_at = $3, attempts = $4, last_error = NULL, next_attempt_at = NULL, provider_message_id = $5,
                provider_thread_id = COALESCE($6, provider_thread_id), message_id = COALESCE($7, message_id) WHERE id = $1`,
        [r.id, api.name, now, attempts, res.messageId, res.threadId, res.internetMessageId && res.internetMessageId !== mail.messageId ? res.internetMessageId : null]);
      await db.query('UPDATE outbox_payloads SET body_enc = NULL, purged_at = $2 WHERE outbox_id = $1', [r.id, now]);
      await this.tokens.markUsed(db, account.id);
      if (this.opts.log) console.log(`[${api.name}] ${mail.from} → ${mail.to}: ${mail.subject} (${res.messageId})`);
      return 'sent';
    } catch (e) {
      if (e instanceof MailboxNeedsReauth) {
        await this.hold(db, r.id, r.from_address, now, false);
        return 'retry';
      }
      const err = e instanceof HttpError ? e : new HttpError(0, String((e as Error)?.message ?? e), true);
      const draftId = (e as { draftId?: string }).draftId ?? null;
      const giveUp = attempts >= (this.opts.maxAttempts ?? 8) || !err.retryable;
      await db.query(
        `UPDATE outbox SET status = 'failed', attempts = $2, last_error = $3, next_attempt_at = $4, provider_message_id = COALESCE($5, provider_message_id) WHERE id = $1`,
        [r.id, attempts, err.message.slice(0, 500), giveUp ? null : new Date(now.getTime() + retryDelayMs(attempts)), draftId]);
      if (giveUp) await db.query('UPDATE outbox_payloads SET body_enc = NULL, purged_at = $2 WHERE outbox_id = $1', [r.id, now]);
      console.error(`[${api.name}] delivery ${giveUp ? 'failed permanently' : 'failed (will retry)'} outbox=${r.id} attempt=${attempts}: ${err.message}`);
      return giveUp ? 'gave_up' : 'retry';
    }
  }

  /** Worker: deliver held / queued rows and retry failed ones (current tenant — RLS); SMTP fallback rows are retried by it. */
  async retryDue(db: Db, now: Date = this.now(), limit = 50): Promise<RetryResult> {
    const out: RetryResult = { sent: 0, failed: 0, gaveUp: 0 };
    const fb = this.opts.fallbackProvider as (EmailProvider & { retryDue?: (db: Db, now: Date) => Promise<RetryResult> }) | null | undefined;
    if (fb?.retryDue) {
      const r = await fb.retryDue(db, now);
      out.sent += r.sent; out.failed += r.failed; out.gaveUp += r.gaveUp;
    }
    const { rows } = await db.query(
      `SELECT o.*, p.code AS project_code, pgp_sym_decrypt(pl.body_enc, $2) AS payload
         FROM outbox o JOIN outbox_payloads pl ON pl.outbox_id = o.id LEFT JOIN projects p ON p.id = o.project_id
        WHERE o.provider IN ('oauth', 'gmail_api', 'ms_graph') AND o.status IN ('queued', 'failed') AND o.next_attempt_at <= $1 AND pl.body_enc IS NOT NULL
        ORDER BY o.next_attempt_at LIMIT $3 FOR UPDATE OF o SKIP LOCKED`, [now, this.opts.dataKey, limit]);
    for (const r of rows) {
      const p = JSON.parse(r.payload) as StoredMail;
      const account = await this.tokens.accountFor(db, r.from_address);
      if (!account) {
        if (this.opts.fallback !== 'hold' && this.opts.fallbackProvider) {
          // mailbox disconnected after queueing → hand over to the configured fallback (new outbox row), close this one
          const moved = await this.opts.fallbackProvider.send(db, { tenantId: r.tenant_id, draftId: r.draft_id, projectId: r.project_id, from: r.from_address, to: r.to_address, subject: r.subject, body: p.body, secrets: p.secrets, autonomous: r.autonomous });
          await db.query(`UPDATE outbox SET status = 'failed', last_error = $2, next_attempt_at = NULL, failure_notified_at = $3 WHERE id = $1`, [r.id, `HANDED_OVER:${moved.id}`, now]);
          await db.query('UPDATE outbox_payloads SET body_enc = NULL, purged_at = $2 WHERE outbox_id = $1', [r.id, now]);
          out.sent++;
        } else if (now.getTime() - new Date(r.created_at).getTime() > (this.opts.holdMaxHours ?? 72) * 3_600_000) {
          await db.query(`UPDATE outbox SET status = 'failed', last_error = 'MAILBOX_NOT_CONNECTED (hold expired)', next_attempt_at = NULL WHERE id = $1`, [r.id]);
          await db.query('UPDATE outbox_payloads SET body_enc = NULL, purged_at = $2 WHERE outbox_id = $1', [r.id, now]);
          out.gaveUp++;
        } else {
          await this.hold(db, r.id, r.from_address, now, false);
          out.failed++;
        }
        continue;
      }
      const res = await this.attempt(db, r, p, account, now);
      if (res === 'sent') out.sent++;
      else if (res === 'gave_up') out.gaveUp++;
      else out.failed++;
    }
    return out;
  }

  private async resolveProject(db: Db, msg: EmailMessage): Promise<{ id: string; code: string } | null> {
    if (msg.projectId) return (await db.query('SELECT id, code FROM projects WHERE id = $1', [msg.projectId])).rows[0] ?? null;
    if (msg.draftId) return (await db.query('SELECT p.id, p.code FROM message_drafts d JOIN projects p ON p.id = d.project_id WHERE d.id = $1', [msg.draftId])).rows[0] ?? null;
    return null;
  }
}
