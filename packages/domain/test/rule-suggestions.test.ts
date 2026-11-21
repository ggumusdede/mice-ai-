import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, type TenantRules } from '@mice/shared';
import {
  applyRuleSuggestionPatch, evaluateOffer, isSuggestableRuleKey, NEVER_SUGGESTED_RULE_KEYS, quantile, rfqHoursFor, seasonalMarkupFor,
  suggestRuleChanges, SUGGESTABLE_RULE_KEYS, type AdvantageObservation, type MarkupObservation, type RfqResponseObservation,
} from '../src/index.js';

const rules: TenantRules = structuredClone(DEFAULT_RULES);

function advs(supplierId: string, name: string, months: number[], values: number[], year = 2026): AdvantageObservation[] {
  const out: AdvantageObservation[] = [];
  months.forEach((m) => values.forEach((v, i) => out.push({ supplierId, supplierName: name, date: `${year}-${String(m).padStart(2, '0')}-${String(5 + i).padStart(2, '0')}`, advantage: v, ref: `PRJ-${m}-${i}`, roomType: 'DBL' })));
  return out;
}

describe('§16.5 rule suggestions — supplier × season advantage', () => {
  const winter = advs('h1', 'Kadıköy Grand Otel', [1, 2], [0.17, 0.18, 0.19, 0.2]); // 8 points, mean 18.5%
  const summer = advs('h1', 'Kadıköy Grand Otel', [6, 7, 8], [0.04, 0.06]); // 6 points, mean 5%

  it('proposes a scoped seasonal markup with evidence rows and Turkish rationale', () => {
    const s = suggestRuleChanges({ rules, advantages: [...winter, ...summer] });
    const x = s.find((v) => v.kind === 'supplier_season_markup')!;
    expect(x).toBeTruthy();
    expect(x.key).toBe('supplierSeasonMarkups');
    expect(x.scope).toMatchObject({ supplierId: 'h1', months: [1, 2] });
    // p25 of 17..20% → 17.x% → tier 15% → markup 20%
    expect(x.patch).toMatchObject({ op: 'upsert_supplier_season_markup', entry: { supplierId: 'h1', months: [1, 2], markup: 0.2 } });
    expect(x.title).toMatch(/Ocak–Şubat'ta ortalama %18\.5 avantaj veriyor/);
    expect(x.title).toMatch(/yükselteyim mi\?/);
    expect(x.rationale).toMatch(/diğer aylarda ortalama %5/);
    expect(x.sampleSize).toBe(8);
    expect(x.evidence.rows).toHaveLength(8);
    expect(x.evidence.columns.map((c) => c.key)).toEqual(['date', 'ref', 'roomType', 'advantage']);
    expect(x.confidence).toBeGreaterThan(0.5);
    expect(x.confidence).toBeLessThanOrEqual(0.95);
  });

  it('requires a minimum sample and a lift over other months', () => {
    expect(suggestRuleChanges({ rules, advantages: winter.slice(0, 5) }).filter((v) => v.kind === 'supplier_season_markup')).toEqual([]);
    const flat = advs('h2', 'Düz Otel', [1, 2, 6, 7], [0.18, 0.19]);
    expect(suggestRuleChanges({ rules, advantages: flat }).filter((v) => v.kind === 'supplier_season_markup' && v.scope?.months?.length === 2 && v.scope.months.includes(1) && v.scope.months.includes(2))).toEqual([]);
  });

  it('does not re-suggest an override that already exists with the same markup', () => {
    const r2 = { ...rules, supplierSeasonMarkups: [{ supplierId: 'h1', months: [1, 2], markup: 0.2 }] };
    expect(suggestRuleChanges({ rules: r2, advantages: [...winter, ...summer] }).filter((v) => v.kind === 'supplier_season_markup')).toEqual([]);
  });

  it('seasonal override applies only when the price class is unknown (tier table otherwise)', () => {
    const r2 = { ...rules, supplierSeasonMarkups: [{ supplierId: 'h1', months: [1, 2], markup: 0.2 }] };
    expect(seasonalMarkupFor(r2.supplierSeasonMarkups, 'h1', '2027-01-20')?.markup).toBe(0.2);
    expect(seasonalMarkupFor(r2.supplierSeasonMarkups, 'h1', '2027-03-20')).toBeNull();
    expect(seasonalMarkupFor(r2.supplierSeasonMarkups, 'other', '2027-01-20')).toBeNull();
    expect(seasonalMarkupFor([], 'h1', '2027-01-20')).toBeNull();
    const n = { offerId: 'o', supplierId: 'h1', currency: 'EUR', totalNetExVatEur: 1000, perRoomNightEur: 100, perPersonEur: null, perPersonPerDayEur: null, hiddenCosts: [] } as never;
    const unknown = evaluateOffer({ kind: 'accommodation', normalized: n, supplierStatus: 'accredited', channel: null, rules, seasonalMarkup: 0.2 });
    expect(unknown.suggestedMarkup).toBe(0.2);
    expect(unknown.risks.join(' ')).toMatch(/tedarikçi\/sezon kuralı/);
    const known = evaluateOffer({ kind: 'accommodation', normalized: n, supplierStatus: 'accredited', channel: { priceEur: 102, conditionsMatch: true }, rules, seasonalMarkup: 0.2 });
    expect(known.suggestedMarkup).toBe(0.05); // 2% advantage → lowest tier, override ignored
    const defaultBehaviour = evaluateOffer({ kind: 'accommodation', normalized: n, supplierStatus: 'accredited', channel: null, rules });
    expect(defaultBehaviour.suggestedMarkup).toBe(0.05);
  });
});

describe('§16.5 rule suggestions — markup tiers from consistent edits', () => {
  const edits = (adv: number, suggested: number, applied: number[], dateBase = '2026-10-'): MarkupObservation[] =>
    applied.map((a, i) => ({ advantage: adv + i * 0.001, suggestedMarkup: suggested, appliedMarkup: a, date: `${dateBase}${String(i + 1).padStart(2, '0')}`, ref: `Q${i}` }));

  it('consistent upward edits within a tier → raise that tier markup (monotonic)', () => {
    // tier 10–15% suggests 15%; users apply ~17%
    const s = suggestRuleChanges({ rules, markupEdits: edits(0.11, 0.15, [0.17, 0.17, 0.175, 0.17, 0.165, 0.17, 0.17, 0.18, 0.17]) });
    const x = s.find((v) => v.kind === 'markup_tier')!;
    expect(x).toBeTruthy();
    const tiers = (x.patch as { op: 'set'; values: { markupTiers: { minAdvantage: number; markup: number }[] } }).values.markupTiers;
    expect(tiers[2]).toEqual({ minAdvantage: 0.1, markup: 0.17 });
    expect(tiers.map((t) => t.markup)).toEqual([0.05, 0.1, 0.17, 0.2, 0.25]);
    expect(x.evidence.rows).toHaveLength(9);
    expect(x.title).toMatch(/yukarı düzeltildi/);
  });

  it('edits reaching the next tier → move the next boundary down instead', () => {
    const s = suggestRuleChanges({ rules, markupEdits: edits(0.12, 0.15, Array(9).fill(0.2)) });
    const x = s.find((v) => v.kind === 'markup_tier')!;
    const tiers = (x.patch as any).values.markupTiers;
    expect(tiers[3].markup).toBe(0.2);
    expect(tiers[3].minAdvantage).toBeLessThan(0.15);
    expect(tiers[3].minAdvantage).toBeGreaterThan(0.1);
    expect(x.title).toMatch(/alt sınırını/);
  });

  it('mixed directions or too few samples → nothing', () => {
    expect(suggestRuleChanges({ rules, markupEdits: edits(0.11, 0.15, [0.17, 0.13, 0.17, 0.13, 0.17, 0.13, 0.17, 0.13, 0.17]) }).filter((v) => v.kind === 'markup_tier')).toEqual([]);
    expect(suggestRuleChanges({ rules, markupEdits: edits(0.11, 0.15, [0.17, 0.17, 0.17]) }).filter((v) => v.kind === 'markup_tier')).toEqual([]);
  });
});

describe('§16.5 rule suggestions — RFQ follow-up hours', () => {
  const resp = (supplierId: string, name: string, hours: number[]): RfqResponseObservation[] =>
    hours.map((h, i) => {
      const sent = Date.parse(`2026-09-${String(i + 1).padStart(2, '0')}T07:00:00Z`);
      return { supplierId, supplierName: name, sentAt: new Date(sent).toISOString(), respondedAt: new Date(sent + h * 3_600_000).toISOString(), ref: `R${i}` };
    });

  it('global: fast responders → earlier reminder; per-supplier slow responder → scoped override', () => {
    const fast = [...resp('s1', 'A Otel', [2, 3, 4, 5, 6, 4, 3, 5, 4, 3]), ...resp('s2', 'B Transfer', [3, 4, 6, 5, 2, 7, 4, 5, 3, 4])];
    const slow = resp('s3', 'C Kongre', [60, 70, 72, 80, 66, 75]);
    const onlyFast = suggestRuleChanges({ rules, rfqResponses: fast });
    const g = onlyFast.find((v) => v.kind === 'rfq_hours')!;
    expect(g.patch).toEqual({ op: 'set', values: { rfqReminderHours: 8, rfqCallTaskHours: 20 } });
    expect(g.title).toMatch(/RFQ hatırlatmasını 24 → 8 saat/);
    expect(onlyFast.filter((v) => v.kind === 'supplier_rfq_hours')).toEqual([]);
    const s = suggestRuleChanges({ rules, rfqResponses: [...fast, ...slow] });
    expect(s.find((v) => v.kind === 'rfq_hours')?.patch).toEqual({ op: 'set', values: { rfqReminderHours: 8, rfqCallTaskHours: 72 } });
    const sc = s.find((v) => v.kind === 'supplier_rfq_hours' && v.scope?.supplierId === 's3')!;
    expect(sc.patch).toMatchObject({ op: 'upsert_supplier_rfq_hours', entry: { supplierId: 's3', reminderHours: 76 } });
    expect(sc.evidence.rows).toHaveLength(6);
  });

  it('rfqHoursFor: scoped override else tenant rules', () => {
    const r2 = { ...rules, supplierRfqHours: [{ supplierId: 's3', reminderHours: 72, callTaskHours: 96 }] };
    expect(rfqHoursFor(r2, 's3')).toEqual({ reminderHours: 72, callTaskHours: 96, scoped: true });
    expect(rfqHoursFor(r2, 'x')).toEqual({ reminderHours: 24, callTaskHours: 48, scoped: false });
    expect(rfqHoursFor(rules, 's3').scoped).toBe(false);
  });
});

describe('§16.5 rule suggestions — target margin and option days', () => {
  it('many approved overrides just below target (mostly won) → small step down', () => {
    const mo = Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, margin: 0.068 + (i % 3) * 0.002, approved: i !== 9, outcome: (i % 4 === 0 ? 'lost' : 'won') as 'won' | 'lost', ref: `Q${i}` }));
    const x = suggestRuleChanges({ rules, marginOverrides: mo }).find((v) => v.kind === 'target_margin')!;
    expect(x.patch).toEqual({ op: 'set', values: { targetMarginMin: 0.065 } });
    expect(x.confidence).toBeLessThanOrEqual(0.8);
    expect(x.evidence.rows).toHaveLength(10);
  });

  it('overrides far below target or mostly lost → nothing', () => {
    const far = Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-${i + 10}`, margin: 0.02, approved: true, outcome: 'won' as const }));
    expect(suggestRuleChanges({ rules, marginOverrides: far }).filter((v) => v.kind === 'target_margin')).toEqual([]);
    const lost = Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-${i + 10}`, margin: 0.07, approved: true, outcome: 'lost' as const }));
    expect(suggestRuleChanges({ rules, marginOverrides: lost }).filter((v) => v.kind === 'target_margin')).toEqual([]);
  });

  it('customers deciding late → longer option (capped)', () => {
    // sent Monday 09:00 Istanbul; accepted ~ 9 business days later
    const qd = Array.from({ length: 10 }, (_, i) => ({ sentAt: '2026-09-07T06:00:00Z', decidedAt: new Date(Date.parse('2026-09-18T12:00:00Z') + i * 3_600_000).toISOString(), outcome: 'accepted' as const, ref: `Q${i}` }));
    const x = suggestRuleChanges({ rules, quoteDecisions: qd }).find((v) => v.kind === 'customer_option_days')!;
    expect(x).toBeTruthy();
    expect((x.patch as any).values.customerOptionBusinessDays).toBeGreaterThan(7);
    expect((x.patch as any).values.customerOptionBusinessDays).toBeLessThanOrEqual(12);
  });
});

describe('§6 safety: suggestions never touch forbidden / authority settings', () => {
  it('allow-list and deny-list are disjoint; patch application refuses forbidden keys and stale values', () => {
    for (const k of SUGGESTABLE_RULE_KEYS) expect(NEVER_SUGGESTED_RULE_KEYS).not.toContain(k);
    expect(isSuggestableRuleKey('aiConfidenceThreshold')).toBe(false);
    expect(isSuggestableRuleKey('automationPromotionThreshold')).toBe(false);
    expect(isSuggestableRuleKey('fieldExtraPerItemLimitTry')).toBe(false);
    expect(applyRuleSuggestionPatch(rules, { op: 'set', values: { aiConfidenceThreshold: 0.1 } as never })).toEqual({ ok: false, reason: 'forbidden_key' });
    expect(applyRuleSuggestionPatch(rules, { op: 'set', values: { targetMarginMin: 0.07 } }, { targetMarginMin: 0.09 })).toEqual({ ok: false, reason: 'stale' });
    expect(applyRuleSuggestionPatch(rules, { op: 'set', values: { targetMarginMin: 0.07 } }, { targetMarginMin: 0.08 })).toEqual({ ok: true, values: { targetMarginMin: 0.07 } });
    expect(applyRuleSuggestionPatch(rules, { op: 'set', values: { markupTiers: [{ minAdvantage: 0, markup: 0.2 }, { minAdvantage: 0.1, markup: 0.1 }] } })).toEqual({ ok: false, reason: 'invalid' });
    const up = applyRuleSuggestionPatch({ ...rules, supplierSeasonMarkups: [{ supplierId: 'h1', months: [1, 2], markup: 0.15 }, { supplierId: 'h2', months: [7], markup: 0.1 }] },
      { op: 'upsert_supplier_season_markup', entry: { supplierId: 'h1', months: [2, 1], markup: 0.2 } });
    expect(up).toEqual({ ok: true, values: { supplierSeasonMarkups: [{ supplierId: 'h2', months: [7], markup: 0.1 }, { supplierId: 'h1', months: [2, 1], markup: 0.2 }] } });
  });

  it('no data → no suggestions; quantile helper', () => {
    expect(suggestRuleChanges({ rules })).toEqual([]);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
});
