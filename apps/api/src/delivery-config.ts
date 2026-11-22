// Delivery-channel configuration (e-mail, SMS / WhatsApp, Web Push) from environment variables.
// Kept separate from config.ts so channel settings can evolve without touching the core AppConfig.
export type EmailProviderKind = 'outbox' | 'smtp' | 'oauth';
/** EMAIL_PROVIDER=oauth and the sender has no connected mailbox: SMTP send-as, outbox record, or hold + notify the sender */
export type OAuthFallback = 'smtp' | 'outbox' | 'hold';
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

export interface OAuthClient { clientId: string; clientSecret: string }
export interface OAuthMailConfig {
  google: OAuthClient | null;
  microsoft: (OAuthClient & { tenant: string }) | null;
  fallback: OAuthFallback;
  /** 'hold': give up (sender + admin notified) after this many hours without a connected mailbox */
  holdMaxHours: number;
  /** origin the provider redirects back to: <redirectBase>/api/mail/oauth/<provider>/callback */
  redirectBase: string;
  stateTtlSeconds: number;
  /** pgcrypto key for refresh / access tokens (MAIL_TOKEN_KEY, defaults to OUTBOX_DATA_KEY / GUEST_DATA_KEY) */
  tokenKey: string;
  /** the connected mailbox must be the user's own login address (§3.3) — default true */
  requireSameAddress: boolean;
  timeoutMs: number;
}

export interface WhatsAppTemplateRef { name: string; language: string }
export interface WhatsAppConfig {
  phoneNumberId: string | null;
  token: string | null;
  apiVersion: string;
  /** Meta-approved template names / languages ([Doğrulanmalı] the approved names in the WABA) */
  templates: {
    fieldExtra: WhatsAppTemplateRef & { urlButton: boolean };
    quoteReminder: WhatsAppTemplateRef;
    criticalAlert: WhatsAppTemplateRef;
  };
  timeoutMs: number;
}
export interface SmsConfig {
  /** generic TR gateway (Netgsm-style REST JSON) — vendor [Doğrulanmalı] */
  url: string;
  user: string | null;
  password: string | null;
  /** approved originator / başlık (msgheader) */
  sender: string;
  encoding: string;
  /** İYS filter code sent as `iysfilter` ('' → omitted); transactional messages normally '0' [Doğrulanmalı] */
  iysFilter: string;
  timeoutMs: number;
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
    /** per-user OAuth mailboxes (Gmail API / Microsoft Graph) — connect flow works whatever EMAIL_PROVIDER is */
    oauth: OAuthMailConfig;
  };
  messaging: {
    provider: MessagingProviderKind;
    whatsapp: WhatsAppConfig;
    sms: SmsConfig | null;
    /** pgcrypto key of the retry copy (same as the e-mail outbox key) */
    dataKey: string;
    maxAttempts: number;
  };
  /** §15: critical push not opened → WhatsApp / SMS to the admin (minutes come from the rule criticalPushFallbackMinutes) */
  criticalFallback: { enabled: boolean; maxAgeHours: number };
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
  if (!['outbox', 'smtp', 'oauth'].includes(provider)) throw new Error(`EMAIL_PROVIDER must be smtp, oauth or outbox (got ${provider})`);
  const fallback = (env.EMAIL_OAUTH_FALLBACK || 'outbox') as OAuthFallback;
  if (!['smtp', 'outbox', 'hold'].includes(fallback)) throw new Error(`EMAIL_OAUTH_FALLBACK must be smtp, outbox or hold (got ${fallback})`);
  let smtp: SmtpConfig | null = null;
  if (provider === 'smtp' || (provider === 'oauth' && fallback === 'smtp')) {
    if (!env.SMTP_HOST) throw new Error(provider === 'smtp' ? 'EMAIL_PROVIDER=smtp requires SMTP_HOST' : 'EMAIL_OAUTH_FALLBACK=smtp requires SMTP_HOST');
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
  const waToken = env.WHATSAPP_TOKEN || null;
  const waPhone = env.WHATSAPP_PHONE_NUMBER_ID || null;
  if (prod && messagingProvider === 'whatsapp_cloud' && (!waToken || !waPhone)) throw new Error('MESSAGING_PROVIDER=whatsapp_cloud requires WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID');
  const smsKind = env.SMS_PROVIDER || 'none';
  if (!['none', 'http'].includes(smsKind)) throw new Error(`SMS_PROVIDER must be none or http (got ${smsKind})`);
  if (smsKind === 'http' && (!env.SMS_API_URL || !env.SMS_SENDER)) throw new Error('SMS_PROVIDER=http requires SMS_API_URL and SMS_SENDER');
  const lang = env.WHATSAPP_TEMPLATE_LANGUAGE || 'tr';
  const google = env.OAUTH_GOOGLE_CLIENT_ID && env.OAUTH_GOOGLE_CLIENT_SECRET ? { clientId: env.OAUTH_GOOGLE_CLIENT_ID, clientSecret: env.OAUTH_GOOGLE_CLIENT_SECRET } : null;
  const microsoft = env.OAUTH_MICROSOFT_CLIENT_ID && env.OAUTH_MICROSOFT_CLIENT_SECRET
    ? { clientId: env.OAUTH_MICROSOFT_CLIENT_ID, clientSecret: env.OAUTH_MICROSOFT_CLIENT_SECRET, tenant: env.OAUTH_MICROSOFT_TENANT || 'organizations' } : null;
  if (provider === 'oauth' && !google && !microsoft) throw new Error('EMAIL_PROVIDER=oauth requires OAUTH_GOOGLE_CLIENT_ID/SECRET and/or OAUTH_MICROSOFT_CLIENT_ID/SECRET');
  if (prod && (google || microsoft) && !env.MAIL_TOKEN_KEY && !env.OUTBOX_DATA_KEY && !env.GUEST_DATA_KEY) throw new Error('MAIL_TOKEN_KEY (or OUTBOX_DATA_KEY / GUEST_DATA_KEY) must be set in production');

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
      oauth: {
        google,
        microsoft,
        fallback,
        holdMaxHours: Number(env.EMAIL_OAUTH_HOLD_MAX_HOURS || 72),
        redirectBase: (env.MAIL_OAUTH_REDIRECT_BASE ?? env.PUBLIC_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
        stateTtlSeconds: Number(env.MAIL_OAUTH_STATE_TTL_SECONDS || 600),
        tokenKey: env.MAIL_TOKEN_KEY || dataKey,
        requireSameAddress: bool(env.MAIL_OAUTH_REQUIRE_SAME_ADDRESS, true),
        timeoutMs: Number(env.MAIL_API_TIMEOUT_MS || 15_000),
      },
    },
    messaging: {
      provider: messagingProvider,
      whatsapp: {
        phoneNumberId: waPhone, token: waToken, apiVersion: env.WHATSAPP_API_VERSION || 'v21.0',
        templates: {
          fieldExtra: { name: env.WHATSAPP_TEMPLATE_FIELD_EXTRA || 'field_extra_approval', language: env.WHATSAPP_TEMPLATE_FIELD_EXTRA_LANGUAGE || lang, urlButton: bool(env.WHATSAPP_TEMPLATE_FIELD_EXTRA_URL_BUTTON, false) },
          quoteReminder: { name: env.WHATSAPP_TEMPLATE_QUOTE_REMINDER || 'quote_reminder', language: env.WHATSAPP_TEMPLATE_QUOTE_REMINDER_LANGUAGE || lang },
          criticalAlert: { name: env.WHATSAPP_TEMPLATE_CRITICAL_ALERT || 'critical_alert', language: env.WHATSAPP_TEMPLATE_CRITICAL_ALERT_LANGUAGE || lang },
        },
        timeoutMs: Number(env.WHATSAPP_TIMEOUT_MS || 10_000),
      },
      sms: smsKind === 'http' ? {
        url: env.SMS_API_URL!, user: env.SMS_API_USER || null, password: env.SMS_API_PASSWORD || null, sender: env.SMS_SENDER!,
        encoding: env.SMS_ENCODING || 'TR', iysFilter: env.SMS_IYS_FILTER ?? '0', timeoutMs: Number(env.SMS_TIMEOUT_MS || 10_000),
      } : null,
      dataKey,
      maxAttempts: Number(env.MESSAGING_MAX_ATTEMPTS || 6),
    },
    criticalFallback: { enabled: !['0', 'false', 'off', 'no'].includes((env.CRITICAL_FALLBACK || '').toLowerCase()), maxAgeHours: Number(env.CRITICAL_FALLBACK_MAX_AGE_HOURS || 24) },
    push: {
      vapid,
      allowedHosts: (env.WEB_PUSH_ALLOWED_HOSTS ? env.WEB_PUSH_ALLOWED_HOSTS.split(',') : DEFAULT_PUSH_HOSTS).map((s) => s.trim().toLowerCase()).filter(Boolean),
      minimalPayload: bool(env.WEB_PUSH_MINIMAL_PAYLOAD),
      ttlSeconds: Number(env.WEB_PUSH_TTL_SECONDS || 24 * 3600),
      timeoutMs: Number(env.WEB_PUSH_TIMEOUT_MS || 5000),
    },
  };
}
