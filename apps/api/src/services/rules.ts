// §8 Blok 5: rules are a TABLE per tenant; DEFAULT_RULES only fill missing keys.
import { DEFAULT_RULES, type TenantRules } from '@mice/shared';
import type { Db } from '../db/pool.js';

export async function loadRules(db: Db): Promise<TenantRules> {
  const { rows } = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM rules');
  const out: Record<string, unknown> = { ...DEFAULT_RULES };
  for (const r of rows) if (r.key in DEFAULT_RULES) out[r.key] = r.value;
  return out as unknown as TenantRules;
}

/** Seeds every DEFAULT_RULES key for a tenant (idempotent). */
export async function seedRules(db: Db, tenantId: string): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULT_RULES)) {
    await db.query(
      `INSERT INTO rules (tenant_id, key, value) VALUES ($1, $2, $3::jsonb) ON CONFLICT (tenant_id, key) DO NOTHING`,
      [tenantId, key, JSON.stringify(value)],
    );
  }
}

/** Phase B extension point: admin-only rule change (AI can never call this — §6 rule_change is forbidden). */
export async function setRule(db: Db, key: keyof TenantRules, value: unknown, changedBy: string, reason: string | null): Promise<void> {
  await db.query(
    `INSERT INTO rules (tenant_id, key, value, changed_by, reason) VALUES (app_tenant_id(), $1, $2::jsonb, $3, $4)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, version = rules.version + 1, changed_by = EXCLUDED.changed_by, reason = EXCLUDED.reason`,
    [key, JSON.stringify(value), changedBy, reason],
  );
}
