// Runtime configuration from environment variables (see apps/api/README.md).
export interface AppConfig {
  nodeEnv: string;
  port: number;
  host: string;
  /** API connection — MUST be the non-superuser role `mice_app` so that RLS applies. */
  databaseUrl: string;
  /** Owner/superuser connection used only by migrations and seeds. */
  migrationDatabaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  corsOrigins: string[];
  /** Base URL of the web app; public links (supplier RFQ form, quote approval) are built from it. */
  publicBaseUrl: string;
  guestDataKey: string;
  allowDevBiometric: boolean;
  webauthn: { rpId: string; rpName: string; origins: string[] };
  publicRateLimitPerMinute: number;
  /** POST /api/auth/login attempts per minute per IP (brute force / credential stuffing) */
  loginRateLimitPerMinute: number;
  workerIntervalMs: number;
}

const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me';

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  // Fail closed: dev defaults (public JWT secret, guest key, dev biometric) only for an explicit development / test
  // environment — a deployment with a missing or misspelled NODE_ENV ('prod', 'staging') must not inherit them.
  const devLike = nodeEnv === 'development' || nodeEnv === 'test';
  const jwtSecret = env.JWT_SECRET ?? DEV_JWT_SECRET;
  if (!devLike && (jwtSecret === DEV_JWT_SECRET || jwtSecret.length < 32)) {
    throw new Error(`JWT_SECRET (>= 32 characters) must be set when NODE_ENV=${nodeEnv}`);
  }
  const guestDataKey = env.GUEST_DATA_KEY ?? 'dev-only-guest-data-key';
  if (!devLike && !env.GUEST_DATA_KEY) throw new Error(`GUEST_DATA_KEY must be set when NODE_ENV=${nodeEnv}`);
  const corsOrigins = (env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    nodeEnv,
    port: Number(env.PORT ?? 3001),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL ?? 'postgres://mice_app:mice_app@localhost:5432/mice',
    migrationDatabaseUrl: env.MIGRATION_DATABASE_URL ?? 'postgres://postgres@localhost:5432/mice',
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? '12h',
    corsOrigins,
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
    guestDataKey,
    allowDevBiometric: devLike || env.ALLOW_DEV_BIOMETRIC === '1',
    webauthn: {
      rpId: env.WEBAUTHN_RP_ID ?? 'localhost',
      rpName: env.WEBAUTHN_RP_NAME ?? 'MICE AI Operations OS',
      origins: (env.WEBAUTHN_ORIGIN ?? corsOrigins.join(',')).split(',').map((s) => s.trim()).filter(Boolean),
    },
    publicRateLimitPerMinute: Number(env.PUBLIC_RATE_LIMIT ?? 60),
    loginRateLimitPerMinute: Number(env.LOGIN_RATE_LIMIT ?? 20),
    workerIntervalMs: Number(env.WORKER_INTERVAL_MS ?? 5 * 60_000),
  };
}
