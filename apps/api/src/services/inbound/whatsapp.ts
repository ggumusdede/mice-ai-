// WhatsApp Cloud API inbound webhook (docs/07 §7): GET verification + POST messages (X-Hub-Signature-256 = HMAC-SHA256 of
// the raw body with the Meta APP SECRET). Messages:
//   - interactive / template quick-reply button whose payload is `extra_approve:<one-time token>` → the same customer approval
//     as the public /e/<token> link (publicApproveExtra), only when the sender's number matches the extra's customer phone
//     (if one is stored) — person (WhatsApp profile name + number), time and amount are recorded;
//   - text from a known customer contact with an open project → attached to that project (+ task / notification);
//   - anything else → new request (runIntake, channel 'whatsapp', duplicate check).
// Media (document / image) is NOT downloaded in this phase (needs the Graph media API + token): stored as a note.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AppDeps, Ctx } from '../../context.js';
import { withSystemCtx } from '../../context.js';
import { setActor, withoutTenant } from '../../db/pool.js';
import type { InboundConfig } from '../../inbound-config.js';
import { sha256Hex } from '../../lib/crypto.js';
import type { Row } from '../../lib/mappers.js';
import { AppError } from '../../errors.js';
import { runIntake } from '../intake.js';
import { normalizeMsisdn } from '../messaging.js';
import { notify } from '../notifications.js';
import { publicApproveExtra } from '../operations.js';
import { claimInbound, customerFollowUp, loadResult, recordInboundFailure, updateInbound, type InboundFields, type InboundResult } from './common.js';

type WaCfg = InboundConfig['whatsapp'];

export function verifyMetaSignature(appSecret: string | null, header: string | undefined, rawBody: Buffer): boolean {
  if (!appSecret || !header) return false;
  const given = Buffer.from(header.replace(/^sha256=/i, '').trim().toLowerCase(), 'utf8');
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'), 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** GET hub.mode=subscribe & hub.verify_token → hub.challenge (string) or null (403). */
export function verifySubscription(cfg: WaCfg, q: Record<string, unknown>): string | null {
  if (!cfg.verifyToken) return null;
  const mode = q['hub.mode'];
  const token = String(q['hub.verify_token'] ?? '');
  const challenge = q['hub.challenge'];
  if (mode !== 'subscribe' || typeof challenge !== 'string' || challenge.length > 200) return null;
  const a = Buffer.from(sha256Hex(token));
  const b = Buffer.from(sha256Hex(cfg.verifyToken));
  return timingSafeEqual(a, b) ? challenge : null;
}

const message = z.object({
  from: z.string().max(32),
  id: z.string().max(300),
  timestamp: z.string().max(20).optional(),
  type: z.string().max(40),
  text: z.object({ body: z.string().max(10_000) }).optional(),
  button: z.object({ payload: z.string().max(1000).optional(), text: z.string().max(1000).optional() }).optional(),
  interactive: z.object({
    type: z.string().max(40),
    button_reply: z.object({ id: z.string().max(1000), title: z.string().max(1000).optional() }).optional(),
    list_reply: z.object({ id: z.string().max(1000), title: z.string().max(1000).optional() }).optional(),
  }).optional(),
  document: z.object({ filename: z.string().max(300).optional(), caption: z.string().max(3000).optional(), mime_type: z.string().max(100).optional() }).passthrough().optional(),
  image: z.object({ caption: z.string().max(3000).optional(), mime_type: z.string().max(100).optional() }).passthrough().optional(),
  context: z.object({ from: z.string().max(32).optional(), id: z.string().max(300).optional() }).optional(),
}).passthrough();

export const whatsappWebhookSchema = z.object({
  object: z.string().max(100),
  entry: z.array(z.object({
    id: z.string().max(100).optional(),
    changes: z.array(z.object({
      field: z.string().max(100),
      value: z.object({
        messaging_product: z.string().max(40).optional(),
        metadata: z.object({ phone_number_id: z.string().max(64), display_phone_number: z.string().max(32).optional() }).optional(),
        contacts: z.array(z.object({ wa_id: z.string().max(32), profile: z.object({ name: z.string().max(300).optional() }).optional() })).max(100).optional(),
        messages: z.array(message).max(100).optional(),
        statuses: z.array(z.unknown()).max(1000).optional(),
      }).passthrough(),
    })).max(100),
  })).max(100),
});
export type WhatsAppWebhook = z.infer<typeof whatsappWebhookSchema>;
type WaMessage = z.infer<typeof message>;

async function tenantForPhoneNumberId(cfg: WaCfg, phoneNumberId: string | undefined): Promise<string | null> {
  const q = (key: string) => withoutTenant((db) => db.query('SELECT tenant_id FROM resolve_inbound_channel($1, $2)', ['whatsapp', key]).then((r) => r.rows[0]?.tenant_id ?? null));
  if (phoneNumberId) {
    const hit = await q(phoneNumberId);
    if (hit) return hit;
    // env fallback (single-tenant / demo): WHATSAPP_PHONE_NUMBER_ID → WHATSAPP_TENANT
    if (cfg.phoneNumberId && cfg.phoneNumberId === phoneNumberId) {
      const viaSlug = await withoutTenant((db) => db.query('SELECT tenant_id FROM resolve_inbound_channel($1, $2)', ['whatsapp', cfg.fallbackTenantSlug]).then((r) => r.rows[0]?.tenant_id ?? null));
      return viaSlug;
    }
  }
  return null;
}

export interface WhatsAppWebhookResult { processed: InboundResult[]; ignored: number }

/** Signature must have been verified by the caller. */
export async function processWhatsAppWebhook(deps: AppDeps, payload: WhatsAppWebhook, cfg: WaCfg): Promise<WhatsAppWebhookResult> {
  const out: WhatsAppWebhookResult = { processed: [], ignored: 0 };
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages' || !change.value.messages?.length) {
        out.ignored += 1; // delivery statuses etc.
        continue;
      }
      const tenantId = await tenantForPhoneNumberId(cfg, change.value.metadata?.phone_number_id);
      if (!tenantId) {
        out.ignored += change.value.messages.length;
        continue;
      }
      for (const m of change.value.messages) {
        const name = change.value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
        out.processed.push(await processWhatsAppMessage(deps, tenantId, m, name));
      }
    }
  }
  return out;
}

function textOf(m: WaMessage): { text: string; payload: string | null } {
  const payload = m.button?.payload ?? m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? null;
  const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
    ?? (m.document ? `[belge: ${m.document.filename ?? 'dosya'}] ${m.document.caption ?? ''}`.trim() : null)
    ?? (m.image ? `[görsel] ${m.image.caption ?? ''}`.trim() : null) ?? `[${m.type}]`;
  return { text: text.slice(0, 10_000), payload };
}

export async function processWhatsAppMessage(deps: AppDeps, tenantId: string, m: WaMessage, profileName: string | null): Promise<InboundResult> {
  const from = normalizeMsisdn(`+${m.from.replace(/^\+/, '')}`) ?? `+${m.from}`;
  const { text, payload } = textOf(m);
  const fields: InboundFields = {
    channel: 'whatsapp', source: 'whatsapp', providerMessageId: m.id, fromAddress: from, senderName: profileName, subject: null, body: text || '(boş ileti)',
    inReplyTo: m.context?.id ?? null, receivedAt: deps.now(),
    attachments: m.document || m.image ? [{ filename: m.document?.filename ?? 'görsel', contentType: m.document?.mime_type ?? m.image?.mime_type ?? '', accepted: false, reason: 'media_not_downloaded' }] : [],
  };
  try {
    return await withSystemCtx(deps, tenantId, { type: 'system', id: null }, async (ctx) => {
      const claim = await claimInbound(ctx, fields);
      if (claim.duplicate) return loadResult(ctx, claim.id, true);
      const approve = payload ? /^extra_approve:([A-Za-z0-9_-]{20,200})$/.exec(payload) : null;
      if (approve) await extraApproval(ctx, claim.id, approve[1], from, profileName);
      else await textMessage(ctx, claim.id, from, text);
      return loadResult(ctx, claim.id, false);
    });
  } catch (e) {
    await recordInboundFailure(deps, tenantId, fields, e);
    throw e;
  }
}

async function extraApproval(ctx: Ctx, id: string, token: string, from: string, profileName: string | null): Promise<void> {
  const t = (await ctx.db.query(`SELECT entity_id FROM public_tokens WHERE purpose = 'extra' AND token_hash = $1 AND revoked_at IS NULL`, [sha256Hex(token)])).rows[0];
  if (!t) {
    await updateInbound(ctx, id, { kind: 'rejected', status: 'ignored', linkMethod: 'button', note: 'Geçersiz onay belirteci' });
    return;
  }
  const extra = (await ctx.db.query('SELECT id, project_id, customer_phone FROM field_extras WHERE id = $1', [t.entity_id])).rows[0];
  await updateInbound(ctx, id, { projectId: extra.project_id, fieldExtraId: extra.id, linkMethod: 'button' });
  const expected = extra.customer_phone ? normalizeMsisdn(extra.customer_phone) : null;
  if (expected && expected !== from) {
    await updateInbound(ctx, id, { kind: 'rejected', status: 'needs_review', note: 'Onay, ekstranın gönderildiği numaradan gelmedi' });
    await notify(ctx, { roles: ['admin'], priority: 'routine', title: 'WhatsApp ekstra onayı farklı numaradan geldi — kaydedilmedi', projectId: extra.project_id, entityType: 'field_extra', entityId: extra.id });
    return;
  }
  await ctx.db.query('SAVEPOINT wa_extra');
  try {
    await setActor(ctx.db, { type: 'customer', id: extra.id });
    await publicApproveExtra(ctx, extra.id, `${(profileName ?? 'Müşteri').slice(0, 150)} (WhatsApp ${from})`);
    await ctx.db.query('RELEASE SAVEPOINT wa_extra');
    await updateInbound(ctx, id, { kind: 'extra_approval', status: 'processed' });
  } catch (e) {
    await ctx.db.query('ROLLBACK TO SAVEPOINT wa_extra');
    if (!(e instanceof AppError)) throw e;
    await updateInbound(ctx, id, { kind: 'extra_approval', status: 'ignored', note: `${e.code}: ${e.message}` });
  } finally {
    await setActor(ctx.db, { type: 'system', id: null });
  }
}

async function contactCustomers(ctx: Ctx, phone: string): Promise<string[]> {
  const rows = (await ctx.db.query(`SELECT id, contacts FROM customers WHERE jsonb_array_length(contacts) > 0`)).rows;
  return rows.filter((c: Row) => ((c.contacts ?? []) as { phone?: string }[]).some((x) => x.phone && normalizeMsisdn(x.phone) === phone)).map((c: Row) => c.id);
}

async function textMessage(ctx: Ctx, id: string, from: string, text: string): Promise<void> {
  const customers = await contactCustomers(ctx, from);
  const project = (await ctx.db.query(
    `SELECT p.* FROM projects p
      WHERE p.outcome IN ('open','won') AND p.closed_at IS NULL
        AND (p.customer_id = ANY($1::uuid[])
             OR p.id IN (SELECT project_id FROM inbound_messages WHERE channel = 'whatsapp' AND from_address = $2 AND project_id IS NOT NULL))
      ORDER BY p.updated_at DESC LIMIT 1`, [customers, from])).rows[0];
  if (project) {
    await updateInbound(ctx, id, { projectId: project.id, linkMethod: 'contact', customerId: project.customer_id ?? null });
    const r = await customerFollowUp(ctx, id, project, text, 'WhatsApp mesajı');
    await updateInbound(ctx, id, { kind: r.kind, taskId: r.taskId, status: 'processed' });
    return;
  }
  const r = await runIntake(ctx, { channel: 'whatsapp', body: text, fromAddress: from, customerId: customers[0], receivedAt: ctx.now().toISOString() }, { inboundId: id, createdBy: null });
  await updateInbound(ctx, id, { kind: 'new_request', status: 'processed', intakeProjectId: r.project.id, projectId: r.project.id, linkMethod: 'new_intake', customerId: customers[0] ?? null });
  const dup = r.duplicates.length ? ` — olası mükerrer: ${r.duplicates.map((d) => d.code).join(', ')}` : '';
  await notify(ctx, { roles: ['admin'], priority: r.duplicates.length ? 'critical' : 'routine', title: `Yeni WhatsApp talebi: ${r.project.code}${dup}`, projectId: r.project.id, entityType: 'inbound_message', entityId: id });
}
