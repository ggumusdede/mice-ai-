// Baseline HTTP security headers for every API response (docs/09-guvenlik-incelemesi.md).
// Public token URLs carry the secret in the path: never cache them, never send them on as a Referer.
import type { FastifyInstance } from 'fastify';

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    const html = String(reply.getHeader('content-type') ?? '').startsWith('text/html');
    // API responses are data; the only HTML (consent withdrawal page) needs inline styles and a same-origin form post
    reply.header('Content-Security-Policy', html
      ? "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
      : "default-src 'none'; frame-ancestors 'none'");
    if (req.url.startsWith('/api/public/') || req.url.startsWith('/api/auth/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
}
