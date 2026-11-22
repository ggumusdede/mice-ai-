// End-to-end UI scenario for the initial historical data import (PRD §8 "İlk veri yükü … elle doğrulanarak yüklenir"),
// against an already running api (:3001, AI_PROVIDER=mock) + web (:5173) on the seeded demo database.
//
//   node e2e/import.mjs                 # BASE_URL=http://localhost:5173 SHOTS=./e2e/shots HEADED=1 optional
//
// Admin → Yönetim → Veri aktarımı: template download (XLSX) → new batch → uploads the sample files from e2e/fixtures/
// (dates relative to today, names / VKN / prices unique per run so the script can be rerun on the same database) →
// verification table (error rows: project older than the 18-month window) → inline edit (accredit a supplier) →
// bulk approve ok + warning rows → commit → UI effects: the historical projects are NOT in Projeler, the imported
// project page opens, the imported suppliers appear in Yönetim → Tedarikçiler (one accredited via the decision box),
// and the know-how / price history read the import (similar projects, comparison sample size) — checked through the API.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const SHOTS = resolve(process.env.SHOTS ?? new URL('./shots', import.meta.url).pathname);
const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
const PASSWORD = 'demo1234';
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const RUN_N = parseInt(RUN, 36);

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const dmy = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const vkn = (k) => String(1_000_000_000 + ((RUN_N * 7 + k * 104_729) % 8_999_999_999)).slice(0, 10);
const trNum = (n) => n.toFixed(2).replace('.', ',');

/** e2e/fixtures/import-<entity>.csv with {{RUN}}, {{run}}, {{VKNn}}, {{PRICE}}, {{PRICE2}}, {{D:±days}} filled in. */
function fixture(entity) {
  const text = readFileSync(join(FIXTURES, `import-${entity}.csv`), 'utf8')
    .replaceAll('{{RUN}}', RUN).replaceAll('{{run}}', RUN.toLowerCase())
    .replace(/\{\{VKN(\d)\}\}/g, (_, k) => vkn(Number(k)))
    .replaceAll('{{PRICE}}', trNum(120 + (RUN_N % 50)))
    .replaceAll('{{PRICE2}}', trNum(80 + (RUN_N % 15) + 0.5))
    .replace(/\{\{D:([+-]\d+)\}\}/g, (_, d) => dmy(ymd(new Date(Date.now() + Number(d) * 86_400_000))));
  const path = join(tmpdir(), `mice-import-${RUN}-${entity}.csv`);
  writeFileSync(path, text);
  return path;
}

// ---------------------------------------------------------------- harness (same conventions as steps0-5.mjs / steps6-8.mjs)
const problems = [];
let currentStep = 'setup';

function watch(page, label) {
  page.on('pageerror', (e) => problems.push(`[${currentStep}] ${label} pageerror: ${e.message}`));
  page.on('response', async (r) => {
    const url = r.url();
    if (!url.includes('/api/') || r.status() < 400) return;
    const body = (await r.text().catch(() => '')).slice(0, 300);
    const line = `[${currentStep}] ${label} ${r.request().method()} ${url.replace(BASE, '')} → ${r.status()} ${body}`;
    if (r.status() >= 500 || r.status() === 404) problems.push(line);
    else console.log('   (4xx) ' + line);
  });
}

async function newPage(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  watch(page, label);
  return page;
}

async function login(page, email) {
  await page.goto(`${BASE}/giris`);
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Şifre').fill(PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/giris'));
}

async function shot(page, name, fullPage = false) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
}

async function step(name, fn) {
  currentStep = name;
  const t0 = Date.now();
  console.log(`\n▶ ${name}`);
  await fn();
  console.log(`✔ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

function expect(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function must(page, method, path, body) {
  const r = await page.evaluate(async ({ method, path, body }) => {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('mice.token')}` };
    const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  }, { method, path, body });
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}

// ---------------------------------------------------------------- scenario
const browser = await chromium.launch({ headless: !process.env.HEADED });
const admin = await newPage(browser, 'admin');
const LABEL = `E2E ilk yük ${RUN}`;
let batchId = null;
let sampleBefore = null;
let hallItemId = null;
let liveProjectId = null;

try {
  await step('Login + Yönetim → Veri aktarımı, template download', async () => {
    await login(admin, 'admin@demo.test');
    // comparison sample size of a seeded hall offer before the import (price-history median basis)
    const projects = (await must(admin, 'GET', '/projects')).items;
    for (const p of projects) {
      const d = await must(admin, 'GET', `/projects/${p.id}`);
      const hall = d.items.find((i) => i.kind === 'hall' && i.offers.length);
      if (hall && d.project.city) {
        hallItemId = hall.id;
        liveProjectId = p.id;
        sampleBefore = (await must(admin, 'GET', `/items/${hall.id}/comparison`)).evaluations[0]?.benchmark.sampleSize ?? 0;
        break;
      }
    }
    await admin.goto(`${BASE}/yonetim/veri-aktarimi`);
    await admin.getByRole('link', { name: 'Veri aktarımı' }).waitFor();
    await admin.getByText('İlk veri yükü (PRD §8)').waitFor();
    const row = admin.locator('tr', { hasText: 'Kapanmış projeler' });
    const [dl] = await Promise.all([admin.waitForEvent('download'), row.getByRole('button', { name: 'XLSX' }).click()]);
    expect(dl.suggestedFilename() === 'sablon-projects.xlsx', `template file name (${dl.suggestedFilename()})`);
    await shot(admin, 'import-templates');
  });

  await step('New batch + upload the six sample files', async () => {
    await admin.getByLabel('Yeni aktarım adı').fill(LABEL);
    await admin.getByRole('button', { name: 'Yeni aktarım' }).click();
    await admin.getByText(`Aktarım: ${LABEL}`).waitFor();
    for (const [entity, label] of [['suppliers', 'Tedarikçiler'], ['customers', 'Müşteriler'], ['projects', 'Kapanmış projeler'],
      ['service_lines', 'Proje hizmet kalemleri'], ['price_points', 'Tedarikçi fiyat geçmişi'], ['channel_prices', 'Kanal (OTA) fiyatları']]) {
      await admin.getByLabel('Dosya türü').selectOption(entity);
      const done = admin.waitForResponse((r) => r.url().includes('/files') && r.request().method() === 'POST');
      await admin.getByLabel('Dosya yükle').setInputFiles(fixture(entity));
      const res = await done;
      expect(res.status() === 200, `${entity} upload → ${res.status()}`);
      await admin.getByText(`${label} yüklendi ve doğrulandı`).first().waitFor();
    }
    const list = (await must(admin, 'GET', '/import/batches')).items;
    batchId = list.find((b) => b.label === LABEL)?.id;
    expect(batchId, 'batch listed');
  });

  await step('Verification table: error group (out of 18-month window), nothing live yet', async () => {
    const table = admin.getByRole('table', { name: 'Doğrulama tablosu' });
    await table.locator('.import-group', { hasText: 'Hata' }).waitFor();
    await table.locator('.import-row--error', { hasText: `E2E-${RUN}-3` }).getByText('aktarım penceresinin dışında').waitFor();
    await table.locator('.import-row--warning', { hasText: 'Moda Sahil Otel' }).first().waitFor(); // existing supplier → link
    const commit = admin.getByRole('button', { name: /Onaylı satırları aktar/ });
    expect(await commit.isDisabled(), 'commit disabled before approval');
    const live = (await must(admin, 'GET', '/projects?historical=only')).items.filter((p) => p.code.includes(RUN));
    expect(live.length === 0, 'no historical project before commit');
    await shot(admin, 'import-verification', true);
  });

  await step('Inline edit: admin accredits a supplier in review', async () => {
    const table = admin.getByRole('table', { name: 'Doğrulama tablosu' });
    const row = table.locator('tr.import-row', { hasText: `Beykoz Koru ${RUN}` });
    await row.getByRole('button', { name: /düzenle/ }).click();
    const editor = table.locator('tr.import-edit');
    await editor.getByText('Akredite et (yönetici kararı').click();
    await editor.getByRole('button', { name: 'Kaydet ve doğrula' }).click();
    await admin.getByText('Satır güncellendi ve yeniden doğrulandı').first().waitFor();
    await table.locator('tr.import-row', { hasText: `Beykoz Koru ${RUN}` }).getByText('karar kutusu üzerinden').waitFor();
    await shot(admin, 'import-row-edit');
  });

  await step('Bulk approve ok + warning rows, commit', async () => {
    await admin.getByRole('button', { name: 'Hatasızları onayla' }).click();
    await admin.waitForResponse((r) => r.url().includes('/review'));
    await admin.getByRole('button', { name: 'Uyarılıları onayla' }).click();
    await admin.waitForResponse((r) => r.url().includes('/review'));
    const commit = admin.getByRole('button', { name: /Onaylı satırları aktar/ });
    await admin.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('Onaylı satırları aktar'));
      return b && !b.disabled;
    });
    await commit.click();
    await admin.getByText('Aktarım işlendi').waitFor();
    await shot(admin, 'import-committed', true);
    const d = await must(admin, 'GET', `/import/batches/${batchId}`);
    expect(d.batch.status === 'committed', 'batch committed');
    expect(d.batch.summary.committed.projects.created === 2, `2 projects created (${JSON.stringify(d.batch.summary.committed)})`);
    expect(d.rows.filter((r) => r.status === 'error').every((r) => !r.committedEntityId), 'error rows not committed');
  });

  await step('UI effect: historical projects not in Projeler; project page opens; suppliers listed', async () => {
    await admin.goto(`${BASE}/projeler`);
    await admin.locator('main').waitFor();
    await admin.waitForTimeout(800);
    expect(!(await admin.getByText(`H-E2E-${RUN}-1`).count()), 'historical project hidden from the active list');
    const hist = (await must(admin, 'GET', '/projects?historical=only')).items.filter((p) => p.code.includes(RUN));
    expect(hist.length === 2 && hist.every((p) => p.historical), 'two historical projects');
    const won = hist.find((p) => p.code === `H-E2E-${RUN}-1`);
    expect(won.outcome === 'closed' && won.closedAt, 'won → closed with closed_at');
    await admin.goto(`${BASE}/projeler/${won.id}`);
    await admin.getByText(`H-E2E-${RUN}-1`).first().waitFor();
    await shot(admin, 'import-historical-project');
    await admin.goto(`${BASE}/yonetim/tedarikciler`);
    await admin.getByText(`Kuzguncuk Konak ${RUN}`).first().waitFor();
    await admin.getByText(`Beykoz Koru ${RUN}`).first().waitFor();
    const sup = (await must(admin, 'GET', '/suppliers')).items;
    expect(sup.find((s) => s.name === `Beykoz Koru ${RUN}`)?.status === 'accredited', 'Beykoz accredited (decision box)');
    expect(sup.find((s) => s.name === `Kuzguncuk Konak ${RUN}`)?.status === 'candidate', 'Kuzguncuk stays candidate');
    expect(sup.filter((s) => s.name === 'Moda Sahil Otel').length === 1, 'existing supplier linked, not duplicated');
    await shot(admin, 'import-suppliers');
  });

  await step('Know-how + price history read the import', async () => {
    const d = await must(admin, 'GET', `/projects/${liveProjectId}`);
    if (d.project.customerName?.includes('Marmara')) {
      const sim = (await must(admin, 'GET', `/projects/${liveProjectId}/similar`)).items;
      expect(sim.some((s) => s.code === `H-E2E-${RUN}-1` && s.totalSaleEur > 0), 'similar projects include the imported project with its sale total');
    }
    if (hallItemId) {
      const after = (await must(admin, 'GET', `/items/${hallItemId}/comparison`)).evaluations[0]?.benchmark.sampleSize ?? 0;
      expect(after > sampleBefore, `comparison history grew (${sampleBefore} → ${after})`);
    }
    const inbox = (await must(admin, 'GET', '/decisions')).items;
    expect(!inbox.some((x) => (x.projectCode ?? '').includes(`E2E-${RUN}`)), 'no inbox card for historical projects');
  });
} catch (e) {
  problems.push(`[${currentStep}] FAILED: ${e.message.split('\n').slice(0, 4).join(' | ')}`);
  await admin.screenshot({ path: `${SHOTS}/FAILED-import.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

console.log(`\nScreenshots: ${SHOTS}`);
if (problems.length) {
  console.log(`\nPROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('\nALL STEPS PASSED');
