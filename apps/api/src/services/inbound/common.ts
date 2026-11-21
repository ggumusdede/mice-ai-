// Shared by the e-mail and WhatsApp inbound routers: idempotent storage in inbound_messages, failure recording, deterministic
// customer-message classification and the internal follow-up (task + owner notification). Nothing here acts on what a
// message SAYS beyond creating internal work for a human — a customer "we accept" never accepts a quote (§3.2).
import type { AppDeps, Ctx } from '../../context.js';
import { withSystemCtx } from '../../context.js';
import type { Row } from '../../lib/mappers.js';
import { notify } from '../notifications.js';

export interface InboundFields {
  channel: 'email' | 'whatsapp';
  source: string;
  providerMessageId: string;
  fromAddress: string;
  senderName?: string | null;
  toAddresses?: string[];
  ccAddresses?: string[];
  subject?: string | null;
  body: string;
  inReplyTo?: string | null;
  threadRefs?: string[];
  receivedAt: Date;
  attachments?: unknown[];
}

export interface InboundResult {
  id: string;
  duplicate: boolean;
  kind: string | null;
  status: string;
  projectId: string | null;
  intakeProjectId?: string | null;
  offerId?: string | null;
  taskId?: string | null;
  linkMethod?: string | null;
}

const CONFLICT = `ON CONFLICT (tenant_id, channel, provider_message_id) WHERE provider_message_id IS NOT NULL`;

/** Inserts the raw message (status 'received'). Returns duplicate=true for an already processed provider message id;
 *  a previously FAILED row is claimed again (provider retries re-run the processing). */
export async function claimInbound(ctx: Ctx, f: InboundFields): Promise<{ id: string; duplicate: boolean; row?: Row }> {
  const ins = (await ctx.db.query(
    `INSERT INTO inbound_messages (tenant_id, channel, source, provider_message_id, from_address, sender_name, to_addresses, cc_addresses, subject, body,
       in_reply_to, thread_refs, received_at, attachments, processing_status)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'received') ${CONFLICT} DO NOTHING RETURNING id`,
    [f.channel, f.source, f.providerMessageId, f.fromAddress, f.senderName ?? null, f.toAddresses ?? [], f.ccAddresses ?? [], f.subject ?? null, f.body,
      f.inReplyTo ?? null, f.threadRefs ?? [], f.receivedAt, JSON.stringify(f.attachments ?? [])])).rows[0];
  if (ins) return { id: ins.id, duplicate: false };
  const row = (await ctx.db.query(
    `SELECT * FROM inbound_messages WHERE channel = $1 AND provider_message_id = $2 FOR UPDATE`, [f.channel, f.providerMessageId])).rows[0];
  if (row.processing_status !== 'failed') return { id: row.id, duplicate: true, row };
  await ctx.db.query(`UPDATE inbound_messages SET processing_status = 'received', processing_note = NULL, attachments = $2 WHERE id = $1`,
    [row.id, JSON.stringify(f.attachments ?? [])]);
  return { id: row.id, duplicate: false };
}

const COLS: Record<string, string> = {
  projectId: 'project_id', kind: 'kind', linkMethod: 'link_method', supplierId: 'supplier_id', customerId: 'customer_id', rfqId: 'rfq_id',
  offerId: 'offer_id', taskId: 'task_id', outboxId: 'outbox_id', fieldExtraId: 'field_extra_id', intakeProjectId: 'intake_project_id',
  status: 'processing_status', note: 'processing_note',
};
export type InboundPatch = Partial<Record<keyof typeof COLS, string | null>>;

export async function updateInbound(ctx: Ctx, id: string, patch: InboundPatch): Promise<void> {
  const entries = Object.entries(patch).filter(([k, v]) => COLS[k] && v !== undefined);
  if (!entries.length) return;
  const sets = entries.map(([k], i) => `${COLS[k]} = $${i + 2}`).join(', ');
  await ctx.db.query(`UPDATE inbound_messages SET ${sets} WHERE id = $1`, [id, ...entries.map(([, v]) => (v === null ? null : String(v).slice(0, 2000)))]);
}

export function resultOf(id: string, duplicate: boolean, row: Row): InboundResult {
  return {
    id, duplicate, kind: row.kind ?? null, status: row.processing_status, projectId: row.project_id ?? null, intakeProjectId: row.intake_project_id ?? null,
    offerId: row.offer_id ?? null, taskId: row.task_id ?? null, linkMethod: row.link_method ?? null,
  };
}

export async function loadResult(ctx: Ctx, id: string, duplicate: boolean): Promise<InboundResult> {
  return resultOf(id, duplicate, (await ctx.db.query('SELECT * FROM inbound_messages WHERE id = $1', [id])).rows[0]);
}

/** Processing failed (the tenant transaction rolled back): keep the raw message with status 'failed' so nothing is lost and a
 *  provider retry re-runs it. Runs in its own transaction. */
export async function recordInboundFailure(deps: AppDeps, tenantId: string, f: InboundFields, err: unknown): Promise<string | null> {
  const note = (err instanceof Error ? `${(err as { code?: string }).code ?? 'ERROR'}: ${err.message}` : String(err)).slice(0, 500);
  try {
    return await withSystemCtx(deps, tenantId, { type: 'system', id: null }, async (ctx) => {
      const r = (await ctx.db.query(
        `INSERT INTO inbound_messages (tenant_id, channel, source, provider_message_id, from_address, sender_name, to_addresses, cc_addresses, subject, body,
           in_reply_to, thread_refs, received_at, attachments, processing_status, processing_note)
         VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'failed',$14)
         ${CONFLICT} DO UPDATE SET processing_status = 'failed', processing_note = EXCLUDED.processing_note
           WHERE inbound_messages.processing_status IN ('failed', 'received') RETURNING id`,
        [f.channel, f.source, f.providerMessageId, f.fromAddress, f.senderName ?? null, f.toAddresses ?? [], f.ccAddresses ?? [], f.subject ?? null, f.body,
          f.inReplyTo ?? null, f.threadRefs ?? [], f.receivedAt, JSON.stringify(f.attachments ?? []), note])).rows[0];
      return r?.id ?? null;
    });
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ customer messages
const fold = (s: string) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c');

const REVISION = /(revizyon|revize|degisiklik|degistir|guncelle|kisi sayisi|tarih(i|leri)? (degis|kay)|yerine|ekleyebilir|cikarabilir|azalt|artir|revision|revise|amend|change|instead|update the|reduce|increase)/;
const ACCEPT = /(kabul ediyoruz|kabul ettik|kabul edildi|teklifinizi kabul|onayliyoruz|onayladik|onay veriyoruz|onayimizdir|uygun bulduk|devam edelim|ilerleyelim|we accept|accepted|we approve|approved|go ahead|please proceed|confirm(ed)? the (offer|quote|quotation))/;

/** Deterministic, conservative: 'revision' wins over 'acceptance' (an acceptance with changes is a revision). */
export function classifyCustomerText(text: string): 'revision' | 'acceptance' | 'other' {
  const f = fold(text).slice(0, 20_000);
  if (REVISION.test(f)) return 'revision';
  if (ACCEPT.test(f)) return 'acceptance';
  return 'other';
}

/** Customer message on an existing project: always an internal task for the owner + notification. Never auto-accepts. */
export async function customerFollowUp(ctx: Ctx, inboundId: string, project: Row, text: string, channelLabel: string): Promise<{ kind: string; taskId: string | null }> {
  const cls = classifyCustomerText(text);
  const kind = cls === 'revision' ? 'customer_revision' : cls === 'acceptance' ? 'customer_acceptance' : 'customer_reply';
  const title = cls === 'acceptance'
    ? `${project.code}: müşteri ${channelLabel} ile kabul bildiriyor — teklifi kontrol edin, kabulü onay akışıyla kaydedin (otomatik kabul yok)`
    : cls === 'revision'
      ? `${project.code}: müşteri ${channelLabel} ile revizyon istiyor — farkları inceleyin`
      : `${project.code}: müşteriden yeni ${channelLabel} — okuyup yanıtlayın`;
  const taskId = await reviewTask(ctx, { projectId: project.id, assigneeId: project.owner_id ?? null, kind: `inbound_${kind}`, title, inboundId });
  await notify(ctx, {
    userIds: project.owner_id ? [project.owner_id] : undefined, roles: project.owner_id ? undefined : ['admin'],
    priority: cls === 'other' ? 'routine' : 'critical', title, body: text.slice(0, 300), projectId: project.id, entityType: 'inbound_message', entityId: inboundId,
  });
  return { kind, taskId };
}

export async function reviewTask(ctx: Ctx, t: { projectId: string | null; assigneeId: string | null; kind: string; title: string; inboundId: string }): Promise<string | null> {
  const r = (await ctx.db.query(
    `INSERT INTO tasks (tenant_id, project_id, assignee_id, kind, title, due_at, source, origin_key, entity_type, entity_id)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,'rule',$6,'inbound_message',$7) ON CONFLICT (tenant_id, origin_key) DO NOTHING RETURNING id`,
    [t.projectId, t.assigneeId, t.kind, t.title.slice(0, 500), ctx.now(), `inbound:${t.inboundId}`, t.inboundId])).rows[0];
  return r?.id ?? null;
}
