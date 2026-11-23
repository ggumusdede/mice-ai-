// v0.5 S-08 müşteri adı gizleme istisnası (müşterinin kendi kurumsal anlaşmalı oteli / tedarikçisi) + K-04 ilişki sahibi ve
// zorunlu yedek irtibat. Admin decides; exceptions are revocable (revoked_at — nothing is deleted, every change is audited).
import type { CustomerDisclosure, CustomerRelationship } from '@mice/shared';
import type { Ctx } from '../context.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { iso } from '../lib/dates.js';
import type { Row } from '../lib/mappers.js';

function assertAdmin(ctx: Ctx): void {
  if (ctx.actor.type !== 'user' || ctx.user?.role !== 'admin') throw forbidden('Bu kararı yalnızca yönetici verir', 'ADMIN_ONLY');
}

const mapDisclosure = (r: Row): CustomerDisclosure => ({
  id: r.id, customerId: r.customer_id, supplierId: r.supplier_id, supplierName: r.supplier_name ?? '', reason: r.reason,
  grantedBy: r.granted_by, grantedByName: r.granted_by_name ?? null, grantedAt: iso(r.granted_at)!, revokedAt: iso(r.revoked_at),
  revokedByName: r.revoked_by_name ?? null, active: !r.revoked_at,
});
const SELECT_DISCLOSURE = `SELECT x.*, s.name AS supplier_name, g.full_name AS granted_by_name, rv.full_name AS revoked_by_name
  FROM customer_supplier_disclosures x JOIN suppliers s ON s.id = x.supplier_id LEFT JOIN users g ON g.id = x.granted_by LEFT JOIN users rv ON rv.id = x.revoked_by`;

export async function listDisclosures(ctx: Ctx, customerId: string): Promise<CustomerDisclosure[]> {
  return (await ctx.db.query(`${SELECT_DISCLOSURE} WHERE x.customer_id = $1 ORDER BY x.revoked_at NULLS FIRST, x.granted_at DESC`, [customerId])).rows.map(mapDisclosure);
}

export async function grantDisclosure(ctx: Ctx, customerId: string, b: { supplierId: string; reason: string }): Promise<CustomerDisclosure> {
  assertAdmin(ctx);
  if (!b.reason.trim()) throw badRequest('Gerekçe zorunlu (ör. "müşterinin kurumsal anlaşmalı oteli")', undefined, 'REASON_REQUIRED');
  if (!(await ctx.db.query('SELECT 1 FROM customers WHERE id = $1', [customerId])).rows[0]) throw notFound('Müşteri');
  if (!(await ctx.db.query('SELECT 1 FROM suppliers WHERE id = $1', [b.supplierId])).rows[0]) throw notFound('Tedarikçi');
  const live = (await ctx.db.query('SELECT id FROM customer_supplier_disclosures WHERE customer_id = $1 AND supplier_id = $2 AND revoked_at IS NULL', [customerId, b.supplierId])).rows[0];
  const id = live?.id ?? (await ctx.db.query(
    `INSERT INTO customer_supplier_disclosures (tenant_id, customer_id, supplier_id, reason, granted_by, granted_at) VALUES (app_tenant_id(), $1,$2,$3,$4,$5) RETURNING id`,
    [customerId, b.supplierId, b.reason.trim(), ctx.user!.id, ctx.now()])).rows[0].id;
  return mapDisclosure((await ctx.db.query(`${SELECT_DISCLOSURE} WHERE x.id = $1`, [id])).rows[0]);
}

export async function revokeDisclosure(ctx: Ctx, id: string, reason: string | undefined): Promise<CustomerDisclosure> {
  assertAdmin(ctx);
  const r = await ctx.db.query(
    `UPDATE customer_supplier_disclosures SET revoked_at = $2, revoked_by = $3, revoke_reason = $4 WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
    [id, ctx.now(), ctx.user!.id, reason?.trim() || null]);
  if (!r.rowCount) throw notFound('Açık istisna');
  return mapDisclosure((await ctx.db.query(`${SELECT_DISCLOSURE} WHERE x.id = $1`, [id])).rows[0]);
}

// ------------------------------------------------------------------ K-04 ilişki sahibi + yedek irtibat
export async function listRelationships(ctx: Ctx): Promise<CustomerRelationship[]> {
  const requireBackup = (await ctx.rules()).requireBackupContact;
  const { rows } = await ctx.db.query(
    `SELECT c.id, c.name, c.relationship_owner_id, o.full_name AS owner_name, c.backup_owner_id, b.full_name AS backup_name
       FROM customers c LEFT JOIN users o ON o.id = c.relationship_owner_id LEFT JOIN users b ON b.id = c.backup_owner_id ORDER BY c.name`);
  return rows.map((r) => ({
    customerId: r.id, customerName: r.name, ownerId: r.relationship_owner_id ?? null, ownerName: r.owner_name ?? null,
    backupId: r.backup_owner_id ?? null, backupName: r.backup_name ?? null, missingBackup: requireBackup && !r.backup_owner_id,
  }));
}

export async function setRelationship(ctx: Ctx, customerId: string, b: { ownerId?: string | null; backupId?: string | null }): Promise<CustomerRelationship> {
  assertAdmin(ctx);
  const cur = (await ctx.db.query('SELECT relationship_owner_id, backup_owner_id FROM customers WHERE id = $1', [customerId])).rows[0];
  if (!cur) throw notFound('Müşteri');
  const owner = b.ownerId !== undefined ? b.ownerId : cur.relationship_owner_id;
  const backup = b.backupId !== undefined ? b.backupId : cur.backup_owner_id;
  if (owner && backup && owner === backup) throw badRequest('Yedek irtibat ilişki sahibinden farklı bir kişi olmalı', undefined, 'BACKUP_SAME_AS_OWNER');
  for (const uid of [owner, backup].filter(Boolean)) {
    const u = (await ctx.db.query('SELECT active FROM users WHERE id = $1', [uid])).rows[0];
    if (!u?.active) throw badRequest('Seçilen kişi aktif değil', undefined, 'USER_INACTIVE');
  }
  await ctx.db.query('UPDATE customers SET relationship_owner_id = $2, backup_owner_id = $3 WHERE id = $1', [customerId, owner ?? null, backup ?? null]);
  return (await listRelationships(ctx)).find((r) => r.customerId === customerId)!;
}
