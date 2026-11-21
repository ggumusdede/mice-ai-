// Delivery-channel configuration (e-mail, SMS / WhatsApp, Web Push) from environment variables.
// Kept separate from config.ts so channel settings can evolve without touching the core AppConfig.
export type EmailProviderKind = 'outbox' | 'smtp';
export type MessagingProviderKind = 'outbox' | 'whatsapp_cloud';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  /** SMTP envelope sender (MAIL FROM / `Sender:` header) when the relay must not use the user's address for bounces */
  envelopeFrom: string | null;
  /** reject self-signed certificates (default true) */
  rejectUnauthorized: boolean;
  connectionTimeoutMs: number;
  socketTimeoutMs: number;
}

export interface DeliveryConfig {
  email: {
    provider: EmailProviderKind;
    /** 'immediate' = try SMTP inside the request (failures → worker retry); 'queue' = the worker delivers */
    sendMode: 'immediate' | 'queue';
    smtp: SmtpConfig | null;
    /** shared reply mailbox, plus-addressed per project: replies+prj-0042@agency.com (optional) */
    replyAddress: string | null;
    /** right-hand side of Message-ID headers (<outbox-id>@domain) */
    messageIdDomain: string;
    maxAttempts: number;
    /** pgcrypto key for retry payloads (defaults to GUEST_DATA_KEY) */
    dataKey: string;
    log: boolean;
  };
  messaging: { provider: MessagingProviderKind; whatsapp: { phoneNumberId: string | null; token: string | null; apiVersion: string } };
  push: {
    /** null → Web Push disabled, console / outbox fallback */
    vapid: { publicKey: string; privateKey: string; subject: string } | null;
    /** endpoint hosts the API may POST to (SSRF guard); suffix match */
    allowedHosts: string[];
    /** send only a generic title/body through the browser vendor's push service */
    minimalPayload: boolean;
    ttlSeconds: number;
    timeoutMs: number;
  };
}

/** Browser push services (Chrome/Edge via FCM, Firefox, Safari/iOS, legacy Edge). Suffix match on the endpoint host. */
export const DEFAULT_PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

const bool = (v: string | undefined, dflt = false) => (v === undefined || v === '' ? dflt : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

export function loadDeliveryConfig(env: Record<string, string | undefined> = process.env): DeliveryConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const prod = nodeEnv === 'production';
  const provider = (env.EMAIL_PROVIDER || 'outbox') as EmailProviderKind;
  if (!['outbox', 'smtp'].includes(provider)) throw new Error(`EMAIL_PROVIDER must be smtp or outbox (got ${provider})`);
  let smtp: SmtpConfig | null = null;
  if (provider === 'smtp') {
    if (!env.SMTP_HOST) throw new Error('EMAIL_PROVIDER=smtp requires SMTP_HOST');
    const port = Number(env.SMTP_PORT || 587);
    smtp = {
      host: env.SMTP_HOST,
      port,
      secure: bool(env.SMTP_SECURE, port === 465),
      user: env.SMTP_USER || null,
      pass: env.SMTP_PASS || null,
      envelopeFrom: env.SMTP_ENVELOPE_FROM || null,
      rejectUnauthorized: bool(env.SMTP_TLS_REJECT_UNAUTHORIZED, true),
      connectionTimeoutMs: Number(env.SMTP_CONNECTION_TIMEOUT_MS || 10_000),
      socketTimeoutMs: Number(env.SMTP_SOCKET_TIMEOUT_MS || 20_000),
    };
  }
  const dataKey = env.OUTBOX_DATA_KEY || env.GUEST_DATA_KEY || 'dev-only-guest-data-key';
  if (prod && provider === 'smtp' && !env.OUTBOX_DATA_KEY && !env.GUEST_DATA_KEY) throw new Error('OUTBOX_DATA_KEY (or GUEST_DATA_KEY) must be set in production');
  const replyAddress = env.EMAIL_REPLY_ADDRESS || null;
  const messageIdDomain = env.EMAIL_MESSAGE_ID_DOMAIN || replyAddress?.split('@')[1] || 'mice.local';

  const vapidPublic = env.VAPID_PUBLIC_KEY || '';
  const vapidPrivate = env.VAPID_PRIVATE_KEY || '';
  const vapid = vapidPublic && vapidPrivate ? { publicKey: vapidPublic, privateKey: vapidPrivate, subject: env.VAPID_SUBJECT || 'mailto:ops@example.com' } : null;
  const messagingProvider = (env.MESSAGING_PROVIDER || 'outbox') as MessagingProviderKind;
  if (!['outbox', 'whatsapp_cloud'].includes(messagingProvider)) throw new Error(`MESSAGING_PROVIDER must be outbox or whatsapp_cloud (got ${messagingProvider})`);

  return {
    email: {
      provider,
      sendMode: env.EMAIL_SEND_MODE === 'queue' ? 'queue' : 'immediate',
      smtp,
      replyAddress,
      messageIdDomain,
      maxAttempts: Number(env.EMAIL_MAX_ATTEMPTS || 8),
      dataKey,
      log: nodeEnv === 'development',
    },
    messaging: {
      provider: messagingProvider,
      whatsapp: { phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || null, token: env.WHATSAPP_TOKEN || null, apiVersion: env.WHATSAPP_API_VERSION || 'v21.0' },
    },
    push: {
      vapid,
      allowedHosts: (env.WEB_PUSH_ALLOWED_HOSTS ? env.WEB_PUSH_ALLOWED_HOSTS.split(',') : DEFAULT_PUSH_HOSTS).map((s) => s.trim().toLowerCase()).filter(Boolean),
      minimalPayload: bool(env.WEB_PUSH_MINIMAL_PAYLOAD),
      ttlSeconds: Number(env.WEB_PUSH_TTL_SECONDS || 24 * 3600),
      timeoutMs: Number(env.WEB_PUSH_TIMEOUT_MS || 5000),
    },
  };
}
