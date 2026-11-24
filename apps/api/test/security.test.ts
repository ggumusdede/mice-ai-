// §3.8 multi-tenant RLS, §3.6 immutability + audit, §3.5 propagation map — enforced IN THE DATABASE.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOCUMENT_DEPENDENCIES } from '@mice/domain';
import { DECISION_KINDS } from '@mice/shared';
import { appSql, client, closeApp, login, makeApp, newTenant, ownerSql, quotableProject, type TestApp } from './helpers.js';

let T: TestApp;
let A: Awaited<ReturnType<typeof newTenant>>;
let B: Awaited<ReturnType<typeof newTenant>>;
let tokA: string;
let tokB: string;
let projectA: string;

beforeAll(async () => {
  T = await makeApp();
  A = await newTenant('rls-a');
  B = await newTenant('rls-b');
  tokA = await login(T.app, A.users.admin.email);
  tokB = await login(T.app, B.users.admin.email);
  projectA = (await quotableProject(client(T.app, tokA), A)).projectId;
});
afterAll(() => closeApp(T));

describe('RLS catalog', () => {
  it('every tenant table has RLS enabled + forced and a tenant_isolation policy; mice_app is not superuser / bypassrls', async () => {
    const rows = await ownerSql(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
             EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS has_policy
      FROM pg_class c JOIN information_schema.columns col ON col.table_name = c.relname AND col.column_name = 'tenant_id' AND col.table_schema = 'public'
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'`);
    expect(rows.length).toBeGreaterThan(35);
    for (const r of rows) expect([r.relname, r.relrowsecurity, r.relforcerowsecurity, r.has_policy]).toEqual([r.relname, true, true, true]);
    const role = (await ownerSql(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'mice_app'`))[0];
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const del = await ownerSql(`SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE grantee = 'mice_app' AND privilege_type IN ('DELETE','TRUNCATE')`);
    expect(del[0].n).toBe(0);
  });

  it('decision kind CHECK constraint mirrors the shared enum; doc_kinds_for() mirrors DOCUMENT_DEPENDENCIES', async () => {
    const def = (await ownerSql(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'decisions_kind_check'`))[0].d as string;
    for (const k of DECISION_KINDS) expect(def).toContain(`'${k}'`);
    for (const [entity, kinds] of Object.entries(DOCUMENT_DEPENDENCIES)) {
      const r = await ownerSql(`SELECT doc_kinds_for($1) AS k`, [entity]);
      expect([...r[0].k].sort()).toEqual([...kinds].sort());
    }
  });
});

describe('tenant isolation', () => {
  it('tenant B cannot read or modify tenant A rows through the API, even with guessed IDs', async () => {
    const b = client(T.app, tokB);
    expect((await b.get(`/api/projects/${projectA}`)).status).toBe(404);
    expect((await b.patch(`/api/projects/${projectA}`, { pax: 999 })).status).toBe(404);
    expect((await b.post(`/api/projects/${projectA}/outcome`, { outcome: 'lost', lostReason: 'x' })).status).toBe(404);
    const list = await b.get('/api/projects');
    expect(list.body.items.find((p: any) => p.id === projectA)).toBeUndefined();
    const sup = await b.get(`/api/suppliers/${A.suppliers.moda}`);
    expect(sup.status).toBe(404);
    const pa = await ownerSql('SELECT pax FROM projects WHERE id = $1', [projectA]);
    expect(pa[0].pax).toBe(80);
  });

  it('direct SQL as mice_app: other tenant rows are invisible, not updatable, not insertable; no context → nothing', async () => {
    expect(await appSql(B.tenantId, 'SELECT * FROM projects WHERE id = $1', [projectA])).toHaveLength(0);
    expect(await appSql(A.tenantId, 'SELECT id FROM projects WHERE id = $1', [projectA])).toHaveLength(1);
    const upd = await appSql(B.tenantId, `UPDATE projects SET pax = 1 WHERE id = $1 RETURNING id`, [projectA]);
    expect(upd).toHaveLength(0);
    await expect(appSql(B.tenantId, `INSERT INTO customers (tenant_id, name, short_code) VALUES ($1, 'x', 'X')`, [A.tenantId])).rejects.toThrow(/row-level security/);
    expect(await appSql(null, 'SELECT * FROM projects')).toHaveLength(0);
    expect(await appSql(null, 'SELECT * FROM users')).toHaveLength(0);
    expect(await appSql(B.tenantId, 'SELECT * FROM audit_log WHERE tenant_id = $1', [A.tenantId])).toHaveLength(0);
  });
});

describe('immutability & audit', () => {
  it('DELETE is rejected (no privilege for mice_app; trigger for the owner as well)', async () => {
    await expect(appSql(A.tenantId, 'DELETE FROM projects WHERE id = $1', [projectA])).rejects.toThrow(/permission denied/);
    await expect(ownerSql('DELETE FROM projects WHERE id = $1', [projectA])).rejects.toThrow(/silinemez/);
    await expect(ownerSql('DELETE FROM audit_log WHERE tenant_id = $1', [A.tenantId])).rejects.toThrow(/silinemez/);
    await expect(ownerSql(`UPDATE audit_log SET action = 'x' WHERE tenant_id = $1`, [A.tenantId])).rejects.toThrow(/değiştirilemez/);
  });

  it('every change is audited with the actor (who / when / what before → after)', async () => {
    const a = client(T.app, tokA);
    const r = await a.patch(`/api/projects/${projectA}`, { title: 'Yeni başlık' });
    expect(r.status).toBe(200);
    const rows = await ownerSql(`SELECT * FROM audit_log WHERE entity = 'projects' AND entity_id = $1 AND action = 'update' ORDER BY id DESC LIMIT 1`, [projectA]);
    expect(rows[0].actor_type).toBe('user');
    expect(rows[0].actor_id).toBe(A.users.admin.id);
    expect(rows[0].tenant_id).toBe(A.tenantId);
    expect(rows[0].after.title).toBe('Yeni başlık');
    expect(rows[0].before.title).not.toBe('Yeni başlık');
    const tl = await a.get(`/api/projects/${projectA}/timeline`);
    expect(tl.body.items.length).toBeGreaterThan(5);
    // secrets / password hashes never reach the audit log
    const leaked = await ownerSql(`SELECT count(*)::int AS n FROM audit_log WHERE after ? 'password_hash' OR after ? 'token_hash'`);
    expect(leaked[0].n).toBe(0);
  });

  it('supplier offers are never overwritten (new version only)', async () => {
    await expect(ownerSql(`UPDATE supplier_offers SET currency = 'TRY' WHERE project_id = $1`, [projectA])).rejects.toThrow(/değiştirilemez/);
  });

  it('login rejects wrong password; API requires a token', async () => {
    const r = await T.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: A.users.admin.email, password: 'nope' } });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('UNAUTHORIZED');
    expect((await client(T.app).get('/api/projects')).status).toBe(401);
    const me = await client(T.app, tokA).get('/api/auth/me');
    expect(me.body.tenant.id).toBe(A.tenantId);
  });
});
