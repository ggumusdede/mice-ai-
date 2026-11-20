import { describe, expect, it } from 'vitest';
import { rfqMinimumMissing, missingFromChecklist, findDuplicates, markLowConfidence, suggestAssignee, normalizeCustomerName } from '../src/intake.js';
import { rankSuppliers } from '../src/shortlist.js';
import type { ChecklistQuestion } from '@mice/shared';
import { ex, extraction, supplier } from './fixtures.js';

describe('rfqMinimumMissing', () => {
  const full = { startDate: '2027-03-12', pax: 80, city: 'İstanbul', district: 'Şişli', roomsSgl: 0, roomsDbl: 40, hallLayout: 'tiyatro', budget: 25000, budgetSegment: null };
  it('complete request → nothing missing', () => {
    expect(rfqMinimumMissing(full)).toEqual([]);
  });
  it('budget may be replaced by a segment chosen by the team', () => {
    expect(rfqMinimumMissing({ ...full, budget: null, budgetSegment: '5*' })).toEqual([]);
    expect(rfqMinimumMissing({ ...full, budget: null })).toEqual(['budget']);
  });
  it('lists every missing minimum', () => {
    expect(rfqMinimumMissing({ startDate: null, pax: 0, city: ' ', district: null, roomsSgl: null, roomsDbl: null, hallLayout: '', budget: null, budgetSegment: null })).toEqual(['startDate', 'pax', 'city', 'roomSplit', 'hallLayout', 'budget']);
    expect(rfqMinimumMissing({ ...full, city: null })).toEqual([]); // district alone is enough
  });
});

describe('missingFromChecklist', () => {
  const q = (over: Partial<ChecklistQuestion>): ChecklistQuestion => ({ id: 'q', tenantId: 't', eventType: null, question: '?', field: null, status: 'active', source: 'seed', ...over });
  const checklist = [
    q({ id: '1', field: 'pax', question: 'Kaç kişi?' }),
    q({ id: '2', field: 'budget', question: 'Bütçe nedir?' }),
    q({ id: '3', field: 'technical', question: 'Teknik ihtiyaç?', eventType: 'Toplantı' }),
    q({ id: '4', field: 'transfer', question: 'Transfer?', eventType: 'gala' }),
    q({ id: '5', field: null, question: 'Daha önce hangi otelde yaptınız?' }),
    q({ id: '6', field: 'billingInfo', question: 'Fatura bilgisi?', status: 'suggested' }),
    q({ id: '7', field: 'district', question: 'Semt?' }),
  ];
  it('active questions for the event type whose field is empty or low confidence', () => {
    const e = extraction({ district: ex('Şişli', 0.5) });
    expect(missingFromChecklist(e, checklist, 'toplantı', 0.8)).toEqual([
      { field: 'budget', question: 'Bütçe nedir?' },
      { field: 'technical', question: 'Teknik ihtiyaç?' },
      { field: null, question: 'Daha önce hangi otelde yaptınız?' },
      { field: 'district', question: 'Semt?' },
    ]);
  });
  it('event-type specific questions skipped when type unknown', () => {
    expect(missingFromChecklist(extraction(), checklist, null, 0.8).map((x) => x.field)).toEqual(['budget', null]);
  });
});

describe('findDuplicates', () => {
  const open = [
    { id: 'p1', code: 'PRJ-0001', customerName: 'ACME İlaç San. ve Tic. A.Ş.', startDate: '2027-03-11', endDate: '2027-03-13' },
    { id: 'p2', code: 'PRJ-0002', customerName: 'Acme İlaç', startDate: '2027-05-01', endDate: '2027-05-02' },
    { id: 'p3', code: 'PRJ-0003', customerName: 'Beta', startDate: '2027-03-12', endDate: null },
  ];
  it('same normalized customer + overlapping dates', () => {
    const r = findDuplicates({ customerName: 'acme ilaç a.ş.', startDate: '2027-03-12', endDate: '2027-03-14' }, open);
    expect(r.map((x) => x.projectId)).toEqual(['p1']);
    expect(r[0].reason).toContain('çakışan');
  });
  it('touching single-day ranges overlap; missing data → none', () => {
    expect(findDuplicates({ customerName: 'Beta', startDate: '2027-03-12', endDate: null }, open).map((x) => x.projectId)).toEqual(['p3']);
    expect(findDuplicates({ customerName: null, startDate: '2027-03-12', endDate: null }, open)).toEqual([]);
    expect(findDuplicates({ customerName: 'Acme İlaç', startDate: null, endDate: null }, open)).toEqual([]);
  });
  it('normalizeCustomerName strips legal suffixes', () => {
    expect(normalizeCustomerName('ACME İlaç San. ve Tic. A.Ş.')).toBe('acme ilaç');
  });
});

describe('markLowConfidence', () => {
  it('flags fields below threshold without mutating input', () => {
    const e = extraction({ pax: ex(80, 0.6), city: ex('İstanbul', 0.8) });
    const m = markLowConfidence(e, 0.8);
    expect(m.pax.needsReview).toBe(true);
    expect(m.city.needsReview).toBe(false);
    expect(m.language).toBe('tr');
    expect(e.pax.needsReview).toBeUndefined();
  });
});

describe('suggestAssignee', () => {
  it('prefers customer history, then lighter workload, among sales clerks', () => {
    const r = suggestAssignee([
      { id: 'a', fullName: 'Admin', role: 'admin', openProjects: 0, customerProjects: 10 },
      { id: 'u1', fullName: 'Zeynep', role: 'clerk_sales', openProjects: 6, customerProjects: 4 },
      { id: 'u2', fullName: 'Can', role: 'clerk_sales', openProjects: 2, customerProjects: 0 },
      { id: 'f', fullName: 'Finans', role: 'finance', openProjects: 0, customerProjects: 0 },
    ]);
    expect(r).toMatchObject({ userId: 'u1' });
    expect(r!.reason).toContain('4 proje');
  });
  it('workload decides without history; empty → null; admin fallback', () => {
    expect(suggestAssignee([{ id: 'u1', fullName: 'A', role: 'clerk_sales', openProjects: 5, customerProjects: 0 }, { id: 'u2', fullName: 'B', role: 'clerk_sales', openProjects: 1, customerProjects: 0 }])!.userId).toBe('u2');
    expect(suggestAssignee([])).toBeNull();
    expect(suggestAssignee([{ id: 'a', fullName: 'Admin', role: 'admin', openProjects: 3, customerProjects: 0 }])!.userId).toBe('a');
  });
});

describe('rankSuppliers', () => {
  const list = [
    supplier({ id: 's1', name: 'Şişli Otel', district: 'Şişli', performanceScore: 60, avgResponseHours: 30 }),
    supplier({ id: 's2', name: 'Beşiktaş Otel', district: 'Beşiktaş', performanceScore: 95, avgResponseHours: 2 }),
    supplier({ id: 's3', name: 'Aday Şişli', district: 'şişli', status: 'candidate', performanceScore: 99, avgResponseHours: 1 }),
    supplier({ id: 's4', name: 'Pasif', district: 'Şişli', status: 'passive' }),
    supplier({ id: 's5', name: 'Ankara Otel', city: 'Ankara', district: 'Çankaya' }),
    supplier({ id: 's6', name: 'Transferci', kinds: ['transfer'] }),
    supplier({ id: 's7', name: 'Küçük Otel', district: 'Kadıköy', roomCount: 20, capacityPax: 40 }),
  ];
  const req = { kind: 'accommodation' as const, city: 'istanbul', district: 'ŞİŞLİ', pax: 80, rooms: 40 };
  it('requested district first (accredited before candidate), then rest of the city by score', () => {
    const r = rankSuppliers(list, req);
    expect(r.map((x) => x.supplier.id)).toEqual(['s1', 's3', 's2', 's7']);
    expect(r[0].sameDistrict).toBe(true);
    expect(r[1].candidate).toBe(true);
    expect(r[3].reasons).toContain('Kapasite yetersiz');
  });
  it('historical advantage raises the score', () => {
    const r = rankSuppliers(list, { ...req, district: null, avgHistoricalAdvantage: { s7: 0.2 } });
    const s7 = r.find((x) => x.supplier.id === 's7')!;
    expect(s7.reasons.some((x) => x.includes('%20'))).toBe(true);
    expect(r.every((x) => !x.sameDistrict)).toBe(true);
  });
  it('unknown capacity is neutral-ish; no city filter when city unknown', () => {
    const r = rankSuppliers([supplier({ id: 'x', capacityPax: null, roomCount: null, halls: [] })], { ...req, city: null });
    expect(r[0].reasons).toContain('Kapasite bilinmiyor');
    expect(rankSuppliers(list, { ...req, city: null, district: null }).map((x) => x.supplier.id)).toContain('s5');
  });
});
