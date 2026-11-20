// Uniform error model: { error: { code, message, details } } with a proper HTTP status.
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown, code = 'BAD_REQUEST') => new AppError(400, code, message, details);
export const unauthorized = (message = 'Giriş gerekli') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Bu işlem için yetkiniz yok', code = 'FORBIDDEN', details?: unknown) => new AppError(403, code, message, details);
export const notFound = (what = 'Kayıt') => new AppError(404, 'NOT_FOUND', `${what} bulunamadı`);
export const conflict = (message: string, code = 'CONFLICT', details?: unknown) => new AppError(409, code, message, details);
export const gone = (message: string, code = 'GONE') => new AppError(410, code, message);

/** PostgreSQL SQLSTATEs raised by our triggers (003_security_and_integrity.sql). */
const PG_ERRORS: Record<string, { status: number; code: string }> = {
  MI001: { status: 409, code: 'IMMUTABLE_RECORD' },
  MI002: { status: 409, code: 'CONTRACT_LOCKED' },
  MI003: { status: 409, code: 'DOCUMENT_STALE' },
  MI004: { status: 409, code: 'OFFER_IMMUTABLE' },
  MI005: { status: 409, code: 'QUOTE_NOT_APPROVED' },
  MI006: { status: 403, code: 'FORBIDDEN_FOR_ACTOR' },
  '42501': { status: 403, code: 'DB_PERMISSION_DENIED' },
  '23505': { status: 409, code: 'DUPLICATE' },
  '23514': { status: 400, code: 'CONSTRAINT_VIOLATION' },
  '23503': { status: 400, code: 'INVALID_REFERENCE' },
  '22P02': { status: 400, code: 'INVALID_INPUT' },
};

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new AppError(400, 'VALIDATION_ERROR', 'Geçersiz istek', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const e = err as FastifyError & { code?: string; statusCode?: number; constraint?: string };
  if (e && typeof e.code === 'string' && PG_ERRORS[e.code]) {
    const m = PG_ERRORS[e.code];
    return new AppError(m.status, m.code, e.message, e.constraint ? { constraint: e.constraint } : undefined);
  }
  if (e?.validation) return new AppError(400, 'VALIDATION_ERROR', e.message, e.validation);
  if (e?.statusCode && e.statusCode < 500) return new AppError(e.statusCode, e.code ?? 'ERROR', e.message);
  return new AppError(500, 'INTERNAL', 'Beklenmeyen bir hata oluştu');
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    const ae = toAppError(err);
    if (ae.statusCode >= 500) req.log.error({ err }, 'unhandled error');
    reply.status(ae.statusCode).send({ error: { code: ae.code, message: ae.message, details: ae.details } });
  });
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'ROUTE_NOT_FOUND', message: `${req.method} ${req.url} bulunamadı` } });
  });
}
