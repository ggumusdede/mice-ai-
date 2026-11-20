# @mice/api — MICE AI Operations OS backend

Fastify 5 + PostgreSQL 16 (`pg`), zod, JWT, WebAuthn (Face ID step-up), pdfkit, exceljs.
AI is always obtained through `createAiService()` from `@mice/ai` (mock without `ANTHROPIC_API_KEY` or with `AI_PROVIDER=mock`).

## Run

```bash
bash scripts/db-start.sh            # from repo root: local Postgres 16 on :5432 (databases mice, mice_test)
npm run migrate -w apps/api         # apply src/db/migrations/*.sql (tracked in schema_migrations)
npm run seed -w apps/api            # demo tenant "Demo MICE Acenta" (idempotent); add `-- --reset` to drop & recreate
npm run dev -w apps/api             # http://localhost:3001  (GET /api/health)
npm run worker -w apps/api          # follow-up worker (setInterval); `-- --once` for a single pass
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
| `JWT_SECRET`, `JWT_EXPIRES_IN` | dev secret, `12h` | secret required in production |
| `CORS_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | comma separated |
| `PUBLIC_BASE_URL` | `http://localhost:5173` | prefix of supplier (`/s/rfq/<token>`) and quote (`/q/<token>`) links; `''` → relative |
| `GUEST_DATA_KEY` | dev key | pgcrypto key for guest PII (required in production) |
| `ALLOW_DEV_BIOMETRIC` | – | `{biometric:{method:'dev'}}` is accepted only when `NODE_ENV!=='production'` or this is `1` |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGIN` | `localhost`, …, CORS origins | |
| `PUBLIC_RATE_LIMIT` | `60` | requests/min per IP on `/api/public/*` |
| `WORKER_INTERVAL_MS` | `300000` | |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_MODEL`, … | | see `packages/ai/src/factory.ts` |
| `PDF_FONT_PATH`, `PDF_FONT_BOLD_PATH` | DejaVu/Liberation if present | Unicode TTF for Turkish characters |

Change the `mice_app` password in production: `ALTER ROLE mice_app PASSWORD '…'`.

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

Phase B: create new tables in a new migration and call `SELECT apply_standard_policies('table')` (RLS + no-delete + audit + grants).

## Code map

- `src/server.ts` — `buildApp(opts)` (tests inject `email`, `now`, `rng`, `ai`); `src/worker.ts` — `runFollowupsOnce(deps, now)`.
- `src/routes/index.ts` — **route registration index** (add phase B modules here). `core.ts` (staff, steps 0–5),
  `public.ts` (token routes, rate-limited), `reference.ts` (rules/users/customers/checklist/automation/audit read),
  `auth.ts` (login, me, WebAuthn).
- `src/services/*` — business services. Extension points: `registerDecisionEffect(kind, fn)` (`decisions.ts`, wired in
  `registry.ts`), `registerDocumentGenerator(kind, …)` (`documents.ts`), `aiGate()` (`automation.ts`) for every
  suggest-type AI action, `EmailProvider` (`email.ts`, outbox/console implementation — no SMTP).

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
- OfferLine `vatRate` is a fraction (0.1) in the API/domain; percent values (10) coming from `@mice/ai` are normalized.
