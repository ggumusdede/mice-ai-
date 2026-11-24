import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@mice/shared';
import type { ZodType, ZodTypeDef } from 'zod';
import { z } from 'zod';
import { withUserCtx, type AppDeps, type Ctx } from '../context.js';
import { forbidden, unauthorized } from '../errors.js';

/** `tv` = users.token_version at login (session revocation, G-17); a token without it is refused. */
export interface JwtUser { userId: string; tenantId: string; role: Role; tv?: number }

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}
declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

/** preHandler: valid Bearer JWT required. */
export async function requireAuth(req: FastifyRequest): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    throw unauthorized();
  }
}

export function device(req: FastifyRequest): string {
  return String(req.headers['x-device'] ?? req.headers['user-agent'] ?? '').slice(0, 200);
}

/** Run a handler as the authenticated staff user inside a tenant-scoped (RLS) transaction. Optional role guard. */
export function asUser<T>(req: FastifyRequest, fn: (ctx: Ctx) => Promise<T>, roles?: Role[]): Promise<T> {
  return withUserCtx(req.server.deps, req.user, device(req), async (ctx) => {
    if (roles && !roles.includes(ctx.user!.role)) throw forbidden(`Bu işlem için rol gerekli: ${roles.join(' / ')}`);
    return fn(ctx);
  });
}

export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  return schema.parse(data ?? {});
}

export const idParam = z.object({ id: z.string().uuid() });
export const tokenParam = z.object({ token: z.string().min(20).max(200) });

export function list<T>(items: T[]): { items: T[] } {
  return { items };
}

export function sendPdf(reply: FastifyReply, file: { fileName: string; data: Buffer; mimeType: string; stale?: boolean }) {
  reply.header('Content-Type', file.mimeType);
  reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`);
  if (file.stale) reply.header('X-Document-Stale', '1');
  return reply.send(file.data);
}

/** Reads a multipart request: first file + text fields. Returns null when the request is JSON. */
export async function readMultipart(req: FastifyRequest): Promise<{ file?: { filename: string; mimetype: string; buffer: Buffer }; fields: Record<string, string> } | null> {
  if (!req.isMultipart()) return null;
  const fields: Record<string, string> = {};
  let file: { filename: string; mimetype: string; buffer: Buffer } | undefined;
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (!file) file = { filename: part.filename, mimetype: part.mimetype, buffer };
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  return { file, fields };
}
