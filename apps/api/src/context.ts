// Per-request service context. Every service function receives a Ctx whose `db` is a transaction already
// scoped to the tenant (RLS) by withTenant().
import type { AiService } from '@mice/ai';
import type { TenantRules, User } from '@mice/shared';
import type { AppConfig } from './config.js';
import type { Actor, Db } from './db/pool.js';
import { withTenant } from './db/pool.js';
import type { EmailProvider } from './services/email.js';
import { loadRules } from './services/rules.js';
import { mapUser } from './lib/mappers.js';
import { unauthorized } from './errors.js';

export interface AppDeps {
  config: AppConfig;
  ai: AiService;
  email: EmailProvider;
  /** injectable clock (tests) */
  now: () => Date;
  /** injectable RNG for §16 sampling (tests) */
  rng: () => number;
}

export interface Ctx {
  db: Db;
  tenantId: string;
  /** the human user acting (null for public token / system contexts) */
  user: User | null;
  actor: Actor;
  deps: AppDeps;
  now(): Date;
  rules(): Promise<TenantRules>;
}

export function makeCtx(db: Db, tenantId: string, user: User | null, actor: Actor, deps: AppDeps): Ctx {
  let cached: Promise<TenantRules> | null = null;
  return {
    db, tenantId, user, actor, deps,
    now: deps.now,
    rules: () => (cached ??= loadRules(db)),
  };
}

/** Context for a logged-in staff user (re-reads the user row so role/authority changes apply immediately). */
export async function withUserCtx<T>(
  deps: AppDeps,
  auth: { userId: string; tenantId: string },
  device: string | null,
  fn: (ctx: Ctx) => Promise<T>,
): Promise<T> {
  const actor: Actor = { type: 'user', id: auth.userId, device };
  return withTenant(auth.tenantId, actor, async (db) => {
    // a suspended tenant's tokens stop working immediately (not only at the next login)
    const { rows } = await db.query(
      `SELECT u.* FROM users u JOIN tenants t ON t.id = u.tenant_id AND t.status = 'active' WHERE u.id = $1`, [auth.userId]);
    if (!rows[0] || !rows[0].active) throw unauthorized('Kullanıcı bulunamadı veya pasif');
    return fn(makeCtx(db, auth.tenantId, mapUser(rows[0]), actor, deps));
  });
}

/** Context for system / worker / public-token flows. */
export function withSystemCtx<T>(deps: AppDeps, tenantId: string, actor: Actor, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  return withTenant(tenantId, actor, (db) => fn(makeCtx(db, tenantId, null, actor, deps)));
}

export function requireUser(ctx: Ctx): User {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
}
