// SKETCH — NOT IMPLEMENTED. Per-user OAuth "send as me" providers (docs/07 §3, docs/05 entegrasyon #2).
//
// The long-term target for §3.3 is that each user's own mailbox sends (Sent Items show the message, replies land in the
// user's inbox, no SMTP relay "send as" permission needed):
//   - Google Workspace: Gmail API `users.messages.send` (raw RFC 822, base64url) with scope gmail.send, per-user OAuth
//     consent OR domain-wide delegation for an internal app approved by the Workspace admin.
//   - Microsoft 365: Graph `POST /users/{id}/sendMail` (or create draft + send to get the message id), scope Mail.Send,
//     delegated per-user consent OR application permission limited with an ApplicationAccessPolicy to the agency's users.
// Both keep the SAME EmailProvider contract as SmtpEmailProvider: the outbox row (redacted) is written in the caller's
// transaction, delivery state / retries use the same outbox columns, and Message-ID / In-Reply-To / X-MICE-Project are
// set the same way (buildMail() in email-smtp.ts) so reply linking does not depend on the provider.
//
// What is still needed before implementing:
//   1. a `user_mail_accounts` table (tenant_id, user_id, provider 'google'|'microsoft', refresh_token_enc (pgcrypto, key
//      outside the DB), scopes, connected_at, revoked_at) + apply_standard_policies(…, false) — tokens never audited;
//   2. OAuth connect / callback routes (state + PKCE), token refresh with rotation, revocation handling (→ fall back to
//      SMTP or block sending with a clear "connect your mailbox" error);
//   3. inbound: Gmail `users.watch` (Pub/Sub) / Graph change notifications → link replies by In-Reply-To / References or
//      the plus-address tag (parseProjectReplyTag) → intake / RFQ reply parsing.
import type { Db } from '../db/pool.js';
import type { EmailMessage, EmailProvider } from './email.js';

/** Per-user access token source (refresh handled by the implementation). */
export interface UserMailTokenStore {
  /** access token for the mailbox of `fromAddress` in `tenantId`, or null when the user has not connected a mailbox */
  accessToken(db: Db, tenantId: string, fromAddress: string): Promise<{ token: string; provider: 'google' | 'microsoft' } | null>;
}

abstract class NotImplementedOAuthProvider implements EmailProvider {
  abstract readonly name: string;
  constructor(protected tokens: UserMailTokenStore) {}
  async send(_db: Db, _msg: EmailMessage): Promise<{ id: string }> {
    throw new Error(`${this.name} e-mail provider is a sketch and not implemented yet; use EMAIL_PROVIDER=smtp or outbox`);
  }
}

/** Gmail API (`POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, body `{ raw: base64url(rfc822) }`). */
export class GmailApiProvider extends NotImplementedOAuthProvider {
  readonly name = 'gmail_api';
}

/** Microsoft Graph (`POST https://graph.microsoft.com/v1.0/users/{from}/sendMail`, `{ message, saveToSentItems: true }`). */
export class GraphMailProvider extends NotImplementedOAuthProvider {
  readonly name = 'ms_graph';
}
