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

/** PostgreSQL SQLSTATEs → HTTP. `message` set = generic client text (G-19: raw Postgres text — constraint / table / column
 *  names, values in DETAIL — never reaches the client); no message = our own trigger text (MIxxx, written for users). */
const PG_ERRORS: Record<string, { status: number; code: string; message?: string }> = {
  MI001: { status: 409, code: 'IMMUTABLE_RECORD' },
  MI002: { status: 409, code: 'CONTRACT_LOCKED' },
  MI003: { status: 409, code: 'DOCUMENT_STALE' },
  MI004: { status: 409, code: 'OFFER_IMMUTABLE' },
  MI005: { status: 409, code: 'QUOTE_NOT_APPROVED' },
  MI006: { status: 403, code: 'FORBIDDEN_FOR_ACTOR' },
  '42501': { status: 403, code: 'DB_PERMISSION_DENIED', message: 'Bu kayıt için yetkiniz yok' },
  '23505': { status: 409, code: 'DUPLICATE', message: 'Bu kayıt zaten var' },
  '23514': { status: 400, code: 'CONSTRAINT_VIOLATION', message: 'Geçersiz değer' },
  '23503': { status: 400, code: 'INVALID_REFERENCE', message: 'Geçersiz referans (bağlı kayıt bulunamadı)' },
  '23502': { status: 400, code: 'MISSING_VALUE', message: 'Zorunlu alan eksik' },
  '22P02': { status: 400, code: 'INVALID_INPUT', message: 'Geçersiz giriş biçimi' },
  '22001': { status: 400, code: 'VALUE_TOO_LONG', message: 'Değer çok uzun' },
  '22003': { status: 400, code: 'VALUE_OUT_OF_RANGE', message: 'Değer aralık dışında' },
  '22007': { status: 400, code: 'INVALID_INPUT', message: 'Geçersiz tarih / saat' },
  '22008': { status: 400, code: 'INVALID_INPUT', message: 'Geçersiz tarih / saat' },
  '40001': { status: 409, code: 'CONCURRENT_UPDATE', message: 'Eşzamanlı değişiklik; lütfen tekrar deneyin' },
  '40P01': { status: 409, code: 'CONCURRENT_UPDATE', message: 'Eşzamanlı değişiklik; lütfen tekrar deneyin' },
};

/** A pg driver error (DatabaseError): five-character SQLSTATE plus server fields. */
type PgErrorLike = { code: string; message: string; constraint?: string; table?: string; column?: string };
export function isPgError(err: unknown): boolean {
  const e = err as { code?: unknown; severity?: unknown; routine?: unknown };
  return !!e && typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) && (typeof e.severity === 'string' || typeof e.routine === 'string');
}

/** What may be logged about a Postgres error: SQLSTATE, constraint / table / column, the server message — never DETAIL /
 *  WHERE / query parameters (they carry row values, e.g. e-mail addresses or amounts). */
export function pgLogFields(err: unknown): Record<string, unknown> | null {
  if (!isPgError(err)) return null;
  const e = err as PgErrorLike;
  return { pgCode: e.code, constraint: e.constraint, table: e.table, column: e.column, message: String(e.message).slice(0, 300) };
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new AppError(400, 'VALIDATION_ERROR', 'Geçersiz istek', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const e = err as FastifyError & { code?: string; statusCode?: number; constraint?: string };
  if (e && typeof e.code === 'string' && PG_ERRORS[e.code] && (isPgError(e) || /^MI\d{3}$/.test(e.code))) {
    const m = PG_ERRORS[e.code];
    return new AppError(m.status, m.code, m.message ?? e.message);
  }
  if (isPgError(e)) return new AppError(500, 'INTERNAL', 'Beklenmeyen bir hata oluştu'); // unknown SQLSTATE: never the raw text
  if (e?.validation) return new AppError(400, 'VALIDATION_ERROR', e.message, e.validation);
  if (e?.statusCode && e.statusCode < 500) return new AppError(e.statusCode, e.code ?? 'ERROR', e.message);
  return new AppError(500, 'INTERNAL', 'Beklenmeyen bir hata oluştu');
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    const ae = toAppError(err);
    const pg = pgLogFields(err);
    // Postgres errors: only the sanitized fields are logged (pino's err serializer would include DETAIL with row values)
    if (pg) req.log[ae.statusCode >= 500 ? 'error' : 'warn']({ pg, code: ae.code }, 'database error');
    else if (ae.statusCode >= 500) req.log.error({ err }, 'unhandled error');
    reply.status(ae.statusCode).send({ error: { code: ae.code, message: ae.message, details: ae.details } });
  });
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'ROUTE_NOT_FOUND', message: `${req.method} ${req.url} bulunamadı` } });
  });
}
