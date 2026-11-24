// Senaryo 8 — Saha kullanıcısı (mobil, §17.7, §18.16): "Bugünkü projeler" → kontrol listesi → hızlı sorun kaydı → limit içi ekstra
// ("Limit içinde") ve limit üstü ekstra ("Limit aşıldı") → çevrimdışı (context.setOffline) ekstra kuyruğa girer → bağlantı gelince
// tam bir kez gönderilir.
import { scenario, step, as, expect, must, shot, BASE, RUN, TODAY, TOMORROW } from '../lib/harness.mjs';
import { signedProject } from '../lib/setup.mjs';

await scenario('08-field', async () => {
  const boss = await as('admin@demo.test', 'admin-api');
  const p = await signedProject(boss, { customer: `Saha Mobil ${RUN}` });
  await must(boss, 'PATCH', `/projects/${p.projectId}`, { startDate: TODAY, endDate: TOMORROW });
  const code = (await must(boss, 'GET', `/projects/${p.projectId}`)).project.code;
  const field = await as('field@demo.test', 'field-mobile', true);
  const extras = async (desc) => (await must(field, 'GET', `/projects/${p.projectId}/field-extras`)).items.filter((x) => x.description === desc);

  await step('Today’s project, checklist', async () => {
    await field.goto(`${BASE}/saha`);
    const today = field.locator('section', { has: field.getByRole('heading', { name: 'Bugünkü projeler' }) });
    await today.locator('.fproj', { hasText: code }).click();
    expect(await today.locator('.fproj', { hasText: code }).getAttribute('aria-pressed') === 'true', 'project selected');
    const cl = field.locator('section[aria-label="Kontrol listesi"]');
    await cl.locator('.checklist__item, p.muted').first().waitFor();
    const open = cl.locator('.checklist__toggle:not([disabled])');
    if (await open.count()) {
      await open.first().click();
      await cl.locator('.checklist__item.is-ok').first().waitFor();
    } else console.log('   (no open tasks assigned to the field user)');
    await shot(field, 'field-today', true);
  });

  await step('Quick issue log', async () => {
    const desc = `Salon klimaları çalışmıyor (${RUN})`;
    await field.locator('#issue-desc').fill(desc);
    await field.getByRole('radio', { name: 'Yüksek' }).click();
    await field.getByRole('button', { name: 'Sorunu kaydet' }).click();
    await field.locator('.toast', { hasText: 'Kaydedildi' }).first().waitFor();
    const issues = (await must(field, 'GET', `/projects/${p.projectId}/field-issues`)).items;
    expect(issues.some((i) => i.description === desc), 'issue stored');
  });

  await step('Extra within the limit vs over the limit', async () => {
    await field.locator('#x-desc').fill(`Su ikramı (${RUN})`);
    await field.locator('#x-amt').fill('400');
    await field.getByText('Limit içinde — kararı siz verirsiniz').waitFor();
    await field.getByRole('button', { name: 'Kaydet ve müşteriye onay linki gönder' }).click();
    await field.locator('.copy-link__url').first().waitFor();
    await field.locator('#x-desc').fill(`Ek ses sistemi (${RUN})`);
    await field.locator('#x-amt').fill('6.500');
    await field.getByText('Limit aşıldı — yönetici / vekil onayı gerekecek').waitFor();
    await shot(field, 'field-extra-over-limit', true);
    await field.getByRole('button', { name: 'Kaydet ve müşteriye onay linki gönder' }).click();
    await field.locator('.list', { hasText: `Ek ses sistemi (${RUN})` }).waitFor();
    const all = (await must(field, 'GET', `/projects/${p.projectId}/field-extras`)).items;
    const small = all.find((x) => x.description === `Su ikramı (${RUN})`);
    const big = all.find((x) => x.description === `Ek ses sistemi (${RUN})`);
    expect(small && big, 'both extras stored');
    expect(big.amountTry === 6500 && small.amountTry === 400, 'amounts stored');
  });

  await step('Offline: extra is queued, synced exactly once when back online', async () => {
    const desc = `Çevrimdışı ekstra (${RUN})`;
    await field.context().setOffline(true);
    await field.locator('.netstate--offline').waitFor();
    await field.locator('#x-desc').fill(desc);
    await field.locator('#x-amt').fill('250');
    await field.getByRole('button', { name: 'Kaydet ve müşteriye onay linki gönder' }).click();
    await field.locator('.toast', { hasText: 'Çevrimdışı kaydedildi' }).waitFor();
    await field.getByText('1 kayıt gönderilmeyi bekliyor').first().waitFor();
    await shot(field, 'field-offline-queued', true);
    await field.context().setOffline(false);
    await field.locator('.netstate--ok').waitFor({ timeout: 20_000 });
    await field.waitForTimeout(1500);
    expect((await extras(desc)).length === 1, 'synced once');
    await field.reload();
    await field.locator('.netstate--ok').waitFor();
    await field.waitForTimeout(1500);
    expect((await extras(desc)).length === 1, `still exactly once after reload (${(await extras(desc)).length})`);
    await shot(field, 'field-synced', true);
  });
});
