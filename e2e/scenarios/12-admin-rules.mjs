// Senaryo 12 — Yönetici kuralları (§8 Blok 5, §9): Kurallar ekranında markup kademeleri düzenlenir (her kademe +5 puan) →
// karşılaştırma ekranındaki "Önerilen markup" yeni değeri gösterir; ürün kararı anahtarları görünür. Kurallar sonunda geri alınır.
import { scenario, step, as, expect, must, openTab, shot, BASE, RUN } from '../lib/harness.mjs';
import { arrangeOffers, createProject } from '../lib/setup.mjs';

let restore = null;
const fmt = (x) => `%${(x * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`;

await scenario('12-rules', async () => {
  const boss = await as('admin@demo.test', 'admin-desktop');
  const before = await must(boss, 'GET', '/rules');
  restore = async () => must(boss, 'PATCH', '/rules', { markupTiers: before.markupTiers, reason: 'e2e: geri al' });
  const p = await arrangeOffers(boss, await createProject(boss, { customer: `Kural Test ${RUN}` }));
  const suggested = async () => (await must(boss, 'GET', `/items/${p.acc}/comparison`)).evaluations.find((e) => e.offerId === p.oA).suggestedMarkup;
  const s0 = await suggested();
  expect(typeof s0 === 'number', `suggested markup available (${s0})`);

  await step('Comparison shows the current suggested markup', async () => {
    await openTab(boss, p.projectId, 'comparison');
    await boss.locator('.kv__row', { hasText: 'Önerilen markup' }).first().waitFor();
    const txt = await boss.locator('.kv__row', { hasText: 'Önerilen markup' }).allInnerTexts();
    console.log(`   before: ${s0} · ${txt[0].replace(/\s+/g, ' ')}`);
  });

  await step('Admin raises every markup tier by 5 points in the Rules UI', async () => {
    await boss.goto(`${BASE}/yonetim/kurallar`);
    await boss.locator('#tier-m-0').waitFor();
    for (let i = 0; i < before.markupTiers.length; i++) {
      const input = boss.locator(`#tier-m-${i}`);
      await input.fill(String(+(before.markupTiers[i].markup * 100 + 5).toFixed(2)));
    }
    for (const label of ['Tedarikçiden müşteri adını gizle', 'Saha rolü finansal verileri görebilir', 'Otomasyon terfisi dış mesajlar için kalıcı onay sayılır']) {
      await boss.locator('label', { hasText: label }).locator('input[type=checkbox]').waitFor();
    }
    await boss.getByText(`${before.markupTiers.length} değişiklik`).or(boss.getByText('1 değişiklik')).first().waitFor();
    await boss.getByRole('button', { name: 'Kaydet' }).click();
    await boss.locator('.toast', { hasText: 'Kurallar kaydedildi' }).waitFor();
    await shot(boss, 'rules-tiers-raised', true);
    const after = await must(boss, 'GET', '/rules');
    expect(after.markupTiers.every((t, i) => Math.abs(t.markup - before.markupTiers[i].markup - 0.05) < 1e-9), 'tiers saved');
  });

  await step('New comparison shows the new suggested markup', async () => {
    const s1 = await suggested();
    expect(Math.abs(s1 - s0 - 0.05) < 1e-6, `suggested markup +5 points (${s0} → ${s1})`);
    await openTab(boss, p.projectId, 'comparison');
    const row = boss.locator('.kv__row', { hasText: 'Önerilen markup' }).first();
    await row.getByText(fmt(s1), { exact: false }).first().waitFor();
    await shot(boss, 'comparison-new-markup', true);
  });
}, { cleanup: async () => restore?.() });
