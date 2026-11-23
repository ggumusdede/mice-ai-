// Senaryo 20 — v0.5 K-05 devir-teslim: yönetici /yonetim/devir'de planlı devri (şimdi) başlatır → ayrılanın erişimi kapanır
// (oturum 401) → devralan "Benim panom"da "Size devredilen işler" → paketi açar, her projeyi "Okudum" der → %100, tamamlandı.
// Ayrılan kişi geçici bir demo kullanıcısıdır (psql ile oluşturulur; psql yoksa SKIP).
import { scenario, step, as, expect, must, shot, sql, skip, BASE, RUN, login, newPage } from '../lib/harness.mjs';
import { createProject } from '../lib/setup.mjs';

await scenario('20-handover', async () => {
  const email = `ayrilan-${RUN.toLowerCase()}@demo.test`;
  const name = `Ayrılan Satışçı ${RUN}`;
  const made = await sql(`INSERT INTO users (tenant_id, email, password_hash, full_name, role)
    SELECT tenant_id, '${email}', password_hash, '${name}', 'clerk_sales' FROM users WHERE email = 'clerk@demo.test' RETURNING id`);
  if (made === null) skip('psql yok');
  const leaver = made.split('\n')[0];
  const boss = await as('admin@demo.test', 'admin');
  const p = await createProject(boss, { customer: `Devir ${RUN}` });
  await sql(`UPDATE projects SET owner_id = '${leaver}' WHERE id = '${p.projectId}'`);
  const leaverPage = await newPage('leaver');
  await login(leaverPage, email);
  const opsId = (await must(boss, 'GET', '/users')).items.find((u) => u.email === 'ops@demo.test').id;

  await step('Admin starts the handover', async () => {
    await boss.goto(`${BASE}/yonetim/devir`);
    await boss.getByLabel('Ayrılan / devreden').selectOption(leaver);
    await boss.getByLabel('Devralan').selectOption(opsId);
    await boss.getByLabel('Gerekçe').fill('İşten ayrılış');
    await boss.getByRole('button', { name: 'Devri planla' }).click();
    await boss.locator('.simple-item', { hasText: name }).getByText('Erişim kapandı').waitFor();
    await shot(boss, 'admin', true);
    const r = await leaverPage.evaluate(async () => (await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${localStorage.getItem('mice.token')}` } })).status);
    expect(r === 401, `leaver session revoked (${r})`);
    expect((await must(boss, 'GET', `/projects/${p.projectId}`)).project.ownerId === opsId, 'project moved to the recipient');
  });
  await step('Recipient reads the package', async () => {
    const ops = await as('ops@demo.test', 'ops-mobile', true);
    await ops.goto(`${BASE}/benim`);
    const card = ops.locator('.simple-item', { hasText: name });
    await card.getByRole('link', { name: 'Paketi aç' }).click();
    const row = ops.locator('.simple-item', { hasText: p.code });
    await row.getByRole('button', { name: 'Okudum' }).click();
    await row.getByText('Okundu').waitFor();
    const h = (await must(ops, 'GET', '/handovers')).items.find((x) => x.fromUserId === leaver);
    expect(h.readPct === 100 && h.status === 'completed', `handover completed (${h.readPct} ${h.status})`);
    await shot(ops, 'recipient', true);
  });
});
