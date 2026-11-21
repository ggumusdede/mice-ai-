// §18.9 / docs/04 §3 "Sürekli büyüme": export a tenant's REAL human corrections as labelled eval fixtures
// (same format as packages/ai/eval/fixtures/*.json). Gold = the AI reading with the human's corrections applied.
// PII is pseudonymized (e-mail, phone, IBAN, national id, known person names — users, supplier contacts, customer contacts);
// corporate names and prices are kept (docs/04 §3 KVKK). Output stays in the agency's own environment.
//
//   npm run export-eval-set -w @mice/api -- --tenant=<tenant uuid> [--out=../../packages/ai/eval/fixtures] [--since=2026-01-01] [--limit=500]
//
// Writes <out>/offers.exported.json and <out>/requests.exported.json (the eval runner picks up <set>.*.json automatically).
// Contract / invoice corrections are counted but not exported: their source text is not stored (files are not kept).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pseudonymizer } from '@mice/ai';
import { loadConfig } from '../config.js';
import { closePool, initPool, withTenant, type Db } from '../db/pool.js';

export interface ExportRow {
  id: string;
  action_type: string;
  created_at: Date | string;
  input_summary: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  correction: Record<string, unknown> | null;
  source_text: string | null;
  source_channel: string | null;
}

export interface ExportedFixture {
  id: string; docType: 'offer' | 'request'; language: 'tr' | 'en' | 'ru'; source: 'text'; today: string;
  input: { text: string; channel?: string }; gold: Record<string, unknown>; tags: string[]; origin: string;
}

const OFFER_GOLD_KEYS = ['supplierName', 'currency', 'optionUntil', 'guaranteePax', 'prepaymentRate', 'lines'];
const REQUEST_GOLD_KEYS = ['customerName', 'startDate', 'endDate', 'decisionDate', 'pax', 'roomsSgl', 'roomsDbl', 'city', 'district', 'budget', 'budgetCurrency', 'language'];

function guessLanguage(text: string): 'tr' | 'en' | 'ru' {
  if (/[а-яё]/i.test(text)) return 'ru';
  if (/[çğıöşüİ]/i.test(text) || /\b(ve|için|kişi|teklif|merhaba)\b/i.test(text)) return 'tr';
  return 'en';
}

function maskDeep(v: unknown, p: Pseudonymizer): unknown {
  if (typeof v === 'string') return p.mask(v);
  if (Array.isArray(v)) return v.map((x) => maskDeep(x, p));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x, p)]));
  return v;
}

/** Pure: corrected AI actions → eval fixtures (+ counts of what could not be exported). */
export function buildEvalFixtures(rows: ExportRow[], knownNames: string[]): { fixtures: ExportedFixture[]; skipped: Record<string, number> } {
  const fixtures: ExportedFixture[] = [];
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  for (const r of rows) {
    const kind = (r.input_summary?.kind as string | undefined) ?? (r.action_type === 'request_extraction' ? 'request' : 'unknown');
    if (!r.source_text?.trim()) { skip(`no_source_text:${kind}`); continue; }
    const p = new Pseudonymizer(knownNames);
    const today = (r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)).slice(0, 10);
    const corr = r.correction ?? {};
    if (r.action_type === 'document_reading' && kind === 'supplier_offer') {
      const changes = (corr.changes ?? {}) as Record<string, { after?: unknown }>;
      const out = r.output ?? {};
      const gold: Record<string, unknown> = {};
      for (const k of OFFER_GOLD_KEYS) {
        const v = k in changes ? changes[k].after : out[k];
        if (v !== undefined) gold[k] = v ?? null;
      }
      if (Array.isArray(gold.lines)) {
        gold.lines = (gold.lines as Record<string, unknown>[]).map((l) => Object.fromEntries(
          ['kind', 'unitPrice', 'quantity', 'nights', 'roomType', 'board', 'vatIncluded'].filter((f) => l[f] !== undefined && l[f] !== null).map((f) => [f, l[f]])));
      }
      fixtures.push({
        id: `exp-off-${r.id.slice(0, 8)}`, docType: 'offer', language: guessLanguage(r.source_text), source: 'text', today,
        input: { text: p.mask(r.source_text) }, gold: maskDeep(gold, p) as Record<string, unknown>,
        tags: ['exported', 'human_corrected', ...Object.keys(changes).map((k) => `corrected:${k}`)], origin: `ai_actions:${r.id}`,
      });
    } else if (r.action_type === 'request_extraction') {
      const out = r.output ?? {};
      const edits = ((corr.edits ?? corr.changes ?? {}) as Record<string, unknown>);
      const gold: Record<string, unknown> = {};
      for (const k of REQUEST_GOLD_KEYS) {
        const raw = k in edits ? edits[k] : out[k];
        const v = raw && typeof raw === 'object' && !Array.isArray(raw) && 'after' in (raw as object) ? (raw as { after: unknown }).after
          : raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in (raw as object) ? (raw as { value: unknown }).value : raw;
        if (v !== undefined) gold[k] = v ?? null;
      }
      fixtures.push({
        id: `exp-req-${r.id.slice(0, 8)}`, docType: 'request', language: (gold.language as 'tr' | 'en' | 'ru') ?? guessLanguage(r.source_text), source: 'text', today,
        input: { text: p.mask(r.source_text), channel: r.source_channel ?? 'email' }, gold: maskDeep(gold, p) as Record<string, unknown>,
        tags: ['exported', 'human_corrected'], origin: `ai_actions:${r.id}`,
      });
    } else {
      skip(`unsupported:${kind}`);
    }
  }
  return { fixtures, skipped };
}

/** Corrected readings with their source text + the person names to pseudonymize (tenant-scoped by RLS). */
export async function fetchExportRows(db: Db, since: string, limit: number): Promise<{ rows: ExportRow[]; names: string[] }> {
  const rows = (await db.query<ExportRow>(
    `SELECT a.id, a.action_type, a.created_at, a.input_summary, a.output, a.correction,
            COALESCE(o.raw_text, im.body) AS source_text, im.channel AS source_channel
       FROM ai_actions a
       LEFT JOIN LATERAL (SELECT raw_text FROM supplier_offers so WHERE so.ai_action_id = a.id ORDER BY so.version LIMIT 1) o ON true
       LEFT JOIN inbound_messages im ON a.action_type = 'request_extraction' AND a.entity_type = 'inbound_message' AND im.id = a.entity_id
      WHERE a.corrected AND a.action_type IN ('document_reading','request_extraction') AND a.created_at >= $1::date
      ORDER BY a.created_at LIMIT $2`, [since, limit])).rows;
  const names = (await db.query<{ n: string }>(
    `SELECT full_name AS n FROM users UNION SELECT contact_name FROM suppliers WHERE contact_name IS NOT NULL
      UNION SELECT c->>'name' FROM customers, jsonb_array_elements(COALESCE(contacts, '[]'::jsonb)) c WHERE c->>'name' IS NOT NULL`)).rows.map((r) => r.n);
  return { rows, names };
}

async function main(): Promise<void> {
  const args = Object.fromEntries(process.argv.slice(2).filter((x) => x.startsWith('--')).map((x) => { const [k, ...v] = x.slice(2).split('='); return [k, v.join('=') || 'true']; }));
  const tenantId = args.tenant;
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error('--tenant=<tenant uuid> required');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.resolve(args.out ?? path.join(here, '../../../../packages/ai/eval/fixtures'));
  const since = args.since ?? '2000-01-01';
  const limit = Math.min(5000, Number(args.limit ?? 500));
  initPool(loadConfig().databaseUrl);
  try {
    const { rows, names } = await withTenant(tenantId, { type: 'system', id: null }, (db) => fetchExportRows(db, since, limit));
    const { fixtures, skipped } = buildEvalFixtures(rows, names);
    await mkdir(out, { recursive: true });
    for (const [set, dt] of [['offers', 'offer'], ['requests', 'request']] as const) {
      const xs = fixtures.filter((f) => f.docType === dt);
      if (!xs.length) continue;
      await writeFile(path.join(out, `${set}.exported.json`), JSON.stringify(xs, null, 1) + '\n');
    }
    console.log(JSON.stringify({ exported: fixtures.length, offers: fixtures.filter((f) => f.docType === 'offer').length, requests: fixtures.filter((f) => f.docType === 'request').length, skipped, out }));
  } finally {
    await closePool();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
