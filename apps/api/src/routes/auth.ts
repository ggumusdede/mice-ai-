import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { rateLimitStore } from '../rate-limit-store.js';
import { z } from 'zod';
import type { LoginResponse, MeResponse, Role } from '@mice/shared';
import { withTenant, withoutTenant } from '../db/pool.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { mapDelegation, mapUser } from '../lib/mappers.js';
import { badRequest, forbidden, unauthorized } from '../errors.js';
import { asUser, parse, requireAuth } from './_helpers.js';
import { authenticationOptions, registrationOptions, registrationVerify, verifyAssertion, type RegistrationResponseJSON } from '../auth/webauthn.js';

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

// Unknown e-mail → still run one scrypt verification so the response time does not reveal which accounts exist.
let dummyHash: Promise<string> | null = null;

/** Session JWT; `tv` = users.token_version (checked on every request in withUserCtx). */
function signSession(app: FastifyInstance, userId: string, tenantId: string, role: Role, tv: number): string {
  return app.jwt.sign({ userId, tenantId, role, tv }, { expiresIn: app.deps.config.jwtExpiresIn });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // encapsulated in this plugin; only routes with config.rateLimit are limited (login)
  await app.register(rateLimit, { ...(await rateLimitStore(app)), global: false });
  app.post('/api/auth/login', {
    config: { rateLimit: { max: app.deps.config.loginRateLimitPerMinute, timeWindow: '1 minute' } },
  }, async (req): Promise<LoginResponse> => {
    const body = parse(loginBody, req.body);
    const found = await withoutTenant((db) => db.query('SELECT * FROM auth_lookup_user($1)', [body.email]).then((r) => r.rows[0]));
    if (!found) await verifyPassword(body.password, await (dummyHash ??= hashPassword('timing-equaliser')));
    if (!found || !found.active || !(await verifyPassword(body.password, found.password_hash))) throw unauthorized('E-posta veya şifre hatalı');
    const row = await withTenant(found.tenant_id, { type: 'user', id: found.user_id }, async (db) =>
      (await db.query('SELECT * FROM users WHERE id = $1', [found.user_id])).rows[0]);
    const user = mapUser(row);
    return { token: signSession(app, user.id, user.tenantId, user.role, Number(row.token_version ?? 0)), user };
  });

  // Password change (G-17): re-authenticates, bumps token_version → every other session (other devices, a stolen token)
  // ends; the caller gets a fresh token for this session.
  app.post('/api/auth/password', { preHandler: requireAuth }, async (req) => {
    const body = parse(z.object({ currentPassword: z.string().min(1).max(500), newPassword: z.string().min(10).max(500) }), req.body);
    return asUser(req, async (ctx) => {
      const { rows } = await ctx.db.query('SELECT password_hash FROM users WHERE id = $1', [ctx.user!.id]);
      if (!rows[0] || !(await verifyPassword(body.currentPassword, rows[0].password_hash))) throw forbidden('Şifre doğrulanamadı', 'REAUTH_FAILED');
      if (body.newPassword === body.currentPassword) throw badRequest('Yeni şifre eskisiyle aynı olamaz', undefined, 'PASSWORD_UNCHANGED');
      const tv = (await ctx.db.query(
        'UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING token_version',
        [ctx.user!.id, await hashPassword(body.newPassword)])).rows[0].token_version;
      return { token: signSession(app, ctx.user!.id, ctx.tenantId, ctx.user!.role, Number(tv)) };
    });
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req): Promise<MeResponse> =>
    asUser(req, async (ctx) => {
      const tenant = (await ctx.db.query('SELECT id, name FROM tenants WHERE id = app_tenant_id()')).rows[0];
      const dels = (await ctx.db.query('SELECT * FROM delegations WHERE delegate_id = $1 AND ended_at IS NULL AND ends_at > $2', [ctx.user!.id, ctx.now()])).rows;
      return { user: ctx.user!, tenant: { id: tenant.id, name: tenant.name }, activeDelegationsForMe: dels.map(mapDelegation) };
    }));

  // Registering a new authenticator re-authenticates with the password: otherwise a stolen session token alone could enrol
  // the attacker's own authenticator and then pass every Face ID step-up (§15 money / contract approvals).
  app.post('/api/auth/webauthn/register/options', { preHandler: requireAuth }, async (req) => {
    const { password } = parse(z.object({ password: z.string().min(1).max(500) }), req.body);
    return asUser(req, async (ctx) => {
      const { rows } = await ctx.db.query('SELECT password_hash FROM users WHERE id = $1', [ctx.user!.id]);
      if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash))) throw forbidden('Şifre doğrulanamadı', 'REAUTH_FAILED');
      return registrationOptions(ctx);
    });
  });
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
