// v0.5-A "Para ve tedarik çekirdeği" routes: S-19 agency settings (base currency), S-03 contract rates / allotments / supplier options.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CURRENCIES, SERVICE_KINDS } from '@mice/shared';
import { asUser, idParam, list, parse, requireAuth } from './_helpers.js';
import { getSettings, requestBaseCurrencyChange } from '../services/settings.js';
import {
  archiveContractRate, createAllotment, createContractRate, createOption, listAllotments, listContractRates, listOptions, markOptionExtended,
  recordPickup, releaseAllotment, requestOptionExtension, setOptionStatus,
} from '../services/procurement.js';
import { assertFinancialsVisible } from '../services/visibility.js';

const auth = { preHandler: requireAuth };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cur = z.enum(CURRENCIES);

export async function procurementRoutes(app: FastifyInstance): Promise<void> {
  // ---------------- S-19 settings
  app.get('/api/settings', auth, async (req) => asUser(req, (ctx) => getSettings(ctx)));
  app.post('/api/settings/base-currency', auth, async (req) => {
    const b = parse(z.object({ currency: z.string().min(3).max(3), reason: z.string().min(1).max(500) }), req.body);
    return asUser(req, (ctx) => requestBaseCurrencyChange(ctx, b));
  });

  // ---------------- K-11 contract rates
  app.get('/api/contract-rates', auth, async (req) => {
    const q = parse(z.object({ supplierId: z.string().uuid().optional(), all: z.string().optional() }), req.query);
    return asUser(req, async (ctx) => { await assertFinancialsVisible(ctx); return list(await listContractRates(ctx, { supplierId: q.supplierId, includeArchived: q.all === '1' })); });
  });
  app.post('/api/contract-rates', auth, async (req) => {
    const b = parse(z.object({
      supplierId: z.string().uuid(), kind: z.enum(SERVICE_KINDS), roomType: z.string().max(60).nullish(), board: z.string().max(30).nullish(),
      unit: z.string().max(30).optional(), validFrom: date, validTo: date, price: z.number().positive().max(1e9), currency: cur,
      vatIncluded: z.boolean().optional(), conditions: z.string().max(2000).nullish(),
    }), req.body);
    return asUser(req, (ctx) => createContractRate(ctx, b));
  });
  app.post('/api/contract-rates/:id/archive', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => archiveContractRate(ctx, id));
  });

  // ---------------- K-12 allotments
  app.get('/api/allotments', auth, async (req) => {
    const q = parse(z.object({ projectId: z.string().uuid().optional() }), req.query);
    return asUser(req, async (ctx) => list(await listAllotments(ctx, q)));
  });
  app.post('/api/allotments', auth, async (req) => {
    const b = parse(z.object({
      projectId: z.string().uuid().nullish(), serviceItemId: z.string().uuid().nullish(), supplierId: z.string().uuid(), roomType: z.string().max(60).nullish(),
      dateFrom: date, dateTo: date, roomsPerNight: z.number().int().positive().max(5000), ratePerRoomNight: z.number().nonnegative().max(1e7), currency: cur,
      releaseDate: date.nullish(), attritionPct: z.number().min(0).max(1).optional(), penaltyPct: z.number().min(0).max(1).optional(), penaltyTerms: z.string().max(2000).nullish(),
    }), req.body);
    return asUser(req, (ctx) => createAllotment(ctx, b));
  });
  app.post('/api/allotments/:id/pickup', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ date: date.optional(), rooms: z.number().int().min(0).max(5000) }), req.body);
    return asUser(req, (ctx) => recordPickup(ctx, id, b));
  });
  app.post('/api/allotments/:id/release', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ rooms: z.number().int().positive().max(5000), reason: z.string().max(500).optional() }), req.body);
    return asUser(req, (ctx) => releaseAllotment(ctx, id, b));
  });

  // ---------------- K-13 supplier options
  app.get('/api/projects/:id/options', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => list(await listOptions(ctx, id)));
  });
  app.post('/api/projects/:id/options', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({
      serviceItemId: z.string().uuid(), supplierId: z.string().uuid(), offerId: z.string().uuid().nullish(), rank: z.union([z.literal(1), z.literal(2)]).optional(),
      optionUntil: date, note: z.string().max(500).nullish(),
    }), req.body);
    return asUser(req, (ctx) => createOption(ctx, id, b));
  });
  app.post('/api/options/:id/extension-request', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ days: z.number().int().min(1).max(60).optional() }), req.body);
    return asUser(req, (ctx) => requestOptionExtension(ctx, id, b));
  });
  app.post('/api/options/:id/extended', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ optionUntil: date }), req.body);
    return asUser(req, (ctx) => markOptionExtended(ctx, id, b));
  });
  app.post('/api/options/:id/status', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ status: z.enum(['released', 'confirmed']) }), req.body);
    return asUser(req, (ctx) => setOptionStatus(ctx, id, b.status));
  });
}
