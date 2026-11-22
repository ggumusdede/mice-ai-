// SMS / WhatsApp messaging (§7 Adım 6 field-extra customer approval links, §15 critical fallback, docs/07 §7).
//
// MessagingProvider is the abstraction. OutboxMessagingProvider records the message in the `outbox` table only (default).
// LiveMessagingProvider (MESSAGING_PROVIDER=whatsapp_cloud and/or SMS_PROVIDER=http) delivers through
// WhatsAppCloudProvider (Graph API, plain fetch) and HttpSmsProvider (TR gateway, Netgsm-style REST — vendor [Doğrulanmalı]),
// keeps the redacted outbox row + encrypted retry payload (outbox_payloads) like the SMTP provider, retries with backoff in the
// worker and takes delivery receipts from the WhatsApp status webhook (applyWhatsAppStatuses). Implemented and unit-tested with
// mocked HTTP; NOT yet tested against a live WABA / SMS account.
//
// WhatsApp Cloud API notes:
//   - Business-initiated messages outside the 24 h customer-service window MUST use a pre-approved template. The field-extra
//     approval uses template `field_extra_approval` (language tr / en) with body params [customer name, project code,
//     description, amount] and a URL button whose dynamic suffix is the one-time token (`/e/{{1}}`) — the token is then the
//     only secret in the request and is redacted from the outbox copy.
//   - POST https://graph.facebook.com/{version}/{phone-number-id}/messages, Authorization: Bearer <system-user token>.
//   - Status webhooks (sent / delivered / read / failed) → update outbox status; inbound replies → intake.
//   - Numbers in E.164 (normalizeMsisdn). Opt-in for WhatsApp is required by Meta policy; record it on the customer contact.
//   - [Doğrulanmalı] template approval times, per-conversation pricing and BSP choice (docs/07).
import type { Db } from '../db/pool.js';
import type { WhatsAppConfig, SmsConfig } from '../delivery-config.js';
import { OutboxEmailProvider, redact, type EmailMessage } from './email.js';
import { retryDelayMs } from './email-smtp.js';
import { HttpError, httpCall, isRetryableStatus } from './integrations-http.js';

export type MessagingChannel = 'sms' | 'whatsapp';

export interface MessageTemplate {
  name: string;
  language: string;
  /** body parameters {{1}} … {{n}} */
  params: string[];
  /** dynamic suffix of a URL button (e.g. the one-time token) — button index 0 (legacy shape) */
  buttonUrlSuffix?: string;
  /** buttons in template order (index 0, 1 …): quick-reply payload / URL suffix */
  buttons?: ({ type: 'quick_reply'; payload: string } | { type: 'url'; text: string })[];
}

export interface MessagingMessage {
  tenantId: string;
  draftId?: string | null;
  projectId?: string | null;
  channel: MessagingChannel;
  /** responsible human (their e-mail identifies the sender in the outbox / audit, §3.3) */
  from: string;
  /** phone number */
  to: string;
  /** free text (SMS, or WhatsApp inside the 24 h window) */
  body: string;
  template?: MessageTemplate;
  secrets?: string[];
  autonomous?: boolean;
  waTemplate?: EmailMessage['waTemplate'];
}

export interface MessagingProvider {
  readonly name: string;
  send(db: Db, msg: MessagingMessage): Promise<{ id: string }>;
}

/** Turkish-default E.164 normalisation: `0532 123 45 67` / `532…` / `90532…` / `+90 …` → `+905321234567`. null when implausible. */
export function normalizeMsisdn(raw: string, defaultCountry = '90'): string | null {
  const plus = raw.trim().startsWith('+');
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (plus) return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = defaultCountry + d.slice(1);
  else if (d.length === 10 && defaultCountry === '90') d = defaultCountry + d;
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
}

/** Records SMS / WhatsApp messages in the outbox (provider 'outbox', links redacted) — the behaviour before this module. */
export class OutboxMessagingProvider implements MessagingProvider {
  readonly name = 'outbox';
  private outbox: OutboxEmailProvider;
  constructor(opts: { log?: boolean; onSend?: (msg: EmailMessage) => void } = {}) {
    this.outbox = new OutboxEmailProvider(opts);
  }
  send(db: Db, msg: MessagingMessage): Promise<{ id: string }> {
    return this.outbox.send(db, {
      tenantId: msg.tenantId, draftId: msg.draftId, channel: msg.channel, from: msg.from, to: msg.to, subject: null,
      body: msg.body, secrets: msg.secrets, autonomous: msg.autonomous, projectId: msg.projectId,
    });
  }
}

export type WhatsAppCloudConfig = Pick<WhatsAppConfig, 'phoneNumberId' | 'token' | 'apiVersion'> & { timeoutMs?: number };

/** Pure: Graph API request body for a template message. */
export function whatsappTemplatePayload(to: string, t: MessageTemplate): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];
  if (t.params.length) components.push({ type: 'body', parameters: t.params.map((text) => ({ type: 'text', text })) });
  if (t.buttonUrlSuffix) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: t.buttonUrlSuffix }] });
  (t.buttons ?? []).forEach((b, i) => components.push(b.type === 'quick_reply'
    ? { type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload: b.payload }] }
    : { type: 'button', sub_type: 'url', index: String(i), parameters: [{ type: 'text', text: b.text }] }));
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: waNumber(to),
    type: 'template',
    template: { name: t.name, language: { code: t.language }, ...(components.length ? { components } : {}) },
  };
}

const waNumber = (to: string) => (normalizeMsisdn(to) ?? to).replace(/^\+/, '');

/** Pure: free-form text inside the 24 h customer-service window. */
export function whatsappTextPayload(to: string, body: string): Record<string, unknown> {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: waNumber(to), type: 'text', text: { preview_url: false, body: body.slice(0, 4096) } };
}

/** Pure: interactive reply-button message (inside the window) — the button id reaches the inbound handler as button_reply.id. */
export function whatsappButtonPayload(to: string, body: string, button: { id: string; title: string }): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: waNumber(to), type: 'interactive',
    interactive: { type: 'button', body: { text: body.slice(0, 1024) }, action: { buttons: [{ type: 'reply', reply: { id: button.id.slice(0, 256), title: button.title.slice(0, 20) } }] } },
  };
}

/** WhatsApp error codes that are worth retrying (rate limits / temporary). Everything else in 4xx is permanent. */
const WA_RETRYABLE_CODES = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 131048, 131056, 133004]);

/** Graph API sender (POST /{phone-number-id}/messages, Bearer system-user token). Outbound requests carry no signature —
 *  X-Hub-Signature-256 is only on Meta's webhooks to us. */
export class WhatsAppCloudProvider implements MessagingProvider {
  readonly name = 'whatsapp_cloud';
  constructor(private cfg: WhatsAppCloudConfig) {}
  get configured(): boolean {
    return !!(this.cfg.token && this.cfg.phoneNumberId);
  }
  /** The template request this provider sends (template reviews / tests). */
  buildRequest(msg: MessagingMessage): { url: string; body: Record<string, unknown> } {
    if (!msg.template) throw new Error('WhatsApp business-initiated messages require an approved template');
    return { url: this.url(), body: whatsappTemplatePayload(msg.to, msg.template) };
  }
  private url(): string {
    return `https://graph.facebook.com/${this.cfg.apiVersion}/${this.cfg.phoneNumberId ?? '<phone-number-id>'}/messages`;
  }
  /** POST one payload; returns the wamid. Throws HttpError (retryable flag set). */
  async post(body: Record<string, unknown>): Promise<{ messageId: string }> {
    if (!this.configured) throw new HttpError(0, 'WhatsApp Cloud API not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)', false, 'NOT_CONFIGURED');
    const r = await httpCall(this.url(), { method: 'POST', headers: { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, this.cfg.timeoutMs ?? 10_000);
    const j = (r.json ?? {}) as { messages?: { id?: string }[]; error?: { code?: number; message?: string; error_data?: { details?: string } } };
    if (r.status >= 200 && r.status < 300 && j.messages?.[0]?.id) return { messageId: j.messages[0].id };
    const code = j.error?.code;
    const retryable = isRetryableStatus(r.status) || (code !== undefined && WA_RETRYABLE_CODES.has(code));
    throw new HttpError(r.status, `whatsapp ${r.status}${code ? ` #${code}` : ''}: ${j.error?.message ?? r.text.slice(0, 200)}${j.error?.error_data?.details ? ` (${j.error.error_data.details})` : ''}`, retryable, code ? String(code) : undefined);
  }
  /** Stateless send (no outbox bookkeeping) — LiveMessagingProvider is what services use. */
  async send(_db: Db, msg: MessagingMessage): Promise<{ id: string }> {
    const body = msg.template ? whatsappTemplatePayload(msg.to, msg.template) : whatsappTextPayload(msg.to, msg.body);
    const r = await this.post(body);
    return { id: r.messageId };
  }
}

// ---------------------------------------------------------------- SMS

/** Netgsm-style result codes ([Doğrulanmalı] against the chosen vendor's current documentation). */
const SMS_PERMANENT_CODES: Record<string, string> = {
  '20': 'mesaj metni / uzunluk hatası', '30': 'geçersiz kullanıcı adı / şifre veya API erişim izni yok', '40': 'mesaj başlığı (gönderici adı) tanımlı değil',
  '50': 'İYS kontrollü gönderim yapılamıyor', '51': 'İYS marka kodu bulunamadı', '70': 'hatalı / eksik parametre',
};
const SMS_RETRYABLE_CODES: Record<string, string> = { '80': 'gönderim sınır aşımı', '85': 'mükerrer gönderim sınırı', '100': 'sistem hatası', '101': 'sistem hatası' };

/** Pure: request of the generic TR SMS gateway (JSON, Basic auth). */
export function smsRequest(cfg: SmsConfig, to: string, text: string): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (cfg.user) headers.Authorization = `Basic ${Buffer.from(`${cfg.user}:${cfg.password ?? ''}`).toString('base64')}`;
  return {
    url: cfg.url,
    headers,
    body: {
      msgheader: cfg.sender,
      encoding: cfg.encoding,
      ...(cfg.iysFilter !== '' ? { iysfilter: cfg.iysFilter } : {}),
      messages: [{ msg: text, no: (normalizeMsisdn(to) ?? to).replace(/^\+/, '') }],
    },
  };
}

/** Generic HTTP SMS gateway, shaped after Netgsm's REST v2 (`{code:'00', jobid}` on success). The exact vendor (Netgsm,
 *  İleti Merkezi, …) and its contract must be confirmed before go-live [Doğrulanmalı]; adapt smsRequest / parse only. */
export class HttpSmsProvider implements MessagingProvider {
  readonly name = 'sms_http';
  constructor(private cfg: SmsConfig) {}
  async deliver(to: string, text: string): Promise<{ messageId: string }> {
    const req = smsRequest(this.cfg, to, text);
    const r = await httpCall(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) }, this.cfg.timeoutMs);
    if (r.status < 200 || r.status >= 300) throw new HttpError(r.status, `sms gateway HTTP ${r.status}: ${r.text.slice(0, 200)}`, isRetryableStatus(r.status));
    const j = (r.json ?? {}) as { code?: string | number; jobid?: string | number; jobID?: string | number; description?: string };
    // JSON {code, jobid} or legacy plain text "00 123456"
    const plain = /^\s*(\d{2,3})(?:\s+(\S+))?/.exec(r.text);
    const code = j.code !== undefined ? String(j.code) : plain?.[1] ?? '';
    const job = String(j.jobid ?? j.jobID ?? plain?.[2] ?? '');
    if ((code === '00' || code === '0') && job) return { messageId: job };
    if (SMS_PERMANENT_CODES[code]) throw new HttpError(r.status, `sms gateway code ${code}: ${SMS_PERMANENT_CODES[code]}`, false, code);
    throw new HttpError(r.status, `sms gateway code ${code || '?'}: ${SMS_RETRYABLE_CODES[code] ?? j.description ?? r.text.slice(0, 200)}`, true, code || undefined);
  }
  async send(_db: Db, msg: MessagingMessage): Promise<{ id: string }> {
    return { id: (await this.deliver(msg.to, msg.body)).messageId };
  }
}

// ---------------------------------------------------------------- live routing + outbox bookkeeping

export interface LiveMessagingOptions {
  whatsapp: WhatsAppConfig | null;
  sms: SmsConfig | null;
  dataKey: string;
  maxAttempts?: number;
  sendMode?: 'immediate' | 'queue';
  log?: boolean;
  now?: () => Date;
}

interface Plan { channel: 'whatsapp' | 'sms'; mode: 'template' | 'text' | 'button'; template?: MessageTemplate; button?: { id: string; title: string } }
interface StoredPayload { body: string; plan: Plan; secrets?: string[]; fallbackSms?: boolean }

export interface MessagingRetryResult { sent: number; failed: number; gaveUp: number }

/** Resolves the pre-approved template for a message: explicit `waTemplate`, else from the draft (field extra / quote follow-up). */
export async function resolveWhatsAppTemplate(db: Db, msg: MessagingMessage, wa: WhatsAppConfig): Promise<{ template: MessageTemplate; button?: { id: string; title: string } } | null> {
  const t = wa.templates;
  if (msg.waTemplate) {
    const ref = msg.waTemplate.key === 'field_extra' ? t.fieldExtra : msg.waTemplate.key === 'quote_reminder' ? t.quoteReminder : t.criticalAlert;
    const buttons: NonNullable<MessageTemplate['buttons']> = [];
    if (msg.waTemplate.buttonPayload) buttons.push({ type: 'quick_reply', payload: msg.waTemplate.buttonPayload });
    if (msg.waTemplate.urlSuffix) buttons.push({ type: 'url', text: msg.waTemplate.urlSuffix });
    return { template: { name: ref.name, language: ref.language, params: msg.waTemplate.params, ...(buttons.length ? { buttons } : {}) },
      button: msg.waTemplate.buttonPayload ? { id: msg.waTemplate.buttonPayload, title: 'Onaylıyorum' } : undefined };
  }
  if (!msg.draftId) return null;
  const d = (await db.query(
    `SELECT d.kind, d.entity_type, d.entity_id, u.full_name AS sender_name, p.code, c.name AS customer_name
       FROM message_drafts d LEFT JOIN users u ON u.id = d.from_user_id LEFT JOIN projects p ON p.id = d.project_id
       LEFT JOIN customers c ON c.id = p.customer_id WHERE d.id = $1`, [msg.draftId])).rows[0];
  if (!d) return null;
  if (d.entity_type === 'field_extra' && msg.secrets?.[0]) {
    const e = (await db.query('SELECT description, amount_try FROM field_extras WHERE id = $1', [d.entity_id])).rows[0];
    if (!e) return null;
    const token = msg.secrets[0];
    const payload = `extra_approve:${token}`;
    const buttons: NonNullable<MessageTemplate['buttons']> = [{ type: 'quick_reply', payload }];
    if (t.fieldExtra.urlButton) buttons.push({ type: 'url', text: token });
    const amount = `${Number(e.amount_try).toLocaleString('tr-TR')} TL`;
    return {
      template: { name: t.fieldExtra.name, language: t.fieldExtra.language, params: [d.customer_name ?? '-', d.code ?? '-', String(e.description).slice(0, 200), amount, d.sender_name ?? '-'], buttons },
      button: { id: payload, title: 'Onaylıyorum' },
    };
  }
  if (d.kind === 'quote_followup') {
    const q = d.entity_type === 'quote' ? (await db.query('SELECT option_until FROM quotes WHERE id = $1', [d.entity_id])).rows[0] : null;
    return { template: { name: t.quoteReminder.name, language: t.quoteReminder.language, params: [d.customer_name ?? '-', d.code ?? '-', q?.option_until ? String(q.option_until) : '-', d.sender_name ?? '-'] } };
  }
  return null;
}

/** 24 h customer-service window: the number wrote to us on WhatsApp within the last 24 h (inbound_messages, current tenant). */
export async function whatsappWindowOpen(db: Db, to: string, now: Date): Promise<boolean> {
  const n = normalizeMsisdn(to);
  if (!n) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM inbound_messages WHERE channel = 'whatsapp' AND from_address = $1 AND received_at > $2 LIMIT 1`, [n, new Date(now.getTime() - 24 * 3_600_000)]);
  return rows.length > 0;
}

export class LiveMessagingProvider implements MessagingProvider {
  readonly name = 'live';
  readonly whatsapp: WhatsAppCloudProvider | null;
  readonly sms: HttpSmsProvider | null;
  private outbox: OutboxMessagingProvider;
  private maxAttempts: number;
  constructor(private opts: LiveMessagingOptions) {
    this.whatsapp = opts.whatsapp && opts.whatsapp.token && opts.whatsapp.phoneNumberId ? new WhatsAppCloudProvider(opts.whatsapp) : null;
    this.sms = opts.sms ? new HttpSmsProvider(opts.sms) : null;
    this.outbox = new OutboxMessagingProvider({ log: opts.log });
    this.maxAttempts = opts.maxAttempts ?? 6;
  }
  get live(): boolean {
    return !!(this.whatsapp || this.sms);
  }
  private now(): Date {
    return this.opts.now ? this.opts.now() : new Date();
  }

  /** Channel order: whatsapp messages → WhatsApp then SMS; sms messages that have a template (field-extra approval, critical
   *  alert) → WhatsApp first, plain sms → SMS first. WhatsApp is only usable with an approved template or an open 24 h window. */
  async plan(db: Db, msg: MessagingMessage): Promise<Plan | null> {
    const tpl = this.whatsapp && this.opts.whatsapp ? await resolveWhatsAppTemplate(db, msg, this.opts.whatsapp) : null;
    const order: ('whatsapp' | 'sms')[] = msg.channel === 'whatsapp' || tpl ? ['whatsapp', 'sms'] : ['sms', 'whatsapp'];
    for (const ch of order) {
      if (ch === 'sms' && this.sms) return { channel: 'sms', mode: 'text' };
      if (ch === 'whatsapp' && this.whatsapp) {
        const open = await whatsappWindowOpen(db, msg.to, this.now());
        if (open) return tpl?.button ? { channel: 'whatsapp', mode: 'button', button: tpl.button } : { channel: 'whatsapp', mode: 'text' };
        if (tpl) return { channel: 'whatsapp', mode: 'template', template: tpl.template };
      }
    }
    return null;
  }

  async send(db: Db, msg: MessagingMessage): Promise<{ id: string }> {
    const plan = await this.plan(db, msg);
    // nothing deliverable (no live channel / closed window without template): record in the outbox as before
    if (!plan) return this.outbox.send(db, msg);
    return this.enqueue(db, msg, plan, { body: msg.body, plan, secrets: msg.secrets, fallbackSms: plan.channel === 'whatsapp' && !!this.sms });
  }

  private async enqueue(db: Db, msg: Pick<MessagingMessage, 'tenantId' | 'draftId' | 'projectId' | 'from' | 'to' | 'body' | 'secrets' | 'autonomous'>, plan: Plan, payload: StoredPayload): Promise<{ id: string }> {
    const now = this.now();
    const to = normalizeMsisdn(msg.to);
    const provider = plan.channel === 'whatsapp' ? 'whatsapp_cloud' : 'sms_http';
    const { rows } = await db.query(
      `INSERT INTO outbox (tenant_id, draft_id, channel, from_address, to_address, subject, body, provider, autonomous, status, project_id, next_attempt_at, last_error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [msg.tenantId, msg.draftId ?? null, plan.channel, msg.from, to ?? msg.to, plan.template ? `template:${plan.template.name}` : null, redact(msg.body, msg.secrets),
        provider, msg.autonomous ?? false, to ? 'queued' : 'failed', msg.projectId ?? null, to ? now : null, to ? null : 'INVALID_PHONE']);
    const id = rows[0].id as string;
    if (!to) return { id };
    await db.query(`INSERT INTO outbox_payloads (tenant_id, outbox_id, body_enc) VALUES ($1, $2, pgp_sym_encrypt($3, $4))`,
      [msg.tenantId, id, JSON.stringify(payload), this.opts.dataKey]);
    if ((this.opts.sendMode ?? 'immediate') === 'immediate') await this.attempt(db, { id, to, from: msg.from, tenantId: msg.tenantId, draftId: msg.draftId ?? null, projectId: msg.projectId ?? null, autonomous: !!msg.autonomous }, payload, 0, now);
    return { id };
  }

  private async attempt(db: Db, row: { id: string; to: string; from: string; tenantId: string; draftId: string | null; projectId: string | null; autonomous: boolean }, p: StoredPayload, attemptsSoFar: number, now: Date): Promise<'sent' | 'retry' | 'gave_up'> {
    const attempts = attemptsSoFar + 1;
    try {
      let messageId: string;
      if (p.plan.channel === 'sms') messageId = (await this.sms!.deliver(row.to, p.body)).messageId;
      else {
        const body = p.plan.mode === 'template' ? whatsappTemplatePayload(row.to, p.plan.template!)
          : p.plan.mode === 'button' ? whatsappButtonPayload(row.to, p.body, p.plan.button!) : whatsappTextPayload(row.to, p.body);
        messageId = (await this.whatsapp!.post(body)).messageId;
      }
      await db.query(
        `UPDATE outbox SET status = 'sent', sent_at = $2, attempts = $3, last_error = NULL, next_attempt_at = NULL, provider_message_id = $4, delivery_status = 'sent' WHERE id = $1`,
        [row.id, now, attempts, messageId]);
      await db.query('UPDATE outbox_payloads SET body_enc = NULL, purged_at = $2 WHERE outbox_id = $1', [row.id, now]);
      if (this.opts.log) console.log(`[${p.plan.channel}] ${row.from} → ${row.to} (${messageId})`);
      return 'sent';
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(0, String((e as Error)?.message ?? e), true);
      const giveUp = attempts >= this.maxAttempts || !err.retryable;
      await db.query(`UPDATE outbox SET status = 'failed', attempts = $2, last_error = $3, next_attempt_at = $4 WHERE id = $1`,
        [row.id, attempts, err.message.slice(0, 500), giveUp ? null : new Date(now.getTime() + retryDelayMs(attempts))]);
      if (giveUp) {
        await db.query('UPDATE outbox_payloads SET body_enc = NULL, purged_at = $2 WHERE outbox_id = $1', [row.id, now]);
        // WhatsApp refused permanently (e.g. not a WhatsApp number) → one SMS fallback when configured
        if (p.plan.channel === 'whatsapp' && p.fallbackSms && this.sms) {
          const sms = await this.enqueue(db, { ...row, body: p.body, secrets: p.secrets }, { channel: 'sms', mode: 'text' }, { body: p.body, plan: { channel: 'sms', mode: 'text' }, secrets: p.secrets });
          await db.query(`UPDATE outbox SET last_error = $2, failure_notified_at = $3 WHERE id = $1`, [row.id, `${err.message.slice(0, 400)} → SMS ${sms.id}`, now]);
        }
      }
      console.error(`[${p.plan.channel}] delivery ${giveUp ? 'failed permanently' : 'failed (will retry)'} outbox=${row.id} attempt=${attempts}: ${err.message}`);
      return giveUp ? 'gave_up' : 'retry';
    }
  }

  /** Worker: deliver queued / retry failed WhatsApp + SMS rows whose backoff has elapsed (current tenant — RLS). */
  async retryDue(db: Db, now: Date = this.now(), limit = 50): Promise<MessagingRetryResult> {
    const { rows } = await db.query(
      `SELECT o.*, pgp_sym_decrypt(pl.body_enc, $2) AS payload FROM outbox o JOIN outbox_payloads pl ON pl.outbox_id = o.id
        WHERE o.provider IN ('whatsapp_cloud', 'sms_http') AND o.status IN ('queued', 'failed') AND o.next_attempt_at <= $1 AND pl.body_enc IS NOT NULL
        ORDER BY o.next_attempt_at LIMIT $3 FOR UPDATE OF o SKIP LOCKED`, [now, this.opts.dataKey, limit]);
    const out: MessagingRetryResult = { sent: 0, failed: 0, gaveUp: 0 };
    for (const r of rows) {
      const p = JSON.parse(r.payload) as StoredPayload;
      if ((p.plan.channel === 'whatsapp' && !this.whatsapp) || (p.plan.channel === 'sms' && !this.sms)) continue;
      const res = await this.attempt(db, { id: r.id, to: r.to_address, from: r.from_address, tenantId: r.tenant_id, draftId: r.draft_id, projectId: r.project_id, autonomous: r.autonomous }, p, r.attempts, now);
      if (res === 'sent') out.sent++;
      else if (res === 'gave_up') out.gaveUp++;
      else out.failed++;
    }
    return out;
  }
}

// ---------------------------------------------------------------- WhatsApp status webhook → outbox

const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

/** statuses[] of the Cloud API webhook (`{id: wamid, status: sent|delivered|read|failed, timestamp, errors?}`) → outbox delivery
 *  receipt (never downgrades read → delivered). `failed` marks the row failed (sender + admin are told by the worker). */
export async function applyWhatsAppStatuses(db: Db, statuses: unknown[]): Promise<number> {
  let n = 0;
  for (const raw of statuses) {
    const s = raw as { id?: unknown; status?: unknown; timestamp?: unknown; errors?: { code?: number; title?: string; message?: string }[] };
    if (typeof s?.id !== 'string' || typeof s.status !== 'string' || s.id.length > 300) continue;
    const at = typeof s.timestamp === 'string' && /^\d{1,12}$/.test(s.timestamp) ? new Date(Number(s.timestamp) * 1000) : new Date();
    const row = (await db.query(`SELECT id, delivery_status FROM outbox WHERE provider = 'whatsapp_cloud' AND provider_message_id = $1 FOR UPDATE`, [s.id])).rows[0];
    if (!row) continue;
    if (s.status === 'failed') {
      const e = s.errors?.[0];
      await db.query(`UPDATE outbox SET status = 'failed', delivery_status = 'failed', next_attempt_at = NULL, last_error = $2 WHERE id = $1`,
        [row.id, `whatsapp status failed${e?.code ? ` #${e.code}` : ''}: ${e?.title ?? e?.message ?? ''}`.slice(0, 500)]);
      n++;
    } else if (STATUS_RANK[s.status] && STATUS_RANK[s.status] > (STATUS_RANK[row.delivery_status] ?? 0)) {
      await db.query(
        `UPDATE outbox SET delivery_status = $2, delivered_at = CASE WHEN $2 IN ('delivered','read') THEN COALESCE(delivered_at, $3) ELSE delivered_at END,
                read_at = CASE WHEN $2 = 'read' THEN $3 ELSE read_at END WHERE id = $1`, [row.id, s.status, at]);
      n++;
    }
  }
  return n;
}
