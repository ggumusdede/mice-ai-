// v0.5-A "Ekip, iletişim ve kontrol" staff routes (contract: packages/shared/src/team.ts).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asUser, device, idParam, list, parse, requireAuth } from './_helpers.js';
import {
  batchApprove, cancelShift, createQuickMessage, createShift, createTeam, currentOnCall, forwardToProject, listQuickApprovals, listShifts,
  listTeams, listUserSettings, myPreferences, participantMessagingMode, quickTemplates, setMyPreferences, setParticipantMessaging,
  updateTeam, updateUserSettings,
} from '../services/team-control.js';
import { grantDisclosure, listDisclosures, listRelationships, revokeDisclosure, setRelationship } from '../services/customer-relations.js';
import { cancelHandover, getHandover, listHandovers, markRead, refreshHandover, startHandover } from '../services/handover.js';
import { fieldPackStatus, issueFieldPack, listFieldPacks, listFieldStaff, revokeFieldPack, setFieldStaff, setGuestFieldInfo } from '../services/field-pack.js';
import { myPerformance, myTeamPerformance, promiseKeeping } from '../services/team-reports.js';

const auth = { preHandler: requireAuth };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const quietHours = z.object({ enabled: z.boolean(), start: hm, end: hm }).nullable();
const period = z.object({ from: day.optional(), to: day.optional() });

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  // ---------------- S-01 hızlı onay
  app.get('/api/quick-approvals', auth, async (req) => asUser(req, async (ctx) => list(await listQuickApprovals(ctx))));
  app.post('/api/decisions/batch-approve', auth, async (req) => {
    const b = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(50), device: z.string().max(200).optional() }), req.body);
    return asUser(req, (ctx) => batchApprove(ctx, b.ids, b.device ?? device(req)));
  });
  app.get('/api/quick-templates', auth, async (req) => asUser(req, async (ctx) => list(quickTemplates(await ctx.rules()))));
  app.post('/api/projects/:id/quick-messages', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({
      template: z.enum(['request_received', 'delay_notice', 'crisis_notice', 'collection_reminder', 'option_release_notice']),
      to: z.string().max(320).optional(), channel: z.enum(['email', 'whatsapp', 'sms']).optional(),
      recipient: z.enum(['customer', 'supplier', 'participant', 'field_contact']).optional(),
      vars: z.record(z.string().max(2000)).optional(),
    }), req.body);
    return asUser(req, (ctx) => createQuickMessage(ctx, id, b));
  });

  // ---------------- nöbet çizelgesi
  app.get('/api/on-call', auth, async (req) => {
    const q = parse(z.object({ from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional() }), req.query);
    return asUser(req, async (ctx) => list(await listShifts(ctx, q)));
  });
  app.get('/api/on-call/now', auth, async (req) => asUser(req, async (ctx) => ({ shift: await currentOnCall(ctx) })));
  app.post('/api/on-call', auth, async (req) => {
    const b = parse(z.object({ userId: z.string().uuid(), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), note: z.string().max(500).optional() }), req.body);
    return asUser(req, (ctx) => createShift(ctx, b));
  });
  app.post('/api/on-call/:id/cancel', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => cancelShift(ctx, id));
  });

  // ---------------- D-2 ekipler + kişi ayarları
  app.get('/api/teams', auth, async (req) => asUser(req, async (ctx) => list(await listTeams(ctx))));
  app.post('/api/teams', auth, async (req) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(120), leaderId: z.string().uuid().nullable().optional(), memberIds: z.array(z.string().uuid()).max(200).optional() }), req.body);
    return asUser(req, (ctx) => createTeam(ctx, b));
  });
  app.patch('/api/teams/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ name: z.string().trim().min(1).max(120).optional(), leaderId: z.string().uuid().nullable().optional(), memberIds: z.array(z.string().uuid()).max(200).optional(), active: z.boolean().optional() }), req.body);
    return asUser(req, (ctx) => updateTeam(ctx, id, b));
  });
  app.get('/api/team-settings/users', auth, async (req) => asUser(req, async (ctx) => list(await listUserSettings(ctx))));
  app.patch('/api/team-settings/users/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ teamId: z.string().uuid().nullable().optional(), deputyUserId: z.string().uuid().nullable().optional(), personalAccountAllowed: z.boolean().optional(), quietHours: quietHours.optional() }), req.body);
    return asUser(req, (ctx) => updateUserSettings(ctx, id, b));
  });
  app.get('/api/me/preferences', auth, async (req) => asUser(req, (ctx) => myPreferences(ctx)));
  app.patch('/api/me/preferences', auth, async (req) => {
    const b = parse(z.object({ quietHours }), req.body);
    return asUser(req, (ctx) => setMyPreferences(ctx, b.quietHours));
  });

  // ---------------- performans (S-10, S-11, S-12, D-2)
  app.get('/api/me/performance', auth, async (req) => {
    const q = parse(period, req.query);
    return asUser(req, (ctx) => myPerformance(ctx, q));
  });
  app.get('/api/reports/my-team-performance', auth, async (req) => {
    const q = parse(period, req.query);
    return asUser(req, (ctx) => myTeamPerformance(ctx, q));
  });
  app.get('/api/reports/promise-keeping', auth, async (req) => asUser(req, (ctx) => promiseKeeping(ctx)));

  // ---------------- S-08 müşteri adı istisnası, K-04 ilişki sahibi
  app.get('/api/customers/:id/disclosures', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => list(await listDisclosures(ctx, id)), ['admin', 'clerk_sales', 'clerk_ops']);
  });
  app.post('/api/customers/:id/disclosures', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ supplierId: z.string().uuid(), reason: z.string().max(500) }), req.body);
    return asUser(req, (ctx) => grantDisclosure(ctx, id, b));
  });
  app.post('/api/disclosures/:id/revoke', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ reason: z.string().max(500).optional() }), req.body);
    return asUser(req, (ctx) => revokeDisclosure(ctx, id, b.reason));
  });
  app.get('/api/customer-relationships', auth, async (req) => asUser(req, async (ctx) => list(await listRelationships(ctx)), ['admin', 'clerk_sales', 'clerk_ops', 'finance']));
  app.patch('/api/customers/:id/relationship', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ ownerId: z.string().uuid().nullable().optional(), backupId: z.string().uuid().nullable().optional() }), req.body);
    return asUser(req, (ctx) => setRelationship(ctx, id, b));
  });

  // ---------------- S-02 katılımcı mesajı, S-09 projeye ilet
  app.get('/api/projects/:id/participant-messaging', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => participantMessagingMode(ctx, id));
  });
  app.patch('/api/projects/:id/participant-messaging', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ mode: z.enum(['off', 'logistics', 'on']), reason: z.string().max(500).default('') }), req.body);
    return asUser(req, (ctx) => setParticipantMessaging(ctx, id, b.mode, b.reason));
  });
  app.post('/api/projects/:id/forward', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ text: z.string().trim().min(1).max(20_000), source: z.enum(['whatsapp', 'email', 'other']).default('whatsapp'), from: z.string().max(200).optional() }), req.body);
    return asUser(req, (ctx) => forwardToProject(ctx, id, b), ['admin', 'clerk_sales', 'clerk_ops', 'field', 'finance', 'signatory']);
  });

  // ---------------- K-05 devir-teslim
  app.get('/api/handovers', auth, async (req) => asUser(req, async (ctx) => list(await listHandovers(ctx))));
  app.post('/api/handovers', auth, async (req) => {
    const b = parse(z.object({
      fromUserId: z.string().uuid(), toUserId: z.string().uuid(), mode: z.enum(['planned', 'urgent']), reason: z.string().max(1000),
      effectiveAt: z.string().datetime({ offset: true }).optional(), biometric: z.object({ method: z.enum(['webauthn', 'dev']) }).passthrough().optional(),
    }), req.body);
    return asUser(req, (ctx) => startHandover(ctx, b));
  });
  app.get('/api/handovers/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => getHandover(ctx, id));
  });
  app.post('/api/handovers/:id/read', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ projectId: z.string().uuid() }), req.body);
    return asUser(req, (ctx) => markRead(ctx, id, b.projectId));
  });
  app.post('/api/handovers/:id/refresh', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => refreshHandover(ctx, id));
  });
  app.post('/api/handovers/:id/cancel', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => cancelHandover(ctx, id));
  });

  // ---------------- S-15 çevrimdışı saha paketi
  app.post('/api/field/packs', auth, async (req) => {
    const b = parse(z.object({ date: day.optional() }), req.body);
    return asUser(req, (ctx) => issueFieldPack(ctx, { date: b.date, device: device(req) }));
  });
  app.get('/api/field/packs', auth, async (req) => asUser(req, async (ctx) => list(await listFieldPacks(ctx))));
  app.get('/api/field/packs/:id/status', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => fieldPackStatus(ctx, id));
  });
  app.post('/api/field/packs/:id/revoke', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ reason: z.string().max(300).optional() }), req.body);
    return asUser(req, (ctx) => revokeFieldPack(ctx, id, b.reason));
  });
  app.get('/api/projects/:id/field-staff', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => list(await listFieldStaff(ctx, id)));
  });
  app.put('/api/projects/:id/field-staff', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ userId: z.string().uuid(), transferGroup: z.string().max(80).nullable().optional(), active: z.boolean().optional() }), req.body);
    return asUser(req, async (ctx) => list(await setFieldStaff(ctx, id, b)));
  });
  app.patch('/api/guests/:id/field-info', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ roomNo: z.string().max(20).nullable().optional(), transferGroup: z.string().max(80).nullable().optional() }), req.body);
    return asUser(req, (ctx) => setGuestFieldInfo(ctx, id, b));
  });

}
