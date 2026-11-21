// §18.9 / §19.3: the evaluation harness runs on the deterministic mock; asserts the report shape and a modest baseline.
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MockAiService } from '../src/index.js';
import { calibration, compareValues, matchLines, normalizeText, recommendThreshold, runEval, wilson, type FieldResult } from '../eval/harness.js';
import { loadFixtures, parseArgs, serviceFor, writeReport } from '../eval/run.js';

describe('eval harness — comparators and statistics', () => {
  it('exact / normalized / numeric tolerance / absent', () => {
    expect(compareValues('normalized', 'Beta Enerji A.Ş.', 'BETA ENERJİ').correct).toBe(true);
    expect(compareValues('normalized', 'ООО Северсталь Трейд', 'Северсталь Трейд').correct).toBe(true);
    expect(compareValues('normalized', 'Moda Sahil Otel', 'Kalamış Marina Hotel').correct).toBe(false);
    expect(compareValues('money', 8250, 8250.004).correct).toBe(true);
    expect(compareValues('money', 8250, 8250.5).correct).toBe(false);
    expect(compareValues('rate', 0.3, 0.3).correct).toBe(true);
    expect(compareValues('code', 'TRY', 'tl').correct).toBe(true);
    expect(compareValues('date', '2027-03-12', '2027-03-12T00:00:00Z').correct).toBe(true);
    expect(compareValues('int', null, null)).toEqual({ correct: true, matchKind: 'absent' });
    expect(compareValues('int', null, 3)).toEqual({ correct: false, matchKind: 'extra' });
    expect(compareValues('int', 3, null)).toEqual({ correct: false, matchKind: 'missing' });
    expect(normalizeText('Kadıköy Grand Otel')).toBe('kadikoy grand');
  });

  it('line matching, calibration, Wilson-bounded thresholds', () => {
    const m = matchLines([{ unitPrice: 100, kind: 'hall' }, { unitPrice: 50, kind: 'fnb' }], [{ unitPrice: 50, kind: 'fnb' }, { unitPrice: 999, kind: 'x' }], [{ field: 'unitPrice', comparator: 'money', group: 'money' }, { field: 'kind', comparator: 'code', group: 'code' }]);
    expect(m).toEqual([[0, null], [1, 0]]);
    const rs = (n: number, conf: number, correct: boolean): FieldResult[] => Array.from({ length: n }, (_, i) => ({ docId: `d${i}`, docType: 'invoice', language: 'tr', field: 'f', group: 'money', comparator: 'money', gold: 1, pred: 1, correct, matchKind: 'exact', confidence: conf }));
    const data = [...rs(100, 0.95, true), ...rs(10, 0.7, false), ...rs(30, 0.7, true)];
    const cal = calibration(data);
    expect(cal.rows.find((r) => r.bucket.startsWith('0.95'))).toMatchObject({ n: 100, accuracy: 1 });
    expect(cal.rows.find((r) => r.bucket.startsWith('0.70'))).toMatchObject({ n: 40, accuracy: 0.75 });
    expect(cal.ece).toBeGreaterThan(0);
    const t = recommendThreshold('invoice', data, 0.95);
    expect(t.threshold).toBe(0.95);
    expect(t.coverageAtThreshold).toBeCloseTo(100 / 140, 3);
    expect(t.thresholdWilson).toBe(0.95); // 0/100 errors → Wilson upper ≈ 3.7% ≤ 5%
    expect(t.leaksAtDefault).toBe(0);
    expect(recommendThreshold('invoice', rs(5, 0.9, false), 0.95).threshold).toBeNull();
    expect(wilson(0, 100).high).toBeLessThan(0.05);
  });
});

describe('eval harness on the mock provider', () => {
  it('loads ≥ 20 labelled TR/EN/RU fixtures across all four document types', async () => {
    const fx = await loadFixtures(['requests', 'offers', 'contracts', 'invoices']);
    expect(fx.length).toBeGreaterThanOrEqual(20);
    expect(new Set(fx.map((f) => f.docType))).toEqual(new Set(['request', 'offer', 'contract', 'invoice']));
    expect(new Set(fx.map((f) => f.language))).toEqual(new Set(['tr', 'en', 'ru']));
    expect(new Set(fx.map((f) => f.id)).size).toBe(fx.length);
    expect(fx.find((f) => f.source === 'csv')?.input.file?.base64).toBeTruthy();
  });

  it('produces a JSON + Markdown report with per-field accuracy, calibration and thresholds; mock meets a modest baseline', async () => {
    const sets = ['requests', 'offers', 'contracts', 'invoices'] as const;
    const report = await runEval(new MockAiService(), await loadFixtures([...sets]), { target: 0.95, sets: [...sets], now: new Date('2026-11-20T00:00:00Z') });
    expect(report.failures).toEqual([]);
    expect(report.documents).toBeGreaterThanOrEqual(20);
    expect(report.fieldsScored).toBeGreaterThan(200);
    expect(Object.keys(report.byDocType).sort()).toEqual(['contract', 'invoice', 'offer', 'request']);
    for (const d of Object.values(report.byDocType)) {
      expect(d.perField.length).toBeGreaterThan(3);
      expect(d.calibration.reduce((s, c) => s + c.n, 0)).toBe(d.fields);
      expect(d.threshold.targetPrecision).toBe(0.95);
      expect(d.accuracy).toBeGreaterThanOrEqual(0.7); // modest per-type baseline for the heuristic mock
    }
    expect(report.byDocType.offer.lineF1).toBeGreaterThan(0.8);
    expect(report.overall.accuracy).toBeGreaterThanOrEqual(0.8);
    expect(report.byLanguage.map((l) => l.field).sort()).toEqual(['en', 'ru', 'tr']);
    // known mock weakness stays visible: Russian amounts are misread with high confidence (a leak above 0.8)
    expect(report.errors.some((e) => e.docId.startsWith('req-ru') && e.field === 'budget')).toBe(true);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mice-eval-'));
    const files = await writeReport(report, dir);
    expect(JSON.parse(await readFile(files.json, 'utf8')).version).toBe(1);
    const md = await readFile(files.md, 'utf8');
    expect(md).toMatch(/## Eşik önerileri/);
    expect(md).toMatch(/\*\*Kalibrasyon\*\*/);
  });

  it('CLI args; claude mode refuses to start without ANTHROPIC_API_KEY', () => {
    expect(parseArgs(['--provider=mock', '--set=requests,offers', '--target=0.9'])).toMatchObject({ provider: 'mock', sets: ['requests', 'offers'], target: 0.9, asPdf: false });
    expect(parseArgs([]).sets).toHaveLength(4);
    expect(() => parseArgs(['--set=nope'])).toThrow(/unknown/);
    expect(() => serviceFor('claude', {})).toThrow(/ANTHROPIC_API_KEY/);
    expect(serviceFor('mock', {}).name).toMatch(/mock/i);
    expect(serviceFor('claude', { ANTHROPIC_API_KEY: 'sk-test' }).name).toMatch(/claude/i);
  });
});
