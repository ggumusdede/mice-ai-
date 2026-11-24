// Inbound channel settings from the environment (see apps/api/README.md → Inbound). Per-tenant secrets live in the
// `inbound_channels` table (migration 009); the INBOUND_EMAIL_SECRET / WHATSAPP_* variables are the single-tenant fallback
// (demo tenant by default).
export interface InboundConfig {
  email: {
    /** webhook (default) | imap — only selects whether `npm run inbound:imap` may start; the webhook routes always exist */
    mode: 'webhook' | 'imap';
    /** HMAC secret used when the tenant has no inbound_channels row — ONLY for the tenant named by `fallbackTenantSlug` */
    fallbackSecret: string | null;
    fallbackTenantSlug: string;
    /** accepted clock skew of X-MICE-Timestamp / Mailgun timestamp (replay window) */
    replayWindowSeconds: number;
    maxRequestBytes: number;
    maxAttachmentBytes: number;
    maxAttachments: number;
    maxTotalAttachmentBytes: number;
    /** right-hand side of our Message-IDs (<outbox-id@domain>) — same default as delivery-config */
    messageIdDomain: string;
    /** our shared reply mailbox (loop protection) */
    replyAddress: string | null;
  };
  whatsapp: {
    appSecret: string | null;
    verifyToken: string | null;
    /** phone_number_id → tenant when the tenant has no inbound_channels(whatsapp) row */
    phoneNumberId: string | null;
    fallbackTenantSlug: string;
    maxRequestBytes: number;
  };
  imap: {
    host: string | null;
    port: number;
    secure: boolean;
    user: string | null;
    pass: string | null;
    mailbox: string;
    /** optional folder processed messages are moved to (else they are only flagged \Seen) */
    processedMailbox: string | null;
    tenantSlug: string;
    pollIntervalMs: number;
    maxMessagesPerPoll: number;
  };
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export function loadInboundConfig(env: Record<string, string | undefined> = process.env): InboundConfig {
  const replyAddress = env.EMAIL_REPLY_ADDRESS || null;
  return {
    email: {
      mode: env.INBOUND_EMAIL_MODE === 'imap' ? 'imap' : 'webhook',
      fallbackSecret: env.INBOUND_EMAIL_SECRET || null,
      fallbackTenantSlug: env.INBOUND_EMAIL_TENANT || 'demo',
      replayWindowSeconds: num(env.INBOUND_REPLAY_WINDOW_SECONDS, 300),
      maxRequestBytes: num(env.INBOUND_EMAIL_MAX_BYTES, 25 * 1024 * 1024),
      maxAttachmentBytes: num(env.INBOUND_ATTACHMENT_MAX_BYTES, 10 * 1024 * 1024),
      maxAttachments: num(env.INBOUND_MAX_ATTACHMENTS, 10),
      maxTotalAttachmentBytes: num(env.INBOUND_ATTACHMENTS_TOTAL_MAX_BYTES, 20 * 1024 * 1024),
      messageIdDomain: (env.EMAIL_MESSAGE_ID_DOMAIN || replyAddress?.split('@')[1] || 'mice.local').toLowerCase(),
      replyAddress,
    },
    whatsapp: {
      appSecret: env.WHATSAPP_APP_SECRET || null,
      verifyToken: env.WHATSAPP_VERIFY_TOKEN || null,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || null,
      fallbackTenantSlug: env.WHATSAPP_TENANT || env.INBOUND_EMAIL_TENANT || 'demo',
      maxRequestBytes: num(env.WHATSAPP_MAX_BYTES, 1024 * 1024),
    },
    imap: {
      host: env.IMAP_HOST || null,
      port: num(env.IMAP_PORT, 993),
      secure: env.IMAP_SECURE ? env.IMAP_SECURE !== 'false' : num(env.IMAP_PORT, 993) === 993,
      user: env.IMAP_USER || null,
      pass: env.IMAP_PASS || null,
      mailbox: env.IMAP_MAILBOX || 'INBOX',
      processedMailbox: env.IMAP_PROCESSED_MAILBOX || null,
      tenantSlug: env.IMAP_TENANT || env.INBOUND_EMAIL_TENANT || 'demo',
      pollIntervalMs: num(env.IMAP_POLL_INTERVAL_MS, 60_000),
      maxMessagesPerPoll: num(env.IMAP_MAX_MESSAGES_PER_POLL, 50),
    },
  };
}
