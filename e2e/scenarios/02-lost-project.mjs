// Senaryo 2 — Kaybedilen proje (§7 Adım 4): "Kaybedildi" alt panelinde gerekçe zorunlu (boşken "Sonuç kaydet" pasif) →
// proje "Kaybedildi"; aktif listelerden (Projeler · Açık filtresi, saha paneli) düşer → haftalık rapor "Kayıp nedenleri"
// gerekçeyi sayar.
import { scenario, step, as, expect, openTab, shot, BASE, RUN, must } from '../lib/harness.mjs';
import { arrangeOffers, createProject, sentQuote } from '../lib/setup.mjs';

const REASON = `Fiyat rakip acentadan yüksek bulundu (${RUN})`;

await scenario('02-lost', async () => {
  const admin = await as('admin@demo.test', 'admin-desktop');
  const p = await arrangeOffers(admin, await createProject(admin, { customer: `Kayıp Holding ${RUN}` }));
  await sentQuote(admin, p);
  const code = (await must(admin, 'GET', `/projects/${p.projectId}`)).project.code;

  await step('Project is in the open list first', async () => {
    await admin.goto(`${BASE}/projeler?outcome=open&q=${encodeURIComponent(code)}`);
    await admin.locator('table a', { hasText: code }).waitFor();
  });

  await step('"Kaybedildi" needs a reason in the bottom sheet', async () => {
    await openTab(admin, p.projectId);
    await admin.locator('.project__head').getByRole('button', { name: 'Kaybedildi' }).click();
    const sheet = admin.getByRole('dialog');
    await sheet.waitFor();
    const save = sheet.getByRole('button', { name: 'Sonuç kaydet' });
    expect(await save.isDisabled(), 'save disabled without a reason');
    await sheet.getByLabel(/Kayıp nedeni/).fill('   ');
    expect(await save.isDisabled(), 'save disabled with a blank reason');
    await sheet.getByLabel(/Kayıp nedeni/).fill(REASON);
    await shot(admin, 'lost-sheet');
    expect(!(await save.isDisabled()), 'save enabled with a reason');
    await save.click();
    await sheet.waitFor({ state: 'detached' });
    await admin.locator('.project__meta').getByText('Kaybedildi').waitFor();
    expect(!(await admin.locator('.project__head').getByRole('button', { name: 'Kaybedildi' }).count()), 'outcome buttons gone');
    const api = await must(admin, 'GET', `/projects/${p.projectId}`);
    expect(api.project.outcome === 'lost' && api.project.lostReason === REASON, `lost + reason stored (${api.project.outcome} / ${api.project.lostReason})`);
    await shot(admin, 'lost-project', true);
  });

  await step('Lost project leaves the active lists', async () => {
    await admin.goto(`${BASE}/projeler?outcome=open&q=${encodeURIComponent(code)}`);
    await admin.getByText('Kriterlere uyan proje yok.').waitFor();
    await admin.goto(`${BASE}/projeler?outcome=lost&q=${encodeURIComponent(code)}`);
    await admin.locator('table a', { hasText: code }).waitFor();
    const open = (await must(admin, 'GET', '/projects?outcome=open')).items.map((x) => x.id);
    expect(!open.includes(p.projectId), 'not in GET /projects?outcome=open');
    const field = await as('field@demo.test', 'field', true);
    await field.goto(`${BASE}/saha`);
    await field.waitForLoadState('networkidle');
    expect(!(await field.getByText(code).count()), 'not on the field panel');
    await field.context().close();
  });

  await step('Weekly report counts the lost reason', async () => {
    await admin.goto(`${BASE}/rapor`);
    const row = admin.locator('.bars__row', { hasText: REASON });
    await row.waitFor();
    expect((await row.locator('.bars__val').innerText()).trim() === '1', 'reason counted once');
    const r = await must(admin, 'GET', '/reports/weekly');
    expect(r.quotes.lost >= 1 && r.quotes.lostReasons.some((x) => x.reason === REASON && x.count === 1), 'report API lists the reason');
    await shot(admin, 'weekly-report-lost', true);
  });
});
