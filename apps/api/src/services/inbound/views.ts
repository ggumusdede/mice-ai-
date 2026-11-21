// "Gelen kutusu" — inbound messages linked to a project (sender, subject, time, link to the resulting offer / intake / task).
import type { InboundMessageSummary } from '@mice/shared';
import type { Ctx } from '../../context.js';
import { notFound } from '../../errors.js';
import { iso } from '../../lib/dates.js';

export type InboundMessageView = InboundMessageSummary;

export async function listProjectInbound(ctx: Ctx, projectId: string | null, id?: string): Promise<InboundMessageView[]> {
  if (projectId) {
    const p = (await ctx.db.query('SELECT id FROM projects WHERE id = $1', [projectId])).rows[0];
    if (!p) throw notFound('Proje');
  }
  const { rows } = await ctx.db.query(
    `SELECT m.*, s.name AS supplier_name, o.version AS offer_version, o.service_item_id AS offer_item_id
       FROM inbound_messages m
       LEFT JOIN suppliers s ON s.id = m.supplier_id
       LEFT JOIN supplier_offers o ON o.id = m.offer_id
      WHERE ($1::uuid IS NULL OR m.project_id = $1) AND ($2::uuid IS NULL OR m.id = $2)
      ORDER BY m.received_at DESC LIMIT 200`, [projectId, id ?? null]);
  return rows.map((r) => ({
    id: r.id, channel: r.channel, source: r.source, fromAddress: r.from_address, senderName: r.sender_name, subject: r.subject,
    preview: String(r.body ?? '').replace(/\s+/g, ' ').slice(0, 240), receivedAt: iso(r.received_at), kind: r.kind, linkMethod: r.link_method,
    status: r.processing_status, note: r.processing_note, supplierId: r.supplier_id, supplierName: r.supplier_name, rfqId: r.rfq_id,
    offerId: r.offer_id, offerVersion: r.offer_version ?? null, serviceItemId: r.offer_item_id ?? null, taskId: r.task_id,
    intakeProjectId: r.intake_project_id, fieldExtraId: r.field_extra_id,
    attachments: ((r.attachments ?? []) as InboundMessageView['attachments']).map((a) => ({ filename: a.filename, size: a.size, accepted: a.accepted, reason: a.reason, usedFor: a.usedFor })),
  }));
}
