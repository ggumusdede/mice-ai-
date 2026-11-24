// Outbound messaging. §3.3: every external message leaves from a HUMAN's own address after human approval
// (single exception: the autonomous RFQ reminder with a pre-approved template, §6).
// No real SMTP in this phase: OutboxEmailProvider writes to the `outbox` table (and the console in dev).
// A production implementation (Google Workspace / Microsoft Graph "send as user") implements the same interface.
import type { Db } from '../db/pool.js';

export interface EmailMessage {
  tenantId: string;
  draftId?: string | null;
  channel?: 'email' | 'whatsapp' | 'sms';
  from: string;
  to: string;
  subject: string | null;
  body: string;
  /** values (e.g. one-time public link tokens) that must never be persisted — redacted in the outbox copy */
  secrets?: string[];
  autonomous?: boolean;
  /** project the message belongs to (reply linking / threading in the SMTP provider; derived from draftId when absent) */
  projectId?: string | null;
  /** sms / whatsapp only: a pre-approved WhatsApp template the live messaging provider may use outside the 24 h window
   *  (field-extra approval / quote reminder are also derived from the draft; critical_alert is passed by the §15 fallback) */
  waTemplate?: { key: 'field_extra' | 'quote_reminder' | 'critical_alert'; params: string[]; buttonPayload?: string; urlSuffix?: string } | null;
}

export interface EmailProvider {
  readonly name: string;
  send(db: Db, msg: EmailMessage): Promise<{ id: string }>;
}

export function redact(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join('[gizli-bağlantı]');
  return out;
}

export class OutboxEmailProvider implements EmailProvider {
  readonly name = 'outbox';
  constructor(private opts: { log?: boolean; onSend?: (msg: EmailMessage) => void } = {}) {}
  async send(db: Db, msg: EmailMessage): Promise<{ id: string }> {
    const body = redact(msg.body, msg.secrets);
    const { rows } = await db.query(
      `INSERT INTO outbox (tenant_id, draft_id, channel, from_address, to_address, subject, body, provider, autonomous)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [msg.tenantId, msg.draftId ?? null, msg.channel ?? 'email', msg.from, msg.to, msg.subject, body, this.name, msg.autonomous ?? false],
    );
    if (this.opts.log) console.log(`[outbox] ${msg.from} → ${msg.to}: ${msg.subject ?? ''}\n${msg.body}\n`);
    this.opts.onSend?.(msg);
    return { id: rows[0].id };
  }
}

/** Test helper: records the full (unredacted) messages in memory in addition to the outbox row. */
export class CapturingEmailProvider extends OutboxEmailProvider {
  readonly sent: EmailMessage[];
  constructor() {
    const sent: EmailMessage[] = [];
    super({ onSend: (m) => sent.push(m) });
    this.sent = sent;
  }
}
