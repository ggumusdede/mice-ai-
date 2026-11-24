// Inbound e-mail normalisation: every provider format (our signed JSON webhook, Postmark, Mailgun, raw MIME from IMAP /
// SES) becomes one NormalizedEmail, which the router (email-router.ts) processes. Pure functions + signature helpers.
//
// Security notes
//  - Signatures are compared with timingSafeEqual; the timestamp must be inside the replay window; the router is idempotent
//    by Message-ID, so a replayed body inside the window is a no-op.
//  - Attachments: allow-list by extension + declared type + magic bytes, per-file / count / total limits. Rejected files are
//    recorded as metadata only and never parsed.
//  - Content is DATA: the text only goes to deterministic routing and to AI extraction (request / offer reading). Nothing an
//    e-mail says is executed (prompt-injection safe by construction: no tool / action is derived from model output here).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { simpleParser, type AddressObject } from 'mailparser';
import { badRequest } from '../../errors.js';

export interface EmailAddress { address: string; name: string | null }

export interface InboundAttachment { filename: string; contentType: string; content: Buffer }

export interface NormalizedEmail {
  from: EmailAddress;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string | null;
  /** RFC 5322 Message-ID with angle brackets (synthetic `<sha256@inbound.local>` when the provider sent none) */
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  date: Date | null;
  /** lower-cased header names → value (only the few the router looks at) */
  headers: Record<string, string>;
  attachments: InboundAttachment[];
}

export const MAX_TEXT_CHARS = 200_000;

// ------------------------------------------------------------------ addresses / ids / text
/** `"Selin Aydın" <selin@x.com>` → {address, name}; bare addresses too. null when no address is found. */
export function parseAddress(raw: string | null | undefined): EmailAddress | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = /^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(s);
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, '').trim();
    return { address: m[2].toLowerCase(), name: name || null };
  }
  const bare = /([^\s<>",;]+@[^\s<>",;]+)/.exec(s);
  return bare ? { address: bare[1].toLowerCase(), name: null } : null;
}

/** Address list (`a@x.com, "B, C" <b@y.com>`) → lower-cased addresses. */
export function parseAddressList(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  const parts: string[] = [];
  for (const item of Array.isArray(raw) ? raw : [raw]) {
    let cur = '';
    let quoted = false;
    let angle = false;
    for (const ch of String(item)) {
      if (ch === '"') quoted = !quoted;
      if (ch === '<') angle = true;
      if (ch === '>') angle = false;
      if ((ch === ',' || ch === ';') && !quoted && !angle) {
        parts.push(cur);
        cur = '';
      } else cur += ch;
    }
    parts.push(cur);
  }
  return [...new Set(parts.map((p) => parseAddress(p)?.address).filter((a): a is string => !!a))].slice(0, 100);
}

/** Message-ID with angle brackets, trimmed; null when empty / implausible. */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim().replace(/^<|>$/g, '').trim();
  if (!s || s.length > 900 || /\s/.test(s)) return null;
  return `<${s}>`;
}

/** References header (space separated) or array → message ids, oldest first. */
export function parseReferences(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  const list = (Array.isArray(raw) ? raw : [raw]).flatMap((r) => String(r).match(/<[^<>\s]+>|[^\s<>,]+@[^\s<>,]+/g) ?? []);
  return [...new Set(list.map(normalizeMessageId).filter((x): x is string => !!x))].slice(-50);
}

/** Very small HTML → text (no DOM, no script execution): drops script/style, keeps line structure, decodes basic entities. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<td[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const QUOTE_HEADER = [
  /^On .{0,200}wrote:\s*$/i,
  /^.{0,200}tarihinde .{0,200}(yazdı|şunu yazdı):\s*$/i,
  /^-{2,}\s*(Original Message|Özgün İleti|Orijinal Mesaj|Forwarded message|İletilen ileti)\s*-{2,}/i,
  /^(From|Kimden|Gönderen):\s.+$/i,
];

/** The new part of a reply: everything before the first quote header / `>` block (used for offer reading). */
export function stripQuoted(text: string): string {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (QUOTE_HEADER.some((re) => re.test(line.trim()))) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  const s = out.join('\n').trim();
  return s || text.trim();
}

export function isAutoReply(e: Pick<NormalizedEmail, 'headers' | 'subject' | 'from'>): boolean {
  const auto = e.headers['auto-submitted'];
  if (auto && auto.toLowerCase() !== 'no') return true;
  if (e.headers['x-autoreply'] || e.headers['x-autorespond'] || /^(bulk|junk|auto_reply)$/i.test(e.headers.precedence ?? '')) return true;
  if (/^(mailer-daemon|postmaster|no-?reply)@/i.test(e.from.address)) return true;
  return /^(otomatik yan[ıi]t|automatic reply|auto(matic)?[- ]?reply|out of (the )?office|ofis d[ıi][şs][ıi]nday[ıi]m|undeliverable|delivery status notification)/i.test(e.subject.trim());
}

// ------------------------------------------------------------------ signatures
function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a.trim().toLowerCase(), 'utf8');
  const y = Buffer.from(b.trim().toLowerCase(), 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Our webhook signature: hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`), header `sha256=<hex>` (prefix optional). */
export function signWebhook(secret: string, timestamp: number | string, rawBody: Buffer | string): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

export type SignatureFailure = 'missing' | 'bad_signature' | 'stale_timestamp' | 'no_secret';

export function verifyWebhookSignature(
  secret: string | null, headers: { signature?: string; timestamp?: string }, rawBody: Buffer, now: Date, windowSeconds: number,
): SignatureFailure | null {
  if (!secret) return 'no_secret';
  if (!headers.signature || !headers.timestamp) return 'missing';
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > windowSeconds) return 'stale_timestamp';
  const given = headers.signature.replace(/^sha256=/i, '');
  return safeEqualHex(given, signWebhook(secret, headers.timestamp, rawBody)) ? null : 'bad_signature';
}

/** Mailgun webhook signature: hex HMAC-SHA256(signing key, timestamp + token). */
export function verifyMailgunSignature(
  signingKey: string | null, f: { timestamp?: string; token?: string; signature?: string }, now: Date, windowSeconds: number,
): SignatureFailure | null {
  if (!signingKey) return 'no_secret';
  if (!f.timestamp || !f.token || !f.signature) return 'missing';
  const ts = Number(f.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > windowSeconds) return 'stale_timestamp';
  const expected = createHmac('sha256', signingKey).update(f.timestamp + f.token).digest('hex');
  return safeEqualHex(f.signature, expected) ? null : 'bad_signature';
}

/** Postmark has no payload signature: the webhook URL carries HTTP Basic credentials (password = the tenant secret). */
export function verifyBasicAuth(secret: string | null, authorization: string | undefined): SignatureFailure | null {
  if (!secret) return 'no_secret';
  const m = /^Basic\s+(.+)$/i.exec(authorization ?? '');
  if (!m) return 'missing';
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const pw = decoded.slice(decoded.indexOf(':') + 1);
  const a = createHash('sha256').update(pw).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b) ? null : 'bad_signature';
}

// ------------------------------------------------------------------ attachments
export type AttachmentKind = 'pdf' | 'xlsx' | 'csv' | 'text' | 'image' | 'xml';

export interface AttachmentCheck {
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  accepted: boolean;
  kind?: AttachmentKind;
  reason?: string;
}

export interface AttachmentLimits { maxAttachmentBytes: number; maxAttachments: number; maxTotalAttachmentBytes: number }

const startsWith = (b: Buffer, sig: number[]) => sig.every((x, i) => b[i] === x);

/** Allow-list: extension AND content (magic bytes / no NULs for text). Everything else (exe, html, js, zip, docm …) is rejected. */
export function classifyAttachment(a: InboundAttachment): { kind: AttachmentKind } | { reason: string } {
  const name = a.filename.toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const b = a.content;
  const textLike = () => !b.subarray(0, 8192).includes(0);
  switch (ext) {
    case 'pdf': return startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) ? { kind: 'pdf' } : { reason: 'content_mismatch' };
    case 'xlsx': return startsWith(b, [0x50, 0x4b, 0x03, 0x04]) ? { kind: 'xlsx' } : { reason: 'content_mismatch' };
    case 'csv': return textLike() ? { kind: 'csv' } : { reason: 'content_mismatch' };
    case 'txt': return textLike() ? { kind: 'text' } : { reason: 'content_mismatch' };
    case 'xml': return textLike() && /^\s*(﻿)?\s*</.test(b.subarray(0, 512).toString('utf8')) ? { kind: 'xml' } : { reason: 'content_mismatch' };
    case 'png': return startsWith(b, [0x89, 0x50, 0x4e, 0x47]) ? { kind: 'image' } : { reason: 'content_mismatch' };
    case 'jpg':
    case 'jpeg': return startsWith(b, [0xff, 0xd8, 0xff]) ? { kind: 'image' } : { reason: 'content_mismatch' };
    default: return { reason: 'type_not_allowed' };
  }
}

const MIME_BY_KIND: Record<AttachmentKind, (name: string) => string> = {
  pdf: () => 'application/pdf',
  xlsx: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: () => 'text/csv',
  text: () => 'text/plain',
  xml: () => 'application/xml',
  image: (n) => (/\.png$/i.test(n) ? 'image/png' : 'image/jpeg'),
};

/** Checks every attachment; accepted ones get a canonical content type (the sender's declared type is not trusted). */
export function checkAttachments(list: InboundAttachment[], limits: AttachmentLimits): { checks: AttachmentCheck[]; accepted: (InboundAttachment & { kind: AttachmentKind })[] } {
  const checks: AttachmentCheck[] = [];
  const accepted: (InboundAttachment & { kind: AttachmentKind })[] = [];
  let total = 0;
  list.forEach((a, i) => {
    const filename = (a.filename || `ek-${i + 1}`).replace(/[\\/\0\r\n]/g, '_').slice(0, 200);
    const base: AttachmentCheck = {
      filename, contentType: String(a.contentType || '').slice(0, 100), size: a.content.length,
      sha256: createHash('sha256').update(a.content).digest('hex'), accepted: false,
    };
    if (i >= limits.maxAttachments) return checks.push({ ...base, reason: 'too_many_attachments' });
    if (a.content.length > limits.maxAttachmentBytes) return checks.push({ ...base, reason: 'too_large' });
    if (total + a.content.length > limits.maxTotalAttachmentBytes) return checks.push({ ...base, reason: 'total_too_large' });
    const c = classifyAttachment({ ...a, filename });
    if ('reason' in c) return checks.push({ ...base, reason: c.reason });
    total += a.content.length;
    checks.push({ ...base, accepted: true, kind: c.kind, contentType: MIME_BY_KIND[c.kind](filename) });
    accepted.push({ filename, contentType: MIME_BY_KIND[c.kind](filename), content: a.content, kind: c.kind });
  });
  return { checks, accepted };
}

/** Decodes base64 after a cheap size estimate (no 100 MB buffers from a 25 MB request). */
export function decodeBase64(b64: string, maxBytes: number): Buffer {
  const clean = b64.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) throw badRequest('Geçersiz base64 ek', undefined, 'INVALID_ATTACHMENT');
  if (Math.floor((clean.length * 3) / 4) > maxBytes + 3) return Buffer.alloc(maxBytes + 1); // marked too_large by checkAttachments
  return Buffer.from(clean, 'base64');
}

// ------------------------------------------------------------------ provider formats → NormalizedEmail
function finish(e: Omit<NormalizedEmail, 'messageId'> & { messageId: string | null }): NormalizedEmail {
  const text = (e.text || (e.html ? htmlToText(e.html) : '')).slice(0, MAX_TEXT_CHARS);
  const messageId = e.messageId ?? `<${createHash('sha256').update([e.from.address, e.subject, e.date?.toISOString() ?? '', text].join('\n')).digest('hex')}@inbound.local>`;
  return { ...e, text, html: e.html ? e.html.slice(0, MAX_TEXT_CHARS) : null, messageId, subject: (e.subject ?? '').slice(0, 1000) };
}

function headerMap(entries: [string, unknown][]): Record<string, string> {
  const keep = new Set(['auto-submitted', 'x-autoreply', 'x-autorespond', 'precedence', 'message-id', 'in-reply-to', 'references', 'list-id']);
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    const key = k.toLowerCase();
    if (keep.has(key) && v != null) out[key] = String(v).slice(0, 4000);
  }
  return out;
}

/** Our provider-agnostic JSON (documented in apps/api/README.md → Inbound). */
export const webhookEmailSchema = z.object({
  from: z.string().min(3).max(500),
  to: z.union([z.string().max(5000), z.array(z.string().max(500)).max(100)]).optional(),
  cc: z.union([z.string().max(5000), z.array(z.string().max(500)).max(100)]).optional(),
  subject: z.string().max(5000).optional(),
  text: z.string().max(2_000_000).optional(),
  html: z.string().max(5_000_000).optional(),
  messageId: z.string().max(1000).optional(),
  inReplyTo: z.string().max(1000).nullable().optional(),
  references: z.union([z.string().max(20_000), z.array(z.string().max(1000)).max(200)]).nullable().optional(),
  date: z.string().max(100).optional(),
  headers: z.record(z.string().max(4000)).optional(),
  attachments: z.array(z.object({ filename: z.string().max(255), contentType: z.string().max(200).optional(), base64: z.string() })).max(50).optional(),
});
export type WebhookEmail = z.infer<typeof webhookEmailSchema>;

function parseDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fromWebhookJson(body: unknown, maxAttachmentBytes: number): NormalizedEmail {
  const b = webhookEmailSchema.parse(body);
  const from = parseAddress(b.from);
  if (!from) throw badRequest('Gönderen adresi okunamadı', undefined, 'INVALID_FROM');
  return finish({
    from, to: parseAddressList(b.to), cc: parseAddressList(b.cc), subject: b.subject ?? '', text: b.text ?? '', html: b.html ?? null,
    messageId: normalizeMessageId(b.messageId), inReplyTo: normalizeMessageId(b.inReplyTo), references: parseReferences(b.references),
    date: parseDate(b.date), headers: headerMap(Object.entries(b.headers ?? {})),
    attachments: (b.attachments ?? []).map((a) => ({ filename: a.filename, contentType: a.contentType ?? 'application/octet-stream', content: decodeBase64(a.base64, maxAttachmentBytes) })),
  });
}

/** Postmark inbound webhook JSON (https://postmarkapp.com/developer/webhooks/inbound-webhook). */
export const postmarkSchema = z.object({
  From: z.string().max(500).optional(),
  FromFull: z.object({ Email: z.string().max(500), Name: z.string().max(500).optional() }).optional(),
  To: z.string().max(5000).optional(),
  ToFull: z.array(z.object({ Email: z.string().max(500) })).max(100).optional(),
  Cc: z.string().max(5000).optional(),
  CcFull: z.array(z.object({ Email: z.string().max(500) })).max(100).optional(),
  OriginalRecipient: z.string().max(500).optional(),
  Subject: z.string().max(5000).optional(),
  MessageID: z.string().max(500).optional(),
  Date: z.string().max(100).optional(),
  TextBody: z.string().max(2_000_000).optional(),
  HtmlBody: z.string().max(5_000_000).optional(),
  Headers: z.array(z.object({ Name: z.string().max(200), Value: z.string().max(20_000) })).max(500).optional(),
  Attachments: z.array(z.object({ Name: z.string().max(255), Content: z.string(), ContentType: z.string().max(200).optional(), ContentLength: z.number().optional() })).max(50).optional(),
}).passthrough();

export function fromPostmark(body: unknown, maxAttachmentBytes: number): NormalizedEmail {
  const b = postmarkSchema.parse(body);
  const headers = Object.fromEntries((b.Headers ?? []).map((h) => [h.Name.toLowerCase(), h.Value] as [string, string]));
  const from = b.FromFull ? { address: b.FromFull.Email.toLowerCase(), name: b.FromFull.Name || null } : parseAddress(b.From);
  if (!from || !from.address.includes('@')) throw badRequest('Gönderen adresi okunamadı', undefined, 'INVALID_FROM');
  const to = b.ToFull?.length ? b.ToFull.map((x) => x.Email) : parseAddressList(b.To);
  if (b.OriginalRecipient) to.push(b.OriginalRecipient);
  return finish({
    from, to: parseAddressList(to), cc: b.CcFull?.length ? parseAddressList(b.CcFull.map((x) => x.Email)) : parseAddressList(b.Cc),
    subject: b.Subject ?? '', text: b.TextBody ?? '', html: b.HtmlBody ?? null,
    // the RFC Message-ID header (what our References carry) — Postmark's own MessageID is only a fallback
    messageId: normalizeMessageId(headers['message-id']) ?? normalizeMessageId(b.MessageID ? `${b.MessageID}@postmark` : null),
    inReplyTo: normalizeMessageId(headers['in-reply-to']), references: parseReferences(headers.references),
    date: parseDate(b.Date), headers: headerMap(Object.entries(headers)),
    attachments: (b.Attachments ?? []).map((a) => ({ filename: a.Name, contentType: a.ContentType ?? 'application/octet-stream', content: decodeBase64(a.Content, maxAttachmentBytes) })),
  });
}

/** Mailgun "store and notify" / route forward (multipart form fields, https://documentation.mailgun.com — inbound routes). */
export function fromMailgun(fields: Record<string, string>, files: InboundAttachment[]): NormalizedEmail {
  let headerList: [string, string][] = [];
  try {
    const parsed = JSON.parse(fields['message-headers'] ?? '[]');
    if (Array.isArray(parsed)) headerList = parsed.filter((x) => Array.isArray(x) && x.length === 2).map((x) => [String(x[0]), String(x[1])]);
  } catch {
    /* optional field */
  }
  const h = Object.fromEntries(headerList.map(([k, v]) => [k.toLowerCase(), v]));
  const from = parseAddress(fields.from ?? fields.sender);
  if (!from) throw badRequest('Gönderen adresi okunamadı', undefined, 'INVALID_FROM');
  return finish({
    from, to: parseAddressList([fields.To ?? fields.to ?? '', fields.recipient ?? ''].filter(Boolean)), cc: parseAddressList(fields.Cc ?? fields.cc ?? h.cc),
    subject: fields.subject ?? fields.Subject ?? '', text: fields['body-plain'] ?? '', html: fields['body-html'] ?? null,
    messageId: normalizeMessageId(fields['Message-Id'] ?? h['message-id']), inReplyTo: normalizeMessageId(fields['In-Reply-To'] ?? h['in-reply-to']),
    references: parseReferences(fields.References ?? h.references), date: parseDate(fields.Date ?? h.date), headers: headerMap(Object.entries(h)),
    attachments: files,
  });
}

/** Raw RFC 822 / MIME (IMAP polling, SES → S3/SNS forwarder, `/mime` webhook) via mailparser. */
export async function fromMime(raw: Buffer): Promise<NormalizedEmail> {
  const m = await simpleParser(raw, { skipHtmlToText: false, skipTextToHtml: true, skipImageLinks: true });
  const addrs = (a: AddressObject | AddressObject[] | undefined) =>
    (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value.map((v) => v.address ?? '')).filter(Boolean);
  const first = m.from?.value?.[0];
  if (!first?.address) throw badRequest('Gönderen adresi okunamadı', undefined, 'INVALID_FROM');
  const headers: [string, unknown][] = [];
  m.headers.forEach((v, k) => headers.push([k, typeof v === 'object' && v && 'text' in (v as object) ? (v as { text: string }).text : v]));
  return finish({
    from: { address: first.address.toLowerCase(), name: first.name || null }, to: parseAddressList(addrs(m.to)), cc: parseAddressList(addrs(m.cc)),
    subject: m.subject ?? '', text: m.text ?? '', html: typeof m.html === 'string' ? m.html : null,
    messageId: normalizeMessageId(m.messageId), inReplyTo: normalizeMessageId(m.inReplyTo), references: parseReferences(m.references ?? null),
    date: m.date ?? null, headers: headerMap(headers),
    attachments: (m.attachments ?? []).filter((a) => a.contentDisposition !== 'inline' || a.filename).map((a) => ({ filename: a.filename ?? 'ek', contentType: a.contentType, content: a.content })),
  });
}
