# @mice/api — MICE AI Operations OS backend

Fastify 5 + PostgreSQL 16 (`pg`), zod, JWT, WebAuthn (Face ID step-up), pdfkit, exceljs.
AI is always obtained through `createAiService()` from `@mice/ai` (mock without `ANTHROPIC_API_KEY` or with `AI_PROVIDER=mock`).

## Run

```bash
bash scripts/db-start.sh            # from repo root: local Postgres 16 on :5432 (databases mice, mice_test)
npm run migrate -w apps/api         # apply src/db/migrations/*.sql (tracked in schema_migrations)
npm run seed -w apps/api            # demo tenant "Demo MICE Acenta" (idempotent); add `-- --reset` to drop & recreate
npm run dev -w apps/api             # http://localhost:3001  (GET /api/health)
npm run worker -w apps/api          # follow-ups + phase B jobs (anonymization, digests, event end, daily summaries, e-mail retry); `-- --once`
npm run migrate:deploy -w apps/api  # deployment: migrate (owner) + `ALTER ROLE mice_app PASSWORD` from APP_DB_PASSWORD
npm run vapid:generate -w apps/api  # VAPID key pair for Web Push
npm run inbound:imap -w apps/api    # optional IMAP poller (INBOUND_EMAIL_MODE=imap); `-- --once`
npm run export-eval-set -w apps/api -- --tenant=<uuid>   # real corrections → packages/ai/eval fixtures (PII masked)
npm test -w apps/api                # vitest against mice_test (schema dropped + migrated in globalSetup)
npx tsc --noEmit -p apps/api
```

Demo logins (password `demo1234`): `admin@demo.test`, `clerk@demo.test` (sales, scoped authority for Marmara Teknoloji),
`ops@demo.test`, `field@demo.test`, `finance@demo.test`.

> The scripts run `tsx --no-experimental-require-module`: on Node ≥ 22.12 tsx otherwise mis-loads a `module-sync`
> dependency of exceljs (`generator-function`).

## Environment

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://mice_app:mice_app@localhost:5432/mice` | **must** be the non-superuser `mice_app` role (RLS) |
| `MIGRATION_DATABASE_URL` | `postgres://postgres@localhost:5432/mice` | owner/superuser — migrations & seed only |
| `PORT` / `HOST` | `3001` / `0.0.0.0` | |
| `JWT_SECRET`, `JWT_TTL` (legacy `JWT_EXPIRES_IN`) | dev secret, `8h` | secret required (≥ 32 chars) unless `NODE_ENV` is `development` / `test`. Tokens carry `tv` = `users.token_version`, checked on every request |
| `RATE_LIMIT_REDIS_URL` | – | multi-instance: all limiters use @fastify/rate-limit's Redis store (optional `ioredis` package, `npm i ioredis -w apps/api`; refuses to start without it). Empty → in-memory per instance |
| `XLSX_MAX_UNCOMPRESSED_MB` / `XLSX_MAX_RATIO` / `XLSX_MAX_ENTRIES` | 30 / 100 / 2000 | zip-bomb guard `src/lib/zip-guard.ts` before every exceljs load |
| `CORS_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | comma separated |
| `PUBLIC_BASE_URL` | `http://localhost:5173` | prefix of supplier (`/s/rfq/<token>`) and quote (`/q/<token>`) links; `''` → relative |
| `GUEST_DATA_KEY` | dev key | pgcrypto key for guest PII (required unless `NODE_ENV` is `development` / `test`) |
| `ALLOW_DEV_BIOMETRIC` | – | `{biometric:{method:'dev'}}` is accepted only when `NODE_ENV` is `development` / `test` or this is `1` |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGIN` | `localhost`, …, CORS origins | |
| `PUBLIC_RATE_LIMIT` | `60` | requests/min per IP on `/api/public/*` |
| `LOGIN_RATE_LIMIT` | `20` | `POST /api/auth/login` attempts/min per IP |
| `WORKER_INTERVAL_MS` | `300000` | |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_MODEL`, … | | see `packages/ai/src/factory.ts` |
| `PDF_FONT_PATH`, `PDF_FONT_BOLD_PATH` | DejaVu/Liberation if present | Unicode TTF for Turkish characters |
| `LOG_LEVEL` | `info` | pino JSON logs (off in `NODE_ENV=test`); redaction paths in `src/logger.ts` |
| `TRUST_PROXY` | – | `1` behind nginx/LB (real client IP for rate limits) or proxy CIDR list |
| `SHUTDOWN_TIMEOUT_MS` | 15000 / 30000 | API / worker hard-exit timeout after SIGTERM |
| `APP_DB_PASSWORD` | – | `migrate:deploy` sets the `mice_app` password (owner connection) |
| `EMAIL_PROVIDER` | `outbox` | `smtp` → `SmtpEmailProvider` (nodemailer) |
| `EMAIL_SEND_MODE` | `immediate` | `queue` → only the worker talks to SMTP |
| `SMTP_HOST/PORT/SECURE/USER/PASS`, `SMTP_ENVELOPE_FROM`, `SMTP_TLS_REJECT_UNAUTHORIZED`, `SMTP_*_TIMEOUT_MS` | `587`, STARTTLS | |
| `EMAIL_REPLY_ADDRESS`, `EMAIL_MESSAGE_ID_DOMAIN`, `EMAIL_MAX_ATTEMPTS`, `OUTBOX_DATA_KEY` | –, reply domain, 8, `GUEST_DATA_KEY` | reply linking / retry payload key |
| `MESSAGING_PROVIDER`, `WHATSAPP_PHONE_NUMBER_ID/TOKEN/API_VERSION` | `outbox` | WhatsApp Cloud API is a skeleton (not live) |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TENANT`, `WHATSAPP_MAX_BYTES` | –, –, `demo`, 1 MB | inbound WhatsApp webhook (no secret → every POST is 401, no token → GET 403) |
| `INBOUND_EMAIL_SECRET`, `INBOUND_EMAIL_TENANT` | –, `demo` | env HMAC secret, used ONLY for that tenant when it has no `inbound_channels` row |
| `INBOUND_REPLAY_WINDOW_SECONDS`, `INBOUND_EMAIL_MAX_BYTES`, `INBOUND_ATTACHMENT_MAX_BYTES`, `INBOUND_MAX_ATTACHMENTS`, `INBOUND_ATTACHMENTS_TOTAL_MAX_BYTES`, `INBOUND_RATE_LIMIT` | 300 s, 25 MB, 10 MB, 10, 20 MB, 300/min | |
| `INBOUND_EMAIL_MODE`, `IMAP_HOST/PORT/SECURE/USER/PASS/MAILBOX/PROCESSED_MAILBOX/TENANT/POLL_INTERVAL_MS/MAX_MESSAGES_PER_POLL` | `webhook` | `imap` lets `npm run inbound:imap` start |
| `VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT` | – | Web Push; absent → console fallback |
| `WEB_PUSH_ALLOWED_HOSTS`, `WEB_PUSH_MINIMAL_PAYLOAD`, `WEB_PUSH_TTL_SECONDS`, `WEB_PUSH_TIMEOUT_MS` | push services, –, 86400, 5000 | SSRF allow-list (suffix match) |

Change the `mice_app` password in production: `ALTER ROLE mice_app PASSWORD '…'`.

## Security residual-risk fixes (docs/09 G-15 … G-21)

- **Sessions (G-17):** `010_session_revocation.sql` adds `users.token_version`; login / `POST /api/auth/password`
  (`{currentPassword, newPassword}` → `{token}`) sign `tv`; `withUserCtx` refuses a token whose `tv` differs (no cache, same
  user-row read). Bumped by password change, `PATCH /api/users/:id` role / authority / scope / canSign / active changes and
  `POST /api/users/:id/revoke-sessions` (admin, human). Default TTL 8h.
- **Supplier-safe reference (G-15):** `services/visibility.ts` `supplierRef()` (domain `supplierSafeCode`): RFQ drafts,
  supplier portal view, RFQ 24h reminder template, negotiation, option-extension, revision-request and supplier-confirmation
  drafts, rooming list xlsx use `PRJ-0042-20270312-80`; `X-MICE-Project` header is always `PRJ-0042`. Rule
  `hideCustomerFromSuppliers` (default true). Contract fields keep the customer / billing name.
- **Field role least privilege (G-16):** rule `fieldRoleCanSeeFinancials` (default false) → `projectDetail` redacted (no profit,
  offers / evaluations, item cost / sale, quotes, contracts, financial documents, audit images of money rows), timeline / similar /
  ask redacted, `403 FINANCIALS_HIDDEN` on `/api/quotes/:id(/pdf)`, `/api/projects/:id/contracts`, `/api/contracts/:id`,
  `/api/items/:id/comparison`, `/api/finance/entries`, financial document file / regenerate and undecidable decision details;
  drafts list only own drafts. **Draft sending:** `POST /api/drafts/:id/send` only by the draft owner (`from_user_id`) or the admin
  (`403 DRAFT_NOT_OWNER`).
- **Automation (§15 × §16):** rule `neverAutomateKinds` (default `customer_quote`, `quote_approval`, `margin_override`) — no auto
  execution, no promotion proposal, `promoteAction` refuses. Rule `outboundAutoSendRequiresStandingApproval` (default false):
  outbound kinds (`rfq_send`, `negotiation_message`, `outbound_message`, `contract_diff`) keep opening an approval card in auto mode
  (`detail.automation = 'outbound_held_for_approval'`); true → previous behaviour (auto-send + 1/20 sample).
- **XLSX zip bomb (G-18):** `lib/zip-guard.ts` `assertSafeZip` in `xlsxToCsv` (offers, invoices, contracts, bank statements, public
  RFQ files) → `400 UNSAFE_ARCHIVE`.
- **Postgres errors (G-19):** `errors.ts` maps SQLSTATEs to generic messages (no constraint / table / DETAIL); unknown → 500; logs only
  `pgLogFields()` (code, constraint, table, column, message — never DETAIL).
- **Worker leader lock (G-20):** `src/worker-lock.ts` session `pg_try_advisory_lock` on a dedicated connection; `runIfLeader()` —
  standby instances log "worker standby" and retry each tick.
- **Rate-limit store (G-21):** `src/rate-limit-store.ts` (`RATE_LIMIT_REDIS_URL`), used by auth, public, public-b and inbound limiters.
- Tests: `test/security-residual.test.ts`.

## Principles enforced in the database (`src/db/migrations`)

- **Multi-tenant RLS** — every table has `tenant_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy
  `tenant_id = app_tenant_id()` (`current_setting('app.tenant_id')`). The API connects as `mice_app` (no superuser, no
  BYPASSRLS, no DELETE/TRUNCATE). `withTenant(tenantId, actor, fn)` (`src/db/pool.ts`) runs each request in a transaction
  with `SET LOCAL app.tenant_id / app.user_id / app.actor_type / app.device`. Public token routes resolve the tenant from the
  token **hash** via the SECURITY DEFINER function `resolve_public_token()`, then continue under RLS. Login uses
  `auth_lookup_user()`, the worker `app_tenant_ids()`.
- **Nothing is deleted** — `BEFORE DELETE/TRUNCATE` triggers raise on every table; generic `AFTER INSERT/UPDATE` audit
  trigger writes `audit_log` (actor from `app.*`, redacted before/after jsonb, project_id). `audit_log` is append-only.
  `price_history`, `quote_lines`, `automation_events`, `document_dependencies` are insert-only; supplier offers can only get
  new versions (`superseded_by`).
- **Change propagation** — triggers on projects / service_items / supplier_offers / quotes / contracts / finance_entries /
  guests / field_extras / customers mark dependent `documents` `stale` (`doc_kinds_for()` mirrors
  `DOCUMENT_DEPENDENCIES`; `document_dependencies` narrows to the rows a document actually read). A stale document cannot
  be marked sent; a quote cannot go to `sent` unless approved and its quote document is current.
- **Signed contracts are locked** — only `status signed→amended` / `superseded_by` may change; changes are amendment rows.
- AI actors (`app.actor_type='ai'`) can never accredit a supplier or record a signature.

Phase B: create new tables in a new migration and call `SELECT apply_standard_policies('table')` (RLS + no-delete + audit + grants)
and `SELECT apply_tenant_foreign_keys()` (composite `(tenant_id, col) → (tenant_id, id)` FKs — FK checks bypass RLS; `008`).
`004_phase_b.sql` adds `notifications`, `style_summaries`, field-extra admin/customer-approval columns, payment
approval/paid columns and two more DB guards: **a finance entry can only become `approved`/`paid` with a human actor**
(`finance_money_guard`, §6 money_movement) and **an AI actor can never write `rules`** (`rules_change_guard`).

## Delivery channels & ops (production)

- `src/delivery-config.ts` — `loadDeliveryConfig(env)` (e-mail / messaging / push settings).
- `src/services/delivery.ts` — `createDeliveryProvider()` → `ChannelRouter` (the `deps.email` used everywhere): `email` →
  `SmtpEmailProvider` or `OutboxEmailProvider`; `sms` / `whatsapp` → `MessagingProvider` (outbox). `runOutboxJobs(ctx, now)`
  (worker post-job): delivers queued / retries failed SMTP rows, notifies sender + admins once when a message is given up.
- `src/services/email-smtp.ts` — `SmtpEmailProvider`: From = the responsible user (§3.3); `buildMail()` sets
  `Message-ID <outbox-id@domain>`, `In-Reply-To`/`References` (previous message to the same recipient in the project),
  `X-MICE-Project`, plus-addressed `Reply-To` (`replies+prj-0042@…`), `Auto-Submitted` for autonomous messages. Outbox row
  (redacted) + `outbox_payloads` (pgcrypto, purged after delivery, not audited); exponential backoff, SMTP 5xx = permanent.
  `email-oauth.ts` — `GmailApiProvider` / `GraphMailProvider` sketches (not implemented).
- `src/services/messaging.ts` — `MessagingProvider`, `OutboxMessagingProvider`, `WhatsAppCloudProvider` skeleton,
  `normalizeMsisdn`, `whatsappTemplatePayload`.
- `src/services/push.ts` + `routes/push.ts` — `WebPushNotificationService` (`web-push`, VAPID) behind `NotificationService`:
  `GET /api/push/vapid-public-key`, `POST /api/push/subscribe` (upsert per endpoint, endpoint host allow-list),
  `POST /api/push/unsubscribe` (active=false — no DELETE). Critical → immediate (urgency high); routine → digest
  (`topic: mice-digest`). 404/410 → subscription deactivated; push bookkeeping runs in a savepoint (never aborts the request).
  `NotificationService.deliver(msg, db)` now receives the caller's tenant transaction.
- `src/routes/health.ts` — `GET /api/health` (liveness + db), `GET /api/ready` (db + all migrations applied + not shutting down).
- `src/logger.ts` — pino options (redaction paths, token-free URLs), `TRUST_PROXY`. Graceful shutdown in `server.ts` / `worker.ts`.
- `src/db/bootstrap.ts` — `migrate:deploy`; migration `006_delivery_channels.sql` (outbox delivery columns, `outbox_payloads`,
  `push_subscriptions`, `GRANT SELECT ON schema_migrations TO mice_app`; tenant FKs added by 008).
- Container: `apps/api/Dockerfile` (+ `docker/api-entrypoint.sh`: `serve | migrate | worker | seed`), see root README → Dağıtım.
- Tests: `test/delivery.test.ts` (mocked nodemailer transport and web-push sender).

## Inbound e-mail / WhatsApp, e-Fatura (migration `011_inbound_channels.sql`)

Code: `routes/inbound.ts`, `services/inbound/{normalize,email-router,whatsapp,common,views}.ts`, `src/inbound-imap.ts`,
`src/inbound-config.ts`, `services/ubl-tr.ts` + `services/einvoice.ts`. Tests: `test/inbound.test.ts` (fixture `test/fixtures/ubl-tr-invoice.xml`).

**Webhooks (no login; signature-authenticated, rate-limited, raw body kept for the signature)** — `:key` = tenant slug or an
`inbound_channels.route_key`. Any signature failure, stale timestamp or unknown key → **401 `INVALID_SIGNATURE`**.

| Route | Format | Authentication |
|---|---|---|
| `POST /api/inbound/email/:key` | our normalized JSON (below) | `X-MICE-Timestamp: <unix s>`, `X-MICE-Signature: sha256=<hex HMAC-SHA256(secret, "<ts>." + raw body)>`, ±`INBOUND_REPLAY_WINDOW_SECONDS` |
| `POST /api/inbound/email/:key/mime` | raw RFC 822 (`message/rfc822`) — SES (receipt rule → S3/SNS → small forwarder), MTA pipe | same HMAC headers |
| `POST /api/inbound/email/:key/postmark` | Postmark inbound JSON (`FromFull`, `ToFull`, `Headers[]` → RFC Message-ID / In-Reply-To / References, `Attachments[]`) | HTTP Basic in the webhook URL, password = tenant secret (Postmark cannot sign; replay is neutralised by Message-ID idempotency) |
| `POST /api/inbound/email/:key/mailgun` | Mailgun route forward (multipart: `from`, `recipient`, `subject`, `body-plain`, `Message-Id`, `In-Reply-To`, `References`, `message-headers`, files) | Mailgun `timestamp` + `token` + `signature` = HMAC-SHA256(signing key = tenant secret), replay window |
| `GET /api/inbound/whatsapp` | `hub.mode=subscribe&hub.verify_token&hub.challenge` | `WHATSAPP_VERIFY_TOKEN` → echoes the challenge, else 403 |
| `POST /api/inbound/whatsapp` | Meta Cloud API `messages` webhook | `X-Hub-Signature-256: sha256=HMAC(WHATSAPP_APP_SECRET, raw body)`; tenant by `metadata.phone_number_id` (`inbound_channels` route key, else `WHATSAPP_PHONE_NUMBER_ID` → `WHATSAPP_TENANT`) |

Normalized JSON: `{from, to?, cc? (string | string[]), subject?, text?, html?, messageId?, inReplyTo?, references? (string | string[]),
date?, headers? {Auto-Submitted …}, attachments?: [{filename, contentType?, base64}]}` → `InboundResult {id, duplicate, kind, status,
projectId, intakeProjectId, offerId, taskId, linkMethod}`.

Staff: `GET /api/projects/:id/inbound-messages` (project "Gelen kutusu"), `GET /api/inbound-messages/:id`,
`GET /api/inbound-channels` / `POST /api/inbound-channels {channel:'email'|'whatsapp', routeKey?, rotateSecret?}` (admin; the e-mail
secret is generated server-side and returned **once**; previous row deactivated, never deleted; `inbound_channels` is not row-audited so
the secret never reaches `audit_log`).

**Router (`email-router.ts`)** — 1) idempotent per Message-ID (`inbound_messages (tenant, channel, provider_message_id)` unique; a
replay returns `duplicate:true`; a `failed` row is re-processed on retry). 2) auto-replies / bounces / our reply mailbox → stored,
`ignored`. 3) thread → project: `In-Reply-To`/`References` = our outbox `Message-ID <outbox-id@EMAIL_MESSAGE_ID_DOMAIN>` (outbox row →
draft → project; also earlier inbound ids) → plus address `replies+prj-0042@…` → subject tag `[PRJ-0042]` → (no thread) supplier with
exactly one open RFQ. 4) linked + sender = supplier e-mail with an RFQ in that project → **supplier reply**: first allowed attachment
(PDF / XLSX / CSV / image) or the reply text with the quoted part stripped → existing `parseOffer` (actor `supplier`) → new offer
version, RFQ `responded`, low confidence → `low_confidence_review` card as before; several RFQs / unreadable → task. Linked + customer
(project customer contact, same company domain, or someone we wrote to in the project) → attached; deterministic classifier
(`classifyCustomerText`): revision / acceptance → `inbound_customer_*` task for the owner + critical notification (**never an
automatic acceptance**), otherwise routine notification. 5) unknown thread from a non-supplier → `runIntake` (channel email, customer
by contact e-mail, duplicate check → critical notification), `created_by` NULL. 6) unlinked supplier mail → `needs_review` + "hangi
projeye ait?" notification. Attachments: allow-list pdf/xlsx/csv/txt/xml/png/jpg by extension **and** magic bytes, ≤10 per mail,
≤10 MB each, ≤20 MB total; rejected ones are metadata only. Mail content is data for extraction only — nothing in it is executed.

**WhatsApp** — text from a known customer contact (phone normalized E.164) or a number that already opened a project → attached to
its open project (same classifier/task); otherwise → intake (channel whatsapp). Quick-reply / interactive button payload
`extra_approve:<one-time token>` → `publicApproveExtra` (same as `/e/<token>`), refused when the sender number differs from the
extra's `customer_phone`. Media are not downloaded (needs the Graph media API) — stored as a note. Status callbacks are ignored.

**IMAP (`src/inbound-imap.ts`)** — `INBOUND_EMAIL_MODE=imap npm run inbound:imap -w apps/api`: imapflow, UNSEEN → mailparser → the
same router → `\Seen` (or move to `IMAP_PROCESSED_MAILBOX`); failures stay UNSEEN and are retried. One instance per mailbox.

**e-Fatura UBL-TR (§7 Adım 7, docs/07 §4)** — `POST /api/finance/supplier-invoices` multipart with an `.xml` file whose root is a UBL
`Invoice` → `parseUblInvoice` (fast-xml-parser, namespace-agnostic, DOCTYPE/ENTITY refused, 5 MB): invoice no, ETTN, profile/type,
dates, currency + exchange rate, seller / buyer VKN·TCKN / name / tax office, lines, tax subtotals (KDV per rate `0015`, konaklama
vergisi `0059`), monetary totals, notes; consistency warnings become alarms. **No AI, confidence 1.0** (`meta.source = 'ubl_xml'`,
`meta.ubl` summary). Supplier = `suppliers.tax_number` (new, settable via `POST/PATCH /api/suppliers` `taxNumber`) else name; project
= `projectId` field, else a `PRJ-####` in notes/order reference, else the single open project with a signed contract of that supplier
(else 400 `INVOICE_LINK_REQUIRED` with candidates). `amount` = TaxExclusiveAmount (net), `vatAmount` = KDV total; ETTN stored in
`finance_entries.ubl_uuid` (unique → 409 `DUPLICATE_INVOICE`). Contract linking, mismatch alarm, task, commission: unchanged code path.

## Code map

- `src/server.ts` — `buildApp(opts)` (tests inject `email`, `now`, `rng`, `ai`); `src/worker.ts` — `runFollowupsOnce(deps, now)`.
- `src/routes/index.ts` — **route registration index** (add phase B modules here). `core.ts` (staff, steps 0–5),
  `public.ts` (token routes, rate-limited), `reference.ts` (rules/users/customers/checklist/automation/audit read),
  `auth.ts` (login, me, WebAuthn).
- Phase B: `routes/operations.ts` (Adım 6 guests/rooming, field extras/issues, daily summary + Adım 7 finance),
  `routes/admin.ts` (Adım 8 closing, weekly report, rules/users/delegations/checklist), `routes/public-b.ts` (rooming,
  consent withdrawal, extra approval, survey — own rate-limited scope). Services: `guests.ts` (pgcrypto PII, consent,
  anonymization), `operations.ts` (ops calendar on signature, field extras, change flow, daily summary, event-ended marker),
  `finance.ts` (invoices, payment requests, bank import/matching, Mikro export, commissions), `closing.ts` (closing check,
  close, survey, customer invoice draft generator), `reports.ts` (weekly report, user stats), `notifications.ts`
  (NotificationService), `phase-b-registry.ts` (decision effects), `src/jobs.ts` (worker pre/post jobs).
- `src/services/*` — business services. Extension points: `registerDecisionEffect(kind, fn)` (`decisions.ts`, wired in
  `registry.ts`), `registerDocumentGenerator(kind, …)` (`documents.ts`), `aiGate()` (`automation.ts`) for every
  suggest-type AI action, `EmailProvider` (`email.ts` outbox; SMTP in `email-smtp.ts`, wired by `delivery.ts`).

## API deviations / additions (all additive to `packages/shared/src/api.ts`)

- `BuildQuoteRequest.optionUntil?` — explicit customer option date (blocked if later than a supplier option).
- `POST /api/quotes/:id/firm-approval {poNumber?|signedFormFileName?}` — signed form / PO for `signed_or_po` customers.
- `POST /api/rfqs/:id/link` — rotates and returns a one-time `supplierLink` (RFQ links are otherwise created when the
  `rfq_send` decision is approved and only travel inside the e-mail).
- `POST /api/auth/webauthn/authenticate/verify`, `GET /api/projects/:id/documents`, `GET /api/documents/:id/file`,
  `GET /api/projects/:id/quotes`, `GET /api/projects/:id/contracts`, `GET /api/contracts/:id`, `GET /api/suppliers/:id`,
  `POST /api/drafts/:id/request-approval`.
- `POST /api/public/quotes/:token/accept` returns `{ok:true, firm}`; `/revision` returns `{ok, targetStep, diff}`;
  `POST /api/public/rfq/:token/files` parses the uploaded file into a new offer version.
- `POST /api/contracts/:id/parse` updates the draft contract in place (version+1; history in audit_log).
- OfferLine `vatRate` is a fraction (0.1) in the API/domain (and from `@mice/ai`); percent values (10) from manual/portal input are normalized.

## Phase B (steps 6–8, reports, admin)

**Operations (Adım 6)**
- Contract signature (`POST /api/contracts/:id/sign`) → `generateOperationsCalendar`: `operationsCalendar()` tasks filtered by
  the contract's item kinds (rooming list / attrition / final pax for accommodation, menu for F&B/hall, tech brief for
  hall/technical, transfer list for transfer, payment dues, one event-day checklist per project), due 10:00 local, assigned to
  the responsible role (project owner if they hold the role, else the first active user of that role). Idempotent `origin_key`.
- Guests: PII (`full_name/email/phone`) encrypted with `pgp_sym_encrypt(…, GUEST_DATA_KEY)`; only roles with
  `roleCan('view_guest_pii')` (admin, clerk_ops, field) get decrypted values — for other roles **nothing is decrypted**, names
  come back as `"Misafir N (ROOM) — ***"` and e-mail/phone `null`. Public rooming form: per-guest `consentReuse` (unticked by
  default) → `consent_events('given')`, `retention_until = retentionUntil(event end, guestDataRetentionDays)`. Consenting guests
  with an e-mail receive a personal withdrawal link (`/api/public/consent/<token>/withdraw`: GET = confirmation page, POST =
  withdraw). Worker job anonymizes (`shouldAnonymize`) → PII columns NULL, `anonymized_at`, `consent_events('anonymized')`.
  The audit log never contains PII (`audit_redact`).
- Field extras: `fieldExtraNeedsAdmin` with tenant limits (5.000 / 15.000 TL, inclusive). Above → `field_extra` decision
  (admin/delegate, Face ID). Always: one-time customer link `/e/<token>`, sent as SMS (outbox `channel='sms'`, link redacted)
  from the field lead when a phone is known (else returned as `approvalLink` for WhatsApp sharing). Customer approval records
  name, time and amount. Reflect: `reflected:false` requires a reason (API + DB check).
- Change flow: amendments (phase A) and `PATCH /api/items/:id` on a contracted project compute `changeImpact`, create a
  supplier notification draft (requires approval) + task, and a critical `condition_risk` card when the margin falls below target.
- Daily summary: deterministic 3 lines (tasks / issues / extras of the day) rendered through `ai.draftMessage('daily_summary')`;
  during events the worker creates a customer draft (human sends) and a routine admin notification after 18:00.
- Notifications (§15): `NotificationService` (`deliver`) with a console implementation; every notification row is stored in
  `notifications`. Critical (urgent / critical decision cards, high-severity field issues, approved payments) → immediate;
  routine → `deliver_after` = next 08:30 / 18:00 slot; worker folds due ones into one digest per user. Hook:
  `onDecisionCreated` in `decisions.ts`. Replace with `setNotificationService()`.

**Finance (Adım 7)** — the system never moves money.
- Supplier invoices: JSON or multipart (`file` + string fields, `serviceItemIds` comma separated); files/text read by
  `ai.parseInvoice`. `amount` = NET (matrah, VAT excluded), `vatAmount` separate. Linked to the supplier's signed contract and its
  items; cumulative invoiced EUR vs contract payables (tolerance max(1 EUR, 0.5 %)) → `alarms[]` + `invoice_mismatch` task +
  admin notification. Duplicate invoice no per supplier → 409. Separately billed supplier commissions (`suppliers.commission`)
  create a `commission` entry (reconcile: `POST /api/finance/commissions/:id/reconcile`).
- Payment requests: finance (`create_payment_request`) → entry `pending_approval` + `payment_approval` decision (Face ID,
  admin or active delegate, each payment separately). Effect → `approved` only; AI/auto execution refused in the effect, in
  `NEVER_AUTO_KINDS` and by the DB guard. A human records the bank payment: `POST /api/finance/entries/:id/mark-paid`.
- Bank statements: CSV (`parseBankCsv`) or XLSX (exceljs → CSV → same parser); row hash makes re-imports idempotent.
  `matchBankTransaction` ≥ `aiConfidenceThreshold` → automatic match; ≥ 0.3 → `low_confidence_payment_match` via `aiGate`
  (`low_confidence_review` card, `entityType='bank_transaction'`, finance decides; Düzelt `{entryId}`); else unmatched. Outgoing
  unmatched payments get `payer_user_id` = importer → daily reminder task + push, escalation to admin after
  `unbilledPaymentEscalationDays` (worker). Manual match closes reminders and records the correction for learning.
- Customer invoice draft: document `customer_invoice_draft` (accepted option in quote currency + customer-approved AND reflected
  extras, VAT + accommodation tax, PDF). The issued invoice number from Mikro is recorded with `POST /api/finance/customer-invoices`.
- Mikro export `GET /api/finance/export/mikro?from=&to=` (xlsx). **Assumptions** (to confirm with the accountant): one row per
  invoice; columns Evrak Tipi, Cari Kod, Cari Ünvan, Belge No, Tarih (GG.AA.YYYY), Vade, Tutar (matrah), KDV, Toplam, Döviz, Kur,
  Açıklama; cari kod `120.<customer shortCode>` (alıcılar), `320.<SUPPLIER SLUG≤12>` (satıcılar), `120.K.<supplier>` for commission
  invoices; filter on invoice date (`meta.issueDate`).
- `ProjectDetail.profit.realized` = supplier invoices vs customer invoices (EUR), margin and markup separately.

**Closing (Adım 8)**
- `GET /api/projects/:id/closing-check` (`closingCheck`): every supplier with a signed contract invoiced, customer invoice
  recorded, collections (customer invoices — else receivables — matched/paid), no paid payable without an invoice, commissions
  reconciled. Plan vs actual deviations: unreflected extras, total extras, FX difference (invoice vs contract-time rate), change /
  amendment cost delta, actual − planned cost.
- `POST /api/projects/:id/close` (admin/finance): 409 `CLOSING_BLOCKED` (details = the check) unless ok; lost projects close
  without the finance checklist (lost reason is enforced by the outcome). Won projects: realized prices → `price_history`
  (`realized`, selected offer lines scaled by invoiced/contracted), supplier scores (`supplierScore`; < `lowSupplierScore` →
  `low_supplier_score` card, Düzelt `{status:'passive'}` passivates), lessons → `ai.suggestChecklistQuestions` →
  `checklist_question` cards via `aiGate`, survey token (response adds `surveyUrl: '/survey/<token>'`, `effects`).
- Worker: `event_ended_at` is set the day after `end_date` (step → 7) so the existing 30-day `closing_overdue` alarm fires.

**Reports & admin**
- `GET /api/reports/weekly?weekStart=` (admin): quote time = business minutes `received_at → quote_sent_at` minus the
  project's `customer_wait_minutes` (median, hours; on-target vs each project's target), customer wait hours separately,
  target overrides; correction rate = edited AI-suggestion decisions + edited-then-sent AI drafts, 8-week trend (oldest first);
  won/lost from audit-log outcome transitions + lost reasons; automation events; unreflected field extras (EUR); open
  rule/automation/checklist suggestions; monthly style summary (`ai.summarizeStyle`, cached in `style_summaries`); RFQ overrides.
- `PATCH /api/rules` (admin + human actor only; keys validated against `DEFAULT_RULES`; optional `reason`; versioned + audited),
  `PATCH /api/users/:id` (admin; no self-demotion), `GET /api/users/:id/stats` (admin or self), `GET/POST /api/delegations`,
  `POST /api/delegations/:id/end` (no DELETE), `PATCH /api/checklist/:id` (admin; expires the open suggestion card).

**Additive routes / fields (not in api.ts)**: `POST /api/guests/:id/withdraw-consent`, `GET /api/field-extras/unreflected-totals`,
`POST /api/finance/customer-invoices`, `POST /api/finance/entries/:id/mark-paid`, `POST /api/finance/commissions/:id/reconcile`,
`GET /api/public/consent/:token/withdraw` (HTML confirmation); `POST /api/finance/bank-statements` also accepts JSON `{csv}` and
returns `duplicates`; field extras accept `clientId` (offline idempotency) and return `adminStatus`, `customerApprovedAmountTry`
(+ `approvalLink` on create); field issues accept `supplierId`; close returns `surveyUrl` + `effects`; guests POST accepts an array
or `{guests}`.

**VAT unit**: `@mice/ai` now returns OfferLine `vatRate` as a fraction (0.1). `normalizeLines()` stays as a guard because the
manual offer form and the supplier portal still accept percent values (≤ 100).

**Phase B completion (additive)**
- `POST /api/projects/:id/documents {kind: 'program'|'rooming_list'|'pnl'}` — generators in `services/documents-b.ts` (program per event
  day from items; rooming_list keeps **counts only**, no PII) and the `pnl` generator now adds the realized part (plan vs actual,
  margin and markup separately, supplier contract vs invoice, extras, deviations) once the quote is accepted. Staleness /
  regenerate as for other documents (finance / guest / project changes mark them stale).
- `GET /api/projects/:id/rooming-list.xlsx` — standard rooming list template rendered live; names / e-mail / phone decrypted only
  for `view_guest_pii` roles (`X-PII-Masked: 1` otherwise).
- Project code venue segment: selecting an accommodation (else hall) offer sets `venue_name` (`items.ts` `syncProjectVenue`) →
  `patchProject` regenerates the code with `formatProjectCode`; `PRJ-####` stays, the previous code stays in `audit_log`.
- `compareContract`: an agency-template contract whose billing field was empty picks up billing info added later to the project
  (the supplier's own contract text is never rewritten).
- `requiresBiometric` also covers `quote_approval` and `margin_override` (§15: a customer quote is a money commitment).
- Web: project Overview "Proje bilgileri" (billing info / venue), Finans tab (mark paid, commission reconcile, customer invoice
  no), `/finans` page (bank statement import + transactions + manual match, approved payments, commissions, Mikro export,
  admin unreflected totals), document generator in the side panel, survey link after closing, field panel today / next 7 days,
  mobile tab bar with "Yeni talep".

## §16.5 Rule suggestions and §18.9 evaluation set

- Generator: `services/rule-suggestions.ts` collects learning data (accommodation `price_history` × `channel_prices` on the
  same stay date / room / board / cancellation; `quote_lines.suggested_markup` vs applied `markup` on approved / sent /
  accepted quotes; RFQ `sent_at` → first offer; admin-decided `margin_override` cards; quote `sent_at` → `accepted_at`) and
  runs the pure `suggestRuleChanges()` from `@mice/domain`. Each new suggestion → one `rule_suggestions` row
  (`kind`, `fingerprint`, `scope`, `patch`, `current_value`, `evidence`, `confidence`, `sample_size`, `rationale`,
  `source='generator'`) + one admin-only `rule_suggestion` decision (badge `suggestion`, evidence table in `detail.evidence`).
- Schedule: worker post-job `runWeeklyRuleSuggestions` (`jobs.ts`), at most once per 7 days per tenant (`job_runs` table);
  on demand `POST /api/rules/suggestions/run` (admin). Idempotent: an identical open suggestion is never duplicated, a rejected
  one is not proposed again for 90 days, and a second open suggestion for the same kind + scope waits for the first.
- Effect (`registry.ts` → `applyRuleSuggestionDecision`): refuses auto / non-human execution (`AI_FORBIDDEN_ACTION`), applies
  the patch to the CURRENT rules via `setRule` (rules row audited, `changed_by` = admin, reason = decision id); `set` patches are
  refused with `409 RULE_SUGGESTION_STALE` when the rule changed after the suggestion. Scoped upserts merge into
  `supplierSeasonMarkups` / `supplierRfqHours`. Edits: `{value}` / `{markup}` / `{reminderHours, callTaskHours}`.
  Keys outside `SUGGESTABLE_RULE_KEYS` (authority, automation, AI threshold, legal, money limits) are refused; the DB
  `rules_change_guard` still blocks AI actors.
- New scoped rules (defaults empty → unchanged behaviour): `supplierSeasonMarkups` is used by offer evaluation only when the
  price class is unknown (no channel price / history) instead of the lowest tier; `supplierRfqHours` sets reminder / call-task
  hours for that supplier's new RFQs. Migration `009_rule_suggestions_eval.sql` (additive columns, `job_runs`, standard policies
  + tenant FKs).
- `src/scripts/export-eval-set.ts`: corrected `document_reading` (supplier offers) and `request_extraction` actions → fixtures in
  the `packages/ai/eval` format (`offers.exported.json`, `requests.exported.json`); gold = AI output + human corrections; PII
  pseudonymized. See docs/04 §3.
