-- Security review G-17 (residual risk 3): server-side session revocation.
-- Every JWT carries the user's token_version (claim `tv`); withUserCtx() compares it on each request (the user row is
-- already read there, so this is no extra round trip). Bumped on password change, role / authority / signing / active
-- change and by the admin's "log out everywhere" (POST /api/users/:id/revoke-sessions) → all older tokens stop working.
-- Existing table only (no new table → apply_standard_policies / apply_tenant_foreign_keys not needed).
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0 CHECK (token_version >= 0);
