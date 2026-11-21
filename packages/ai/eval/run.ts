// CLI: npm run eval -w @mice/ai -- --provider=mock|claude --set=requests|offers|contracts|invoices|all [--target=0.95]
//        [--out=eval/reports] [--as-pdf] [--fixtures=<dir>] [--concurrency=2] [--limit=N]
// claude requires ANTHROPIC_API_KEY (AI_MODEL / AI_MODEL_FAST honoured). Writes <out>/eval-<provider>-<set>.{json,md}.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiService } from '../src/factory.js';
import type { AiService } from '../src/index.js';
import { renderMarkdown, runEval, SETS, type EvalFixture, type EvalReport, type SetName } from './harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURES_DIR = path.join(HERE, 'fixtures');
export const DEFAULT_REPORTS_DIR = path.join(HERE, 'reports');

type RawFixture = Omit<EvalFixture, 'input'> & { input: { text?: string; channel?: string; file?: { filename: string; mimeType: string; base64?: string; text?: string } } };

/** Renders a text document as a simple PDF (pdfkit, hoisted from apps/api). Needs a Unicode TTF for TR/RU glyphs. */
export async function textToPdfBase64(text: string): Promise<string> {
  const mod = (await import('pdfkit' as string)) as { default: new (o?: object) => any };
  const doc = new mod.default({ size: 'A4', margin: 50 });
  const font = process.env.EVAL_PDF_FONT ?? ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf'].find((f) => existsSync(f));
  if (font) doc.font(font);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));
  doc.fontSize(10).text(text);
  doc.end();
  await done;
  return Buffer.concat(chunks).toString('base64');
}

export async function loadFixtures(sets: SetName[], opts: { dir?: string; asPdf?: boolean } = {}): Promise<EvalFixture[]> {
  const dir = opts.dir ?? DEFAULT_FIXTURES_DIR;
  const files = await readdir(dir);
  const out: EvalFixture[] = [];
  for (const set of sets) {
    // <set>.json plus any <set>.*.json (e.g. requests.exported.json from export-eval-set)
    for (const f of files.filter((x) => x === `${set}.json` || (x.startsWith(`${set}.`) && x.endsWith('.json'))).sort()) {
      const raw = JSON.parse(await readFile(path.join(dir, f), 'utf8')) as RawFixture[];
      for (const r of raw) {
        if (r.docType !== SETS[set]) throw new Error(`${f}: ${r.id} docType ${r.docType} ≠ ${SETS[set]}`);
        const input: EvalFixture['input'] = { text: r.input.text, channel: r.input.channel };
        if (r.input.file) {
          input.file = { filename: r.input.file.filename, mimeType: r.input.file.mimeType, base64: r.input.file.base64 ?? Buffer.from(r.input.file.text ?? '', 'utf8').toString('base64') };
        }
        let fx: EvalFixture = { ...r, input };
        if (opts.asPdf && r.docType !== 'request' && input.text) {
          fx = { ...fx, source: 'pdf', input: { file: { filename: `${r.id}.pdf`, mimeType: 'application/pdf', base64: await textToPdfBase64(input.text) } } };
        }
        out.push(fx);
      }
    }
  }
  return out;
}

export function parseArgs(argv: string[]): { provider: 'mock' | 'claude'; sets: SetName[]; target: number; out: string; asPdf: boolean; fixtures?: string; concurrency: number; limit?: number } {
  const a = Object.fromEntries(argv.filter((x) => x.startsWith('--')).map((x) => { const [k, ...v] = x.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
  const provider = (a.provider ?? 'mock') as 'mock' | 'claude';
  if (!['mock', 'claude'].includes(provider)) throw new Error(`--provider=mock|claude (got ${provider})`);
  const setArg = a.set ?? 'all';
  const sets = (setArg === 'all' ? Object.keys(SETS) : setArg.split(',')) as SetName[];
  for (const s of sets) if (!(s in SETS)) throw new Error(`--set: unknown ${s} (requests|offers|contracts|invoices|all)`);
  const target = a.target ? Number(a.target) : 0.95;
  if (!(target > 0 && target < 1)) throw new Error('--target must be in (0,1)');
  return {
    provider, sets, target, out: a.out ? path.resolve(a.out) : DEFAULT_REPORTS_DIR, asPdf: a['as-pdf'] === 'true', fixtures: a.fixtures ? path.resolve(a.fixtures) : undefined,
    concurrency: a.concurrency ? Math.max(1, Number(a.concurrency)) : provider === 'claude' ? 2 : 1, limit: a.limit ? Number(a.limit) : undefined,
  };
}

export function serviceFor(provider: 'mock' | 'claude', env: Record<string, string | undefined> = process.env): AiService {
  if (provider === 'claude' && !env.ANTHROPIC_API_KEY?.trim()) throw new Error('--provider=claude requires ANTHROPIC_API_KEY');
  return createAiService({ ...env, AI_PROVIDER: provider });
}

export async function writeReport(report: EvalReport, outDir: string): Promise<{ json: string; md: string }> {
  await mkdir(outDir, { recursive: true });
  const base = path.join(outDir, `eval-${report.provider}-${report.sets.length === Object.keys(SETS).length ? 'all' : report.sets.join('+')}`);
  await writeFile(`${base}.json`, JSON.stringify(report, null, 2) + '\n');
  await writeFile(`${base}.md`, renderMarkdown(report));
  return { json: `${base}.json`, md: `${base}.md` };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ai = serviceFor(args.provider);
  let fixtures = await loadFixtures(args.sets, { dir: args.fixtures, asPdf: args.asPdf });
  if (args.limit) fixtures = fixtures.slice(0, args.limit);
  const report = await runEval(ai, fixtures, { target: args.target, sets: args.sets, concurrency: args.concurrency });
  const files = await writeReport(report, args.out);
  console.log(`eval ${ai.name}: ${report.documents} docs, ${report.fieldsScored} fields, accuracy ${(report.overall.accuracy * 100).toFixed(1)}%, ECE ${report.overall.ece}`);
  for (const [dt, d] of Object.entries(report.byDocType)) {
    console.log(`  ${dt}: accuracy ${(d.accuracy * 100).toFixed(1)}%, threshold τ=${d.threshold.threshold ?? '—'} (Wilson τ=${d.threshold.thresholdWilson ?? '—'}), coverage ${d.threshold.coverageAtThreshold ?? '—'}`);
  }
  console.log(`→ ${files.md}\n→ ${files.json}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
