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
  workerIntervalMs: number;
}

const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me';

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const prod = nodeEnv === 'production';
  const jwtSecret = env.JWT_SECRET ?? DEV_JWT_SECRET;
  if (prod && jwtSecret === DEV_JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
  const guestDataKey = env.GUEST_DATA_KEY ?? 'dev-only-guest-data-key';
  if (prod && !env.GUEST_DATA_KEY) throw new Error('GUEST_DATA_KEY must be set in production');
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
    allowDevBiometric: !prod || env.ALLOW_DEV_BIOMETRIC === '1',
    webauthn: {
      rpId: env.WEBAUTHN_RP_ID ?? 'localhost',
      rpName: env.WEBAUTHN_RP_NAME ?? 'MICE AI Operations OS',
      origins: (env.WEBAUTHN_ORIGIN ?? corsOrigins.join(',')).split(',').map((s) => s.trim()).filter(Boolean),
    },
    publicRateLimitPerMinute: Number(env.PUBLIC_RATE_LIMIT ?? 60),
    workerIntervalMs: Number(env.WORKER_INTERVAL_MS ?? 5 * 60_000),
  };
}
