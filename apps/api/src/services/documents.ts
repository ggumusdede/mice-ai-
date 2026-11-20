// Block 6 — documents are generated from data, versioned, with recorded dependencies (§3.1, §3.5).
// When an entity a document read from changes, DB triggers mark it 'stale'; stale documents cannot be sent until regenerated.
// Extension point (phase B): registerDocumentGenerator('program' | 'rooming_list' | 'customer_invoice_draft' | ..., fn).
import type { DocumentKind, GeneratedDocument } from '@mice/shared';
import type { Ctx } from '../context.js';
import { conflict, notFound } from '../errors.js';
import { mapDocument, type Row } from '../lib/mappers.js';

export interface GeneratedDoc {
  content: Record<string, unknown>;
  pdf?: Buffer;
  fileName?: string;
  /** entities read while rendering (precise staleness) */
  deps: { type: string; id: string; version?: number | null }[];
}
export type DocumentGenerator = (ctx: Ctx, args: { projectId: string; entityId: string | null }) => Promise<GeneratedDoc>;
export type RegenerateGuard = (ctx: Ctx, doc: Row) => Promise<void>;

const generators = new Map<DocumentKind, { entityType: string | null; gen: DocumentGenerator; guard?: RegenerateGuard }>();

export function registerDocumentGenerator(kind: DocumentKind, entityType: string | null, gen: DocumentGenerator, guard?: RegenerateGuard): void {
  generators.set(kind, { entityType, gen, guard });
}

const DOC_COLS = 'id, tenant_id, project_id, kind, version, status, stale_reason, generated_at, content, entity_type, entity_id, sent_at, superseded_by, (file_data IS NOT NULL) AS has_file';

export async function generateDocument(ctx: Ctx, kind: DocumentKind, projectId: string, entityId: string | null = null): Promise<Row> {
  const g = generators.get(kind);
  if (!g) throw conflict(`Bu belge türü henüz üretilemiyor: ${kind}`, 'GENERATOR_MISSING');
  const out = await g.gen(ctx, { projectId, entityId });
  const version = (await ctx.db.query('SELECT COALESCE(max(version), 0) + 1 AS v FROM documents WHERE project_id = $1 AND kind = $2', [projectId, kind])).rows[0].v;
  const row = (await ctx.db.query(
    `INSERT INTO documents (tenant_id, project_id, kind, version, status, entity_type, entity_id, content, file_name, mime_type, file_data, generated_by, generated_at)
     VALUES (app_tenant_id(), $1,$2,$3,'current',$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${DOC_COLS}`,
    [projectId, kind, version, entityId ? g.entityType : null, entityId, JSON.stringify(out.content), out.fileName ?? null,
      out.pdf ? 'application/pdf' : null, out.pdf ?? null, ctx.user?.id ?? null, ctx.now()],
  )).rows[0];
  for (const d of out.deps) {
    await ctx.db.query(
      'INSERT INTO document_dependencies (tenant_id, document_id, entity_type, entity_id, entity_version) VALUES (app_tenant_id(), $1,$2,$3,$4)',
      [row.id, d.type, d.id, d.version ?? null],
    );
  }
  // previous versions of the same document (same kind; same entity when entity-scoped) are superseded
  await ctx.db.query(
    `UPDATE documents SET superseded_by = $1 WHERE project_id = $2 AND kind = $3 AND id <> $1 AND superseded_by IS NULL
       AND ($4::uuid IS NULL OR entity_id = $4 OR entity_id IS NULL)`,
    [row.id, projectId, kind, g.entityType === 'quote' ? null : entityId],
  );
  return row;
}

export async function getDocumentRow(ctx: Ctx, id: string): Promise<Row> {
  const { rows } = await ctx.db.query(`SELECT ${DOC_COLS} FROM documents WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('Belge');
  return rows[0];
}

export async function regenerateDocument(ctx: Ctx, id: string): Promise<GeneratedDocument> {
  const doc = await getDocumentRow(ctx, id);
  if (doc.superseded_by) throw conflict('Bu belgenin daha yeni bir sürümü var', 'DOCUMENT_SUPERSEDED');
  const g = generators.get(doc.kind);
  if (g?.guard) await g.guard(ctx, doc);
  const row = await generateDocument(ctx, doc.kind, doc.project_id, doc.entity_id);
  return mapDocument(row);
}

export async function listDocuments(ctx: Ctx, projectId: string, includeHistory = false): Promise<GeneratedDocument[]> {
  const { rows } = await ctx.db.query(
    `SELECT ${DOC_COLS} FROM documents WHERE project_id = $1 ${includeHistory ? '' : 'AND superseded_by IS NULL'} ORDER BY kind, version DESC`, [projectId]);
  return rows.map(mapDocument);
}

export async function getDocumentFile(ctx: Ctx, id: string): Promise<{ fileName: string; mimeType: string; data: Buffer; stale: boolean }> {
  const { rows } = await ctx.db.query('SELECT file_name, mime_type, file_data, status, kind, version FROM documents WHERE id = $1', [id]);
  if (!rows[0] || !rows[0].file_data) throw notFound('Belge dosyası');
  return { fileName: rows[0].file_name ?? `${rows[0].kind}-v${rows[0].version}.pdf`, mimeType: rows[0].mime_type ?? 'application/pdf', data: rows[0].file_data, stale: rows[0].status === 'stale' };
}

/** Latest (non-superseded) document of a kind for an entity. */
export async function latestDocumentFor(ctx: Ctx, kind: DocumentKind, entityType: string, entityId: string): Promise<Row | null> {
  const { rows } = await ctx.db.query(
    `SELECT ${DOC_COLS} FROM documents WHERE kind = $1 AND entity_type = $2 AND entity_id = $3 ORDER BY version DESC LIMIT 1`,
    [kind, entityType, entityId]);
  return rows[0] ?? null;
}
