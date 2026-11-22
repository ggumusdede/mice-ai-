// §8 İlk veri yükü — admin-only routes (services/initial-import.ts). Every handler checks admin + human actor.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IMPORT_ENTITIES } from '@mice/domain';
import { asUser, idParam, list, parse, readMultipart, requireAuth } from './_helpers.js';
import { badRequest } from '../errors.js';
import {
  abandonBatch, addImportFile, assertImportAdmin, commitBatch, createBatch, editImportRow, getBatchDetail, importTemplate, isImportEntity,
  listBatches, revalidateBatch, reviewImportRows, type ImportUpload,
} from '../services/initial-import.js';

const auth = { preHandler: requireAuth };
const entityEnum = z.enum(IMPORT_ENTITIES);

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/import/templates/:entity', auth, async (req, reply) => {
    const { entity } = parse(z.object({ entity: entityEnum }), req.params);
    const { format } = parse(z.object({ format: z.enum(['xlsx', 'csv']).default('xlsx') }), req.query);
    const file = await asUser(req, async (ctx) => {
      assertImportAdmin(ctx);
      return importTemplate(entity, format);
    });
    reply.header('Content-Type', file.mimeType);
    reply.header('Content-Disposition', `attachment; filename="${file.fileName}"`);
    return reply.send(file.data);
  });

  app.get('/api/import/batches', auth, async (req) => asUser(req, async (ctx) => list(await listBatches(ctx))));
  app.post('/api/import/batches', auth, async (req) => {
    const body = parse(z.object({ label: z.string().max(200).optional() }), req.body);
    return asUser(req, (ctx) => createBatch(ctx, body));
  });
  app.get('/api/import/batches/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => getBatchDetail(ctx, id));
  });
  app.post('/api/import/batches/:id/files', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const mp = await readMultipart(req);
    let entity = mp?.fields.entity;
    let file: ImportUpload | undefined = mp?.file;
    if (!mp) {
      const b = parse(z.object({ entity: entityEnum, fileName: z.string().max(200).optional(), csv: z.string().max(20_000_000).optional(), dataBase64: z.string().max(28_000_000).optional() }), req.body);
      entity = b.entity;
      if (typeof b.csv === 'string') file = { filename: b.fileName ?? `${b.entity}.csv`, mimetype: 'text/csv', buffer: Buffer.from(b.csv, 'utf8') };
      else if (b.dataBase64) file = { filename: b.fileName ?? `${b.entity}.xlsx`, mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(b.dataBase64, 'base64') };
    }
    if (!entity || !isImportEntity(entity)) throw badRequest(`entity alanı gerekli: ${IMPORT_ENTITIES.join(', ')}`, undefined, 'INVALID_ENTITY');
    if (!file) throw badRequest('Dosya gerekli (multipart alan adı: file)', undefined, 'NO_INPUT');
    const e = entity;
    const f = file;
    return asUser(req, (ctx) => addImportFile(ctx, id, e, f));
  });
  app.patch('/api/import/rows/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ input: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])) }), req.body);
    return asUser(req, (ctx) => editImportRow(ctx, id, body.input));
  });
  app.post('/api/import/batches/:id/review', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({
      action: z.enum(['approve', 'reject', 'reset']),
      rowIds: z.array(z.string().uuid()).max(10_000).optional(),
      statuses: z.array(z.enum(['ok', 'warning', 'error'])).optional(),
      entity: entityEnum.optional(),
    }), req.body);
    return asUser(req, (ctx) => reviewImportRows(ctx, id, body));
  });
  app.post('/api/import/batches/:id/revalidate', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => revalidateBatch(ctx, id));
  });
  app.post('/api/import/batches/:id/commit', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => commitBatch(ctx, id));
  });
  app.post('/api/import/batches/:id/abandon', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ reason: z.string().max(500).optional() }), req.body);
    return asUser(req, (ctx) => abandonBatch(ctx, id, body.reason));
  });
}
