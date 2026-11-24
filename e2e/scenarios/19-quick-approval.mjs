// Senaryo 19 — v0.5 S-01 hızlı onay (390 px): hazır şablondan 3 mesaj kartı → karar kutusunda "N mesaj onay bekliyor" toplu kartı →
// "Tek tek bak" yalnız mesajları süzer → birini kart altındaki "Tek dokunuşla gönder" ile, kalanları "Hepsini onayla" ile gönderir →
// her kart ayrı onaylı karar; yatay kaydırma yok. Onaydan önce hiçbir mesaj gitmez.
import { scenario, step, as, expect, must, shot, BASE, RUN } from '../lib/harness.mjs';
import { createProject } from '../lib/setup.mjs';

await scenario('19-quick-approval', async () => {
  const boss = await as('admin@demo.test', 'admin-mobile', true);
  const p = await createProject(boss, { customer: `Hızlı Onay ${RUN}` });
  const ids = [];
  await step('Ready-made templates → cards (nothing sent yet)', async () => {
    for (const note of ['Salı öğlene kadar dönüyoruz.', 'Yarın sabah dönüyoruz.', 'Bugün 17:00’de dönüyoruz.']) {
      const d = await must(boss, 'POST', `/projects/${p.projectId}/quick-messages`, { template: 'request_received', vars: { note }, to: `musteri-${RUN.toLowerCase()}@e2e.example` });
      ids.push(d.id);
    }
    const drafts = (await must(boss, 'GET', `/drafts?projectId=${p.projectId}`)).items.filter((d) => d.kind === 'quick_template');
    expect(drafts.length === 3 && drafts.every((d) => d.status === 'pending_approval'), 'three drafts waiting for approval');
  });
  await step('Batch card + "Tek tek bak"', async () => {
    await boss.goto(`${BASE}/`);
    const batch = boss.locator('.qa-batch');
    await batch.waitFor();
    expect(/\d+ mesaj onay bekliyor/.test(await batch.innerText()), 'batch title');
    await batch.getByRole('button', { name: 'Tek tek bak' }).click();
    await boss.locator('.dcard', { hasText: p.code }).first().waitFor();
    const kinds = await boss.locator('.decision-list .dcard__kind').allInnerTexts();
    expect(kinds.every((k) => /mesaj|RFQ|pazarlık/i.test(k)), `only message cards shown (${kinds.join(', ')})`);
    const sw = await boss.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth);
    expect(sw, 'no horizontal scroll at 390 px');
    await shot(boss, 'batch', true);
  });
  await step('One tap on one card, then "Hepsini onayla"', async () => {
    const first = await must(boss, 'GET', `/decisions/${ids[0]}`);
    await boss.getByRole('button', { name: `Tek dokunuşla gönder: ${first.summary}` }).first().click();
    await boss.locator('.toast', { hasText: 'Onaylandı ve gönderildi' }).first().waitFor();
    expect((await must(boss, 'GET', `/decisions/${ids[0]}`)).status === 'approved', 'first card approved');
    await boss.locator('.qa-batch').getByRole('button', { name: 'Hepsini onayla' }).click();
    await boss.locator('.toast', { hasText: /mesaj/ }).first().waitFor();
    for (const id of ids) expect((await must(boss, 'GET', `/decisions/${id}`)).status === 'approved', `card ${id} approved (own decision)`);
    const drafts = (await must(boss, 'GET', `/drafts?projectId=${p.projectId}`)).items.filter((d) => d.kind === 'quick_template');
    expect(drafts.every((d) => d.status === 'sent'), 'all three sent from the human address');
  });
});
