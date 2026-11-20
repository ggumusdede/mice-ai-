import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LoginResponse, MeResponse } from '@mice/shared';
import { withTenant, withoutTenant } from '../db/pool.js';
import { verifyPassword } from '../lib/crypto.js';
import { mapDelegation, mapUser } from '../lib/mappers.js';
import { unauthorized } from '../errors.js';
import { asUser, parse, requireAuth } from './_helpers.js';
import { authenticationOptions, registrationOptions, registrationVerify, verifyAssertion, type RegistrationResponseJSON } from '../auth/webauthn.js';

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req): Promise<LoginResponse> => {
    const body = parse(loginBody, req.body);
    const found = await withoutTenant((db) => db.query('SELECT * FROM auth_lookup_user($1)', [body.email]).then((r) => r.rows[0]));
    if (!found || !found.active || !(await verifyPassword(body.password, found.password_hash))) throw unauthorized('E-posta veya şifre hatalı');
    const user = await withTenant(found.tenant_id, { type: 'user', id: found.user_id }, async (db) =>
      mapUser((await db.query('SELECT * FROM users WHERE id = $1', [found.user_id])).rows[0]));
    const token = app.jwt.sign({ userId: user.id, tenantId: user.tenantId, role: user.role }, { expiresIn: app.deps.config.jwtExpiresIn });
    return { token, user };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req): Promise<MeResponse> =>
    asUser(req, async (ctx) => {
      const tenant = (await ctx.db.query('SELECT id, name FROM tenants WHERE id = app_tenant_id()')).rows[0];
      const dels = (await ctx.db.query('SELECT * FROM delegations WHERE delegate_id = $1 AND ended_at IS NULL AND ends_at > $2', [ctx.user!.id, ctx.now()])).rows;
      return { user: ctx.user!, tenant: { id: tenant.id, name: tenant.name }, activeDelegationsForMe: dels.map(mapDelegation) };
    }));

  app.post('/api/auth/webauthn/register/options', { preHandler: requireAuth }, async (req) => asUser(req, (ctx) => registrationOptions(ctx)));
  app.post('/api/auth/webauthn/register/verify', { preHandler: requireAuth }, async (req) => {
    const body = parse(z.object({ response: z.record(z.unknown()), deviceLabel: z.string().optional() }), req.body);
    return asUser(req, (ctx) => registrationVerify(ctx, body.response as unknown as RegistrationResponseJSON, body.deviceLabel));
  });
  app.post('/api/auth/webauthn/authenticate/options', { preHandler: requireAuth }, async (req) => asUser(req, (ctx) => authenticationOptions(ctx)));
  // (additive) standalone verification — decisions verify the assertion themselves via DecisionInput.biometric
  app.post('/api/auth/webauthn/authenticate/verify', { preHandler: requireAuth }, async (req) => {
    const body = parse(z.object({ response: z.record(z.unknown()) }), req.body);
    return asUser(req, async (ctx) => ({ verified: true, ...(await verifyAssertion(ctx, body.response as never)) }));
  });
}
