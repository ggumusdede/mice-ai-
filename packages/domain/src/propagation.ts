// §3.5 Değişiklik yayılımı — dependency graph: which documents become stale when an entity changes
import { DOCUMENT_KINDS, type DocumentKind } from '@mice/shared';
export type EntityType = 'project' | 'service_item' | 'supplier_offer' | 'quote' | 'contract' | 'finance_entry' | 'guest' | 'field_extra' | 'customer';
/** Static dependency map: entity type → document kinds that read from it. */
export const DOCUMENT_DEPENDENCIES: Record<EntityType, DocumentKind[]> = {
  project: ['quote', 'contract', 'program', 'pnl', 'rooming_list', 'customer_invoice_draft', 'supplier_confirmation'],
  service_item: ['quote', 'contract', 'program', 'pnl', 'supplier_confirmation', 'customer_invoice_draft'],
  supplier_offer: ['quote', 'pnl', 'contract'],
  quote: ['pnl', 'contract', 'customer_invoice_draft', 'program'],
  contract: ['pnl', 'program', 'customer_invoice_draft', 'supplier_confirmation'],
  finance_entry: ['pnl', 'customer_invoice_draft'],
  guest: ['rooming_list'],
  field_extra: ['pnl', 'customer_invoice_draft'],
  customer: ['quote', 'contract', 'customer_invoice_draft'],
};

/** Bookkeeping / workflow fields that no generated document reads (changing them never makes a document stale). */
export const NON_DOCUMENT_FIELDS: ReadonlySet<string> = new Set([
  'id', 'tenantId', 'createdAt', 'updatedAt', 'status', 'step', 'ownerId', 'notes', 'internalNotes', 'lastFollowupAt', 'openedAt',
  'reminderSentAt', 'callTaskCreatedAt', 'alarmedAt', 'overdueAlertedAt', 'verifiedBy', 'confidence', 'extraction', 'customerWaitMinutes',
  'targetBusinessDays', 'targetOverrideReason', 'decidedAt', 'decidedBy', 'consentAt',
]);

/** Document kinds made stale by changing `changedFields` of an entity (in DOCUMENT_KINDS order). No relevant field → []. */
export function staleKindsFor(entity: EntityType, changedFields: string[]): DocumentKind[] {
  const deps = DOCUMENT_DEPENDENCIES[entity] ?? [];
  const relevant = changedFields.filter((f) => !NON_DOCUMENT_FIELDS.has(f));
  if (!relevant.length) return [];
  const set = new Set(deps);
  return DOCUMENT_KINDS.filter((k) => set.has(k));
}

/** Change impact for §7 Adım 6 değişiklik akışı. */
export function changeImpact(before: { costEur: number; saleEur: number }, after: { costEur: number; saleEur: number }, targetMarginMin: number): { deltaCostEur: number; deltaSaleEur: number; newMargin: number; belowTarget: boolean } {
  const r2 = (n: number) => Math.round(n * 100) / 100 || 0;
  const newMargin = after.saleEur !== 0 ? (after.saleEur - after.costEur) / after.saleEur : 0;
  return { deltaCostEur: r2(after.costEur - before.costEur), deltaSaleEur: r2(after.saleEur - before.saleEur), newMargin, belowTarget: newMargin < targetMarginMin - 1e-9 };
}

/** Fields whose change requires going back to supplier selection / RFQ (dates, head count, rooms, location). */
const STEP1_FIELD = /(date|pax|room|night|guest|headcount|kisi|kişi|tarih|city|district|venue|location|hallLayout)/i;
/** §7 Adım 4 revizyon: tarih/kişi değiştiyse Adım 1, yalnız fiyat ise Adım 2. */
export function revisionTargetStep(changedFields: string[]): 1 | 2 {
  return changedFields.some((f) => STEP1_FIELD.test(f)) ? 1 : 2;
}
