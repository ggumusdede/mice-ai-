// Structured JSON logging (pino, built into Fastify) with PII / secret redaction.
// - headers: Authorization, Cookie, X-Device are redacted; request bodies are never logged by default.
// - URLs: one-time public tokens (/api/public/<kind>/<token>…, /s/rfq/<token>, /q/<token> …) are replaced by [token].
// - LOG_LEVEL (default info; tests: silent via logger:false).
import type { FastifyServerOptions } from 'fastify';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-device"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.guestDataKey',
  '*.jwtSecret',
  'err.config.headers.authorization',
  // guest / customer PII if an object with these keys is logged
  '*.fullName',
  '*.email',
  '*.phone',
  '*.taxNumber',
];

/** Replaces token-like path segments after public routes with [token] and drops query strings. Pure. */
export function redactUrl(url: string): string {
  const [p] = url.split('?');
  return p
    .replace(/(\/api\/public\/[a-z-]+\/)[^/]+/gi, '$1[token]')
    .replace(/^(\/(?:s\/rfq|q|r|e|survey)\/)[^/]+/i, '$1[token]');
}

export function loggerOptions(env: Record<string, string | undefined> = process.env): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL || 'info',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: {
      req(req: { method: string; url: string; id?: string; ip?: string; headers?: Record<string, unknown> }) {
        return { id: req.id, method: req.method, url: redactUrl(req.url), ip: req.ip, ua: req.headers?.['user-agent'] };
      },
    },
  };
}

/** TRUST_PROXY: '1'/'true' → trust X-Forwarded-* (only when the API is reachable solely through nginx / a LB),
 * else a comma list of trusted proxy IPs / CIDRs (e.g. `172.16.0.0/12`). Unset → do not trust. */
export function trustProxyOption(v: string | undefined): boolean | string[] {
  if (!v || ['0', 'false', 'no'].includes(v.toLowerCase())) return false;
  if (['1', 'true', 'yes'].includes(v.toLowerCase())) return true;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
