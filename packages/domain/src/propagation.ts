// §3.5 Değişiklik yayılımı — dependency graph: which documents become stale when an entity changes
import type { DocumentKind } from '@mice/shared';
import { notImplemented } from './_todo.js';
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
export function staleKindsFor(entity: EntityType, changedFields: string[]): DocumentKind[] { return notImplemented('staleKindsFor'); }
/** Change impact for §7 Adım 6 değişiklik akışı. */
export function changeImpact(before: { costEur: number; saleEur: number }, after: { costEur: number; saleEur: number }, targetMarginMin: number): { deltaCostEur: number; deltaSaleEur: number; newMargin: number; belowTarget: boolean } { return notImplemented('changeImpact'); }
/** §7 Adım 4 revizyon: tarih/kişi değiştiyse Adım 1, yalnız fiyat ise Adım 2. */
export function revisionTargetStep(changedFields: string[]): 1 | 2 { return notImplemented('revisionTargetStep'); }
