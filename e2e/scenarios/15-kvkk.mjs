// Senaryo 15 — KVKK (§17.9): rooming formunda biri rızalı, biri rızasız iki misafir → rızalı misafire giden kişisel geri çekme
// linki (/api/public/consent/<token>/withdraw, HTML form) ile rıza geri alınır → ops ekranında "Rıza geri çekildi"; satış
// rolü isimleri maskeli görür.
// Link yalnız misafire e-postayla gider (outbox kopyasında maskeli). Geliştirme API'si e-postayı konsola yazar: API_LOG=<api stdout
// dosyası> verilirse link oradan okunur ve tarayıcıda açılır; verilmezse ekip tarafı geri çekme (POST /api/guests/:id/withdraw-consent)
// kullanılır ve not düşülür.
import { existsSync, readFileSync } from 'node:fs';
import { scenario, step, as, newPage, expect, must, openTab, shot, BASE, RUN, notes } from '../lib/harness.mjs';
import { signedProject } from '../lib/setup.mjs';

const EMAIL = `kvkk-${RUN.toLowerCase()}@misafir.example`;

await scenario('15-kvkk', async () => {
  const boss = await as('admin@demo.test', 'admin-api');
  const p = await signedProject(boss, { customer: `KVKK Test ${RUN}` });
  const link = (await must(boss, 'POST', `/projects/${p.projectId}/rooming-link`)).url;

  await step('Rooming form: guest 1 with consent, guest 2 without', async () => {
    const g = await newPage('guest', true);
    await g.goto(link);
    await g.locator('#g-name-0').waitFor();
    expect(!(await g.locator('#g-consent-0').isChecked()), 'consent unticked by default');
    await g.locator('#g-name-0').fill(`Rızalı Misafir ${RUN}`);
    await g.locator('#g-email-0').fill(EMAIL);
    await g.locator('#g-consent-0').check();
    await g.getByRole('button', { name: 'Misafir ekle' }).click();
    await g.locator('#g-name-1').fill(`Rızasız Misafir ${RUN}`);
    await g.locator('#g-email-1').fill(`rizasiz-${RUN.toLowerCase()}@misafir.example`);
    expect(!(await g.locator('#g-consent-1').isChecked()), 'second guest unticked');
    await g.getByRole('button', { name: 'Listeyi gönder' }).click();
    await g.getByText('2 misafir kaydedildi').waitFor();
    await g.context().close();
  });

  await step('Consent withdrawal link → "İznimi geri al"', async () => {
    const guests = (await must(boss, 'GET', `/projects/${p.projectId}/guests`)).items;
    const g1 = guests.find((x) => x.fullName === `Rızalı Misafir ${RUN}`);
    expect(g1?.consentReuse === true && !g1.consentWithdrawnAt, 'guest 1 consented');
    const log = process.env.API_LOG;
    let url = null;
    if (log && existsSync(log)) {
      for (let i = 0; i < 20 && !url; i++) {
        const text = readFileSync(log, 'utf8');
        const at = text.lastIndexOf(`→ ${EMAIL}`);
        if (at >= 0) url = /(https?:\/\/\S+\/api\/public\/consent\/[\w-]+\/withdraw)/.exec(text.slice(at))?.[1] ?? null;
        if (!url) await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (url) {
      const page = await newPage('guest-withdraw', true);
      await page.goto(url.replace(/^https?:\/\/[^/]+/, BASE));
      await page.getByText('İzninizi geri almak', { exact: false }).or(page.getByText('izni geri almak', { exact: false })).first().waitFor();
      await page.getByRole('button', { name: 'İznimi geri al' }).click();
      await page.getByText('İzniniz geri alındı').waitFor();
      await shot(page, 'withdrawn-page');
      await page.context().close();
    } else {
      notes.push('API_LOG not set / link not found — withdrew via the staff endpoint instead of the e-mailed link');
      await must(boss, 'POST', `/guests/${g1.id}/withdraw-consent`);
    }
    const after = (await must(boss, 'GET', `/projects/${p.projectId}/guests`)).items.find((x) => x.id === g1.id);
    expect(after.consentWithdrawnAt && !after.consentReuse, 'consent withdrawn');
  });

  await step('Ops sees "Rıza geri çekildi"; sales sees masked names', async () => {
    const ops = await as('ops@demo.test', 'ops');
    await openTab(ops, p.projectId, 'operations');
    const card = ops.locator('.card', { hasText: 'Misafirler / rooming' }).first();
    await card.locator('tr', { hasText: `Rızalı Misafir ${RUN}` }).getByText('Rıza geri çekildi').waitFor();
    await card.locator('tr', { hasText: `Rızasız Misafir ${RUN}` }).getByText('Rıza yok').waitFor();
    await card.getByText('Rıza verdi: 0').waitFor();
    await shot(ops, 'ops-guests-withdrawn', true);
    const clerk = await as('clerk@demo.test', 'clerk');
    await openTab(clerk, p.projectId, 'operations');
    const cg = clerk.locator('.card', { hasText: 'Misafirler / rooming' }).first();
    await cg.getByText(/\*\*\*/).first().waitFor();
    const txt = await cg.innerText();
    expect(!txt.includes(`Rızalı Misafir ${RUN}`) && !txt.includes(EMAIL), 'masked for sales');
    await shot(clerk, 'clerk-guests-masked', true);
  });
});
