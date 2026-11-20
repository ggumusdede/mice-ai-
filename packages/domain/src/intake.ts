// §7 Adım 0 Talep analizi kuralları
import type { ChecklistQuestion, RequestExtraction } from '@mice/shared';
import { notImplemented } from './_todo.js';
/** RFQ minimum: date, pax, city/district, room split, hall layout, budget (or segment chosen by team). */
export function rfqMinimumMissing(p: { startDate: string | null; pax: number | null; city: string | null; district: string | null; roomsSgl: number | null; roomsDbl: number | null; hallLayout: string | null; budget: number | null; budgetSegment: string | null }): string[] { return notImplemented('rfqMinimumMissing'); }
/** Missing list from learning checklist for the event type (active questions whose field is empty or low confidence). */
export function missingFromChecklist(extraction: RequestExtraction, checklist: ChecklistQuestion[], eventType: string | null, threshold: number): { field: string | null; question: string }[] { return notImplemented('missingFromChecklist'); }
/** Duplicate: same customer (normalized name) + overlapping dates with an open project. */
export function findDuplicates(candidate: { customerName: string | null; startDate: string | null; endDate: string | null }, open: { id: string; code: string; customerName: string | null; startDate: string | null; endDate: string | null }[]): { projectId: string; code: string; reason: string }[] { return notImplemented('findDuplicates'); }
/** Mark fields with confidence < threshold as needsReview. */
export function markLowConfidence(extraction: RequestExtraction, threshold: number): RequestExtraction { return notImplemented('markLowConfidence'); }
/** Assignment suggestion by workload and customer history. */
export function suggestAssignee(users: { id: string; fullName: string; role: string; openProjects: number; customerProjects: number }[]): { userId: string; fullName: string; reason: string } | null { return notImplemented('suggestAssignee'); }
