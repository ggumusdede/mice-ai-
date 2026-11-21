// SMS / WhatsApp messaging (§7 Adım 6 field-extra customer approval links, docs/07 WhatsApp answer).
//
// MessagingProvider is the abstraction; OutboxMessagingProvider (the only live one in this phase) records the message in
// the `outbox` table (channel 'sms' | 'whatsapp', one-time links redacted) exactly like the e-mail outbox, so the field lead
// can also share the link manually. WhatsAppCloudProvider is a documented SKELETON — not live.
//
// WhatsApp Cloud API notes (to go live):
//   - Business-initiated messages outside the 24 h customer-service window MUST use a pre-approved template. The field-extra
//     approval uses template `field_extra_approval` (language tr / en) with body params [customer name, project code,
//     description, amount] and a URL button whose dynamic suffix is the one-time token (`/e/{{1}}`) — the token is then the
//     only secret in the request and is redacted from the outbox copy.
//   - POST https://graph.facebook.com/{version}/{phone-number-id}/messages, Authorization: Bearer <system-user token>.
//   - Status webhooks (sent / delivered / read / failed) → update outbox status; inbound replies → intake.
//   - Numbers in E.164 (normalizeMsisdn). Opt-in for WhatsApp is required by Meta policy; record it on the customer contact.
//   - [Doğrulanmalı] template approval times, per-conversation pricing and BSP choice (docs/07).
import type { Db } from '../db/pool.js';
import { OutboxEmailProvider, type EmailMessage } from './email.js';

export type MessagingChannel = 'sms' | 'whatsapp';

export interface MessageTemplate {
  name: string;
  language: string;
  /** body parameters {{1}} … {{n}} */
  params: string[];
  /** dynamic suffix of a URL button (e.g. the one-time token) */
  buttonUrlSuffix?: string;
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

export interface WhatsAppCloudConfig { phoneNumberId: string | null; token: string | null; apiVersion: string }

/** Pure: Graph API request body for a template message. */
export function whatsappTemplatePayload(to: string, t: MessageTemplate): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];
  if (t.params.length) components.push({ type: 'body', parameters: t.params.map((text) => ({ type: 'text', text })) });
  if (t.buttonUrlSuffix) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: t.buttonUrlSuffix }] });
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: (normalizeMsisdn(to) ?? to).replace(/^\+/, ''),
    type: 'template',
    template: { name: t.name, language: { code: t.language }, ...(components.length ? { components } : {}) },
  };
}

/** SKELETON — not live. See the header comment for what is required before enabling it. */
export class WhatsAppCloudProvider implements MessagingProvider {
  readonly name = 'whatsapp_cloud';
  constructor(private cfg: WhatsAppCloudConfig) {}
  /** The request this provider WOULD send (useful for template reviews / tests). */
  buildRequest(msg: MessagingMessage): { url: string; body: Record<string, unknown> } {
    if (!msg.template) throw new Error('WhatsApp business-initiated messages require an approved template');
    return {
      url: `https://graph.facebook.com/${this.cfg.apiVersion}/${this.cfg.phoneNumberId ?? '<phone-number-id>'}/messages`,
      body: whatsappTemplatePayload(msg.to, msg.template),
    };
  }
  async send(_db: Db, _msg: MessagingMessage): Promise<{ id: string }> {
    throw new Error('WhatsApp Cloud API provider is not live in this phase (MESSAGING_PROVIDER=outbox)');
  }
}
