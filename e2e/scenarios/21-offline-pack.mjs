// Senaryo 21 — v0.5 S-15 çevrimdışı saha paketi (390 px): saha kullanıcısı "Çevrimdışı için indir" → cihazda yalnız şifreli metin
// (ad localStorage'da düz yazı değil) → çevrimdışıyken kişi listesi açılır ve aranır (ad, oda, grup, telefon) → yönetici paketi iptal
// eder → cihaz çevrimiçi olunca paket silinir.
import { scenario, step, as, expect, must, shot, BASE, RUN, TODAY, TOMORROW } from '../lib/harness.mjs';
import { signedProject } from '../lib/setup.mjs';

await scenario('21-offline-pack', async () => {
  const boss = await as('admin@demo.test', 'admin-api');
  const p = await signedProject(boss, { customer: `Saha Paketi ${RUN}` });
  await must(boss, 'PATCH', `/projects/${p.projectId}`, { startDate: TODAY, endDate: TOMORROW });
  const guest = `Paket Misafir ${RUN}`;
  const g = (await must(boss, 'POST', `/projects/${p.projectId}/guests`, [{ fullName: guest, phone: '+905321234567', roomType: 'DBL' }])).items[0];
  await must(boss, 'PATCH', `/guests/${g.id}/field-info`, { roomNo: '204', transferGroup: 'Otobüs 1' });
  const field = await as('field@demo.test', 'field-mobile', true);

  await step('Download the pack (encrypted on the device)', async () => {
    await field.goto(`${BASE}/saha`);
    await field.getByRole('button', { name: 'Çevrimdışı için indir' }).click();
    await field.getByText('Paket bu cihaza şifreli kaydedildi').waitFor();
    const stored = await field.evaluate(() => localStorage.getItem('mice.fieldPack') ?? '');
    expect(stored.length > 50 && !stored.includes('Paket Misafir') && !stored.includes('905321234567'), 'only ciphertext in storage');
  });
  await step('Offline: list opens and searches', async () => {
    await field.context().setOffline(true);
    await field.getByRole('button', { name: 'Kişi listesini aç' }).click();
    await field.getByLabel('Pakette ara').fill('204');
    const list = field.getByRole('list', { name: 'Paket kişileri' });
    await list.getByText(guest).waitFor();
    expect(await list.getByText('Oda 204').count() > 0, 'room shown');
    const sw = await field.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth);
    expect(sw, 'no horizontal scroll at 390 px');
    await shot(field, 'offline', true);
    await field.context().setOffline(false);
  });
  await step('Remote revoke wipes the pack', async () => {
    const packs = (await must(boss, 'GET', '/field/packs')).items.filter((x) => !x.revokedAt);
    for (const pk of packs) await must(boss, 'POST', `/field/packs/${pk.id}/revoke`, { reason: 'e2e: telefon kayboldu' });
    await field.reload();
    await field.getByText('Paket yönetici tarafından iptal edildi').waitFor();
    expect(!(await field.evaluate(() => localStorage.getItem('mice.fieldPack'))), 'pack removed from the device');
    expect(await field.getByRole('button', { name: 'Çevrimdışı için indir' }).isVisible(), 'download offered again');
  });
});
