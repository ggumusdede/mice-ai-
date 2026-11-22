// §8 İlk veri yükü — client for /api/import/* (admin only). Kept out of client.ts to keep that shared file small.
import type { ImportBatch, ImportBatchDetail, ImportEntityName, ImportReviewRequest, List } from '@mice/shared';
import { buildQuery, openBinary, request } from './client';

const enc = encodeURIComponent;

export const importApi = {
  template: (entity: ImportEntityName, format: 'xlsx' | 'csv' = 'xlsx') =>
    openBinary(`/import/templates/${enc(entity)}${buildQuery({ format })}`, `sablon-${entity}.${format}`),
  batches: () => request<List<ImportBatch>>('GET', '/import/batches').then((r) => r.items),
  create: (label?: string) => request<ImportBatch>('POST', '/import/batches', { label }),
  get: (id: string) => request<ImportBatchDetail>('GET', `/import/batches/${enc(id)}`),
  upload: (id: string, entity: ImportEntityName, file: File) => {
    const fd = new FormData();
    fd.append('entity', entity);
    fd.append('file', file, file.name);
    return request<ImportBatchDetail>('POST', `/import/batches/${enc(id)}/files`, fd);
  },
  editRow: (rowId: string, input: Record<string, string | number | boolean | null>) =>
    request<ImportBatchDetail>('PATCH', `/import/rows/${enc(rowId)}`, { input }),
  review: (id: string, b: ImportReviewRequest) => request<ImportBatchDetail>('POST', `/import/batches/${enc(id)}/review`, b),
  revalidate: (id: string) => request<ImportBatchDetail>('POST', `/import/batches/${enc(id)}/revalidate`, {}),
  commit: (id: string) => request<ImportBatchDetail>('POST', `/import/batches/${enc(id)}/commit`, {}),
  abandon: (id: string, reason?: string) => request<ImportBatch>('POST', `/import/batches/${enc(id)}/abandon`, { reason }),
};
