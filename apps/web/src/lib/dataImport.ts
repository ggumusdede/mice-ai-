// Pure helpers for the "Veri aktarımı" verification screen (§8 İlk veri yükü). Unit-tested.
import type { ImportBatchDetail, ImportEntityName, ImportRow, ImportRowStatusName } from '@mice/shared';
import { IMPORT_ENTITIES, IMPORT_TEMPLATES } from '@mice/domain';

export const ENTITY_ORDER = IMPORT_ENTITIES as readonly ImportEntityName[];
export const ENTITY_LABEL = Object.fromEntries(ENTITY_ORDER.map((e) => [e, IMPORT_TEMPLATES[e].title])) as Record<ImportEntityName, string>;
export const STATUS_ORDER: ImportRowStatusName[] = ['error', 'warning', 'ok'];
export const STATUS_LABEL: Record<ImportRowStatusName, string> = { ok: 'Hatasız', warning: 'Uyarı', error: 'Hata' };

export interface RowFilter { entity?: ImportEntityName | 'all'; status?: ImportRowStatusName | 'all' }

export function filterRows(rows: ImportRow[], f: RowFilter): ImportRow[] {
  return rows.filter((r) => (!f.entity || f.entity === 'all' || r.entity === f.entity) && (!f.status || f.status === 'all' || r.status === f.status));
}

/** Rows grouped by validation status, errors first (what needs attention comes first). */
export function groupByStatus(rows: ImportRow[]): { status: ImportRowStatusName; rows: ImportRow[] }[] {
  return STATUS_ORDER.map((status) => ({ status, rows: rows.filter((r) => r.status === status) })).filter((g) => g.rows.length);
}

/** First columns of the entity template — the compact row label in the table. */
export function rowLabel(row: ImportRow, max = 4): string {
  const cols = IMPORT_TEMPLATES[row.entity].columns.slice(0, max + 2);
  return cols.map((c) => row.input[c.key]).filter((v) => v != null && String(v).trim() !== '').slice(0, max).join(' · ');
}

export interface CommitReadiness { canCommit: boolean; approved: number; pending: number; rejected: number; excluded: number; reason: string | null }

/** Mirrors the server rule: every non-error row decided (approve / reject), at least one approved. */
export function commitReadiness(detail: ImportBatchDetail | null | undefined): CommitReadiness {
  const rows = detail?.rows ?? [];
  const pending = rows.filter((r) => r.status !== 'error' && r.review === 'pending').length;
  const approved = rows.filter((r) => r.status !== 'error' && r.review === 'approved').length;
  const rejected = rows.filter((r) => r.status !== 'error' && r.review === 'rejected').length;
  const excluded = rows.filter((r) => r.status === 'error').length;
  let reason: string | null = null;
  if (!detail) reason = 'Aktarım seçilmedi';
  else if (detail.batch.status !== 'open') reason = detail.batch.status === 'committed' ? 'Aktarım işlendi' : 'Aktarımdan vazgeçildi';
  else if (pending) reason = `${pending} satır doğrulanmayı bekliyor`;
  else if (!approved) reason = 'Onaylanmış satır yok';
  return { canCommit: reason == null, approved, pending, rejected, excluded, reason };
}

/** Count of approved rows per entity (commit summary preview). */
export function approvedByEntity(rows: ImportRow[]): Partial<Record<ImportEntityName, number>> {
  const out: Partial<Record<ImportEntityName, number>> = {};
  for (const r of rows) if (r.review === 'approved' && r.status !== 'error') out[r.entity] = (out[r.entity] ?? 0) + 1;
  return out;
}
