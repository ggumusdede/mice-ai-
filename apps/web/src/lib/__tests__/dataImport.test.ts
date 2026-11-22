import { describe, expect, it } from 'vitest';
import type { ImportBatchDetail, ImportRow } from '@mice/shared';
import { approvedByEntity, commitReadiness, filterRows, groupByStatus, rowLabel } from '../dataImport';

const row = (o: Partial<ImportRow>): ImportRow => ({
  id: Math.random().toString(36), fileId: 'f', entity: 'suppliers', rowNo: 2, input: { name: 'Moda Sahil Otel', vkn: null, city: 'İstanbul' }, data: {},
  status: 'ok', issues: [], review: 'pending', resolved: {}, committedEntityId: null, committedAction: null, ...o,
});
const detail = (rows: ImportRow[], status: 'open' | 'committed' = 'open'): ImportBatchDetail => ({
  batch: { id: 'b', label: null, status, summary: { rows: rows.length, ok: 0, warning: 0, error: 0, pending: 0, approved: 0, rejected: 0, byEntity: {} }, createdBy: 'u', createdAt: '', committedAt: null, committedBy: null, abandonedAt: null, abandonReason: null },
  files: [], rows,
});

describe('data import helpers', () => {
  it('groups by status, errors first, and filters', () => {
    const rows = [row({ status: 'ok' }), row({ status: 'error' }), row({ status: 'warning', entity: 'projects' })];
    expect(groupByStatus(rows).map((g) => g.status)).toEqual(['error', 'warning', 'ok']);
    expect(filterRows(rows, { entity: 'projects' })).toHaveLength(1);
    expect(filterRows(rows, { status: 'ok', entity: 'all' })).toHaveLength(1);
  });
  it('commit needs every non-error row decided and at least one approval', () => {
    expect(commitReadiness(detail([row({}), row({ status: 'error' })])).reason).toBe('1 satır doğrulanmayı bekliyor');
    expect(commitReadiness(detail([row({ review: 'rejected' })])).reason).toBe('Onaylanmış satır yok');
    const ok = commitReadiness(detail([row({ review: 'approved' }), row({ status: 'error' })]));
    expect(ok).toMatchObject({ canCommit: true, approved: 1, excluded: 1 });
    expect(commitReadiness(detail([row({ review: 'approved' })], 'committed')).canCommit).toBe(false);
  });
  it('row label and approved counts', () => {
    expect(rowLabel(row({}))).toBe('Moda Sahil Otel · İstanbul');
    expect(approvedByEntity([row({ review: 'approved' }), row({ review: 'approved', status: 'error' })])).toEqual({ suppliers: 1 });
  });
});
