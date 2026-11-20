// §3.3 İnsan imzası: AI writes drafts in the owner's style; a HUMAN sends them from their OWN address.
import type { DraftRequest } from '@mice/ai';
import type { Language, MessageDraft } from '@mice/shared';
import { roleCan } from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { mapDraft, type Row } from '../lib/mappers.js';
import { logAiAction, recordCorrection } from './ai-log.js';

export type DraftKind = MessageDraft['kind'];

export interface NewDraft {
  projectId: string | null;
  kind: DraftKind;
  channel?: 'email' | 'whatsapp' | 'sms';
  to: string | null;
  subject: string | null;
  body: string;
  language?: Language;
  status?: MessageDraft['status'];
  requiresApproval?: boolean;
  fromUserId?: string | null;
  aiGenerated?: boolean;
  aiActionId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export async function createDraft(ctx: Ctx, d: NewDraft): Promise<Row> {
  const { rows } = await ctx.db.query(
    `INSERT INTO message_drafts (tenant_id, project_id, kind, channel, to_address, subject, body, language, status, requires_approval,
       from_user_id, ai_generated, ai_action_id, entity_type, entity_id)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [d.projectId, d.kind, d.channel ?? 'email', d.to, d.subject, d.body, d.language ?? 'tr', d.status ?? 'draft',
      d.requiresApproval ?? false, d.fromUserId ?? ctx.user?.id ?? null, d.aiGenerated ?? false, d.aiActionId ?? null,
      d.entityType ?? null, d.entityId ?? null],
  );
  return rows[0];
}

/** Style examples learned from earlier human corrections of AI drafts (§15 üslup öğrenme). */
export async function styleExamples(ctx: Ctx, language: Language, limit = 5): Promise<{ before: string; after: string }[]> {
  const { rows } = await ctx.db.query(
    `SELECT original_body, body FROM message_drafts WHERE ai_generated AND original_body IS NOT NULL AND original_body <> body
       AND language = $1 ORDER BY updated_at DESC LIMIT $2`,
    [language, limit],
  );
  return rows.map((r) => ({ before: r.original_body, after: r.body }));
}

/** Autonomous draft generation (§6 'draft_generation') + persisted MessageDraft. */
export async function aiDraft(
  ctx: Ctx,
  req: Omit<DraftRequest, 'styleExamples' | 'senderName'> & { senderName?: string },
  d: Omit<NewDraft, 'subject' | 'body' | 'aiGenerated' | 'aiActionId' | 'language' | 'kind'>,
): Promise<Row> {
  const sender = req.senderName ?? ctx.user?.fullName ?? 'Ekip';
  const result = await ctx.deps.ai.draftMessage({ ...req, senderName: sender, styleExamples: await styleExamples(ctx, req.language) });
  const aiActionId = await logAiAction(ctx, {
    actionType: 'draft_generation', result, projectId: d.projectId, inputSummary: { kind: req.kind, language: req.language },
  });
  const row = await createDraft(ctx, {
    ...d, kind: req.kind, language: req.language, subject: result.data.subject, body: result.data.body, aiGenerated: true, aiActionId,
  });
  await ctx.db.query('UPDATE ai_actions SET entity_type = $2, entity_id = $3 WHERE id = $1', [aiActionId, 'message_draft', row.id]);
  return row;
}

export async function getDraftRow(ctx: Ctx, id: string): Promise<Row> {
  const { rows } = await ctx.db.query('SELECT * FROM message_drafts WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Taslak');
  return rows[0];
}

export async function listDrafts(ctx: Ctx, projectId?: string): Promise<MessageDraft[]> {
  const { rows } = await ctx.db.query(
    `SELECT * FROM message_drafts WHERE ($1::uuid IS NULL OR project_id = $1) ORDER BY created_at DESC LIMIT 500`, [projectId ?? null]);
  return rows.map(mapDraft);
}

/** Human edit of a draft. The first AI version is kept as original_body → style learning (§16.4). */
export async function editDraft(ctx: Ctx, id: string, patch: { body?: string; subject?: string | null; to?: string | null }): Promise<MessageDraft> {
  const d = await getDraftRow(ctx, id);
  if (d.status === 'sent' || d.status === 'discarded') throw conflict('Gönderilmiş/atılmış taslak düzenlenemez', 'DRAFT_CLOSED');
  const { rows } = await ctx.db.query(
    `UPDATE message_drafts SET original_body = COALESCE(original_body, body), body = COALESCE($2, body),
       subject = CASE WHEN $3::boolean THEN $4 ELSE subject END, to_address = CASE WHEN $5::boolean THEN $6 ELSE to_address END
     WHERE id = $1 RETURNING *`,
    [id, patch.body ?? null, patch.subject !== undefined, patch.subject ?? null, patch.to !== undefined, patch.to ?? null],
  );
  if (d.ai_generated && patch.body !== undefined && patch.body !== d.body) {
    await recordCorrection(ctx, d.ai_action_id, { field: 'body', before: d.body, after: patch.body });
  }
  return mapDraft(rows[0]);
}

export interface SendOptions {
  /** replaces placeholders (e.g. one-time links) in the outgoing copy only — never persisted */
  render?: (body: string) => { body: string; secrets: string[] };
  /** sender user (defaults to the current user — the human pressing "send") */
  fromUserId?: string;
  autonomous?: boolean;
  /** skip the approval-state check (used by decision effects that ARE the approval) */
  approvedByDecision?: boolean;
}

/** Sends a draft through the EmailProvider from the human user's own address. */
export async function sendDraft(ctx: Ctx, id: string, opts: SendOptions = {}): Promise<MessageDraft> {
  const d = await getDraftRow(ctx, id);
  if (d.status === 'sent') throw conflict('Taslak zaten gönderildi', 'DRAFT_ALREADY_SENT');
  if (d.status === 'discarded') throw conflict('Atılmış taslak gönderilemez', 'DRAFT_CLOSED');
  if (!opts.approvedByDecision && !opts.autonomous) {
    const user = requireUser(ctx);
    if (d.requires_approval && d.status !== 'approved') throw conflict('Bu mesaj onay bekliyor; onaylanmadan gönderilemez', 'DRAFT_NOT_APPROVED');
    if (d.kind === 'supplier_confirmation' && !roleCan(user.role, 'confirm_supplier')) {
      throw forbidden('Tedarikçi konfirmasyonunu yalnızca yetkili kişi gönderebilir', 'FORBIDDEN');
    }
  }
  if (!d.to_address) throw badRequest('Alıcı adresi yok', undefined, 'RECIPIENT_MISSING');
  const fromUserId = opts.fromUserId ?? ctx.user?.id ?? d.from_user_id;
  const sender = fromUserId ? (await ctx.db.query('SELECT email FROM users WHERE id = $1', [fromUserId])).rows[0] : null;
  if (!sender) throw badRequest('Gönderen kullanıcı bulunamadı', undefined, 'SENDER_MISSING');
  const rendered = opts.render ? opts.render(d.body) : { body: d.body, secrets: [] };
  await ctx.deps.email.send(ctx.db, {
    tenantId: ctx.tenantId, draftId: d.id, channel: d.channel, from: sender.email, to: d.to_address, subject: d.subject,
    body: rendered.body, secrets: rendered.secrets, autonomous: opts.autonomous,
  });
  const { rows } = await ctx.db.query(
    `UPDATE message_drafts SET status = 'sent', sent_at = $2, sent_by = $3, from_address = $4,
       approved_by = COALESCE(approved_by, $5), approved_at = COALESCE(approved_at, $2) WHERE id = $1 RETURNING *`,
    [id, ctx.now(), ctx.user?.id ?? null, sender.email, ctx.user?.id ?? null],
  );
  return mapDraft(rows[0]);
}

export async function approveDraft(ctx: Ctx, id: string, decidedBy: string | null, edits?: Record<string, unknown>): Promise<Row> {
  const d = await getDraftRow(ctx, id);
  if (edits && (typeof edits.body === 'string' || typeof edits.subject === 'string')) {
    await editDraft(ctx, id, { body: typeof edits.body === 'string' ? edits.body : undefined, subject: typeof edits.subject === 'string' ? edits.subject : undefined });
  }
  const { rows } = await ctx.db.query(
    `UPDATE message_drafts SET status = CASE WHEN status = 'sent' THEN status ELSE 'approved' END, approved_by = $2, approved_at = $3 WHERE id = $1 RETURNING *`,
    [d.id, decidedBy, ctx.now()],
  );
  return rows[0];
}

export async function discardDraft(ctx: Ctx, id: string): Promise<void> {
  await ctx.db.query(`UPDATE message_drafts SET status = 'discarded' WHERE id = $1 AND status <> 'sent'`, [id]);
}
