// §7 Adım 0 Talep analizi kuralları
import type { ChecklistQuestion, Extracted, RequestExtraction } from '@mice/shared';

const blank = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '');

/** RFQ minimum: date, pax, city/district, room split, hall layout, budget (or segment chosen by team).
 *  Returns the missing keys among: 'startDate', 'pax', 'city', 'roomSplit', 'hallLayout', 'budget'. */
export function rfqMinimumMissing(p: { startDate: string | null; pax: number | null; city: string | null; district: string | null; roomsSgl: number | null; roomsDbl: number | null; hallLayout: string | null; budget: number | null; budgetSegment: string | null }): string[] {
  const out: string[] = [];
  if (blank(p.startDate)) out.push('startDate');
  if (p.pax == null || !(p.pax > 0)) out.push('pax');
  if (blank(p.city) && blank(p.district)) out.push('city');
  if (p.roomsSgl == null && p.roomsDbl == null) out.push('roomSplit');
  if (blank(p.hallLayout)) out.push('hallLayout');
  if ((p.budget == null || !(p.budget > 0)) && blank(p.budgetSegment)) out.push('budget');
  return out;
}

const normType = (s: string) => s.trim().toLocaleLowerCase('tr-TR');

/** Missing list from learning checklist for the event type (active questions whose field is empty or low confidence).
 *  Questions without a field cannot be auto-answered and are always included. Questions scoped to another event type are skipped. */
export function missingFromChecklist(extraction: RequestExtraction, checklist: ChecklistQuestion[], eventType: string | null, threshold: number): { field: string | null; question: string }[] {
  const out: { field: string | null; question: string }[] = [];
  const seen = new Set<string>();
  for (const q of checklist) {
    if (q.status !== 'active') continue;
    if (q.eventType != null && (eventType == null || normType(q.eventType) !== normType(eventType))) continue;
    const key = q.field ?? `q:${q.question}`;
    if (seen.has(key)) continue;
    if (q.field) {
      const ex = (extraction as unknown as Record<string, Extracted<unknown> | undefined>)[q.field];
      const ok = ex && typeof ex === 'object' && 'confidence' in ex && !blank(ex.value) && ex.confidence >= threshold;
      if (ok) continue;
    }
    seen.add(key);
    out.push({ field: q.field, question: q.question });
  }
  return out;
}

const LEGAL_WORDS = new Set(['as', 'a.s', 'a.ş', 'aş', 'ltd', 'şti', 'sti', 'san', 'tic', 've', 'inc', 'llc', 'gmbh', 'co', 'limited', 'şirketi', 'anonim', 'holding']);
/** (additive) Normalized customer name for duplicate detection (case/diacritics/legal suffix-insensitive). */
export function normalizeCustomerName(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/\./g, '')
    .replace(/[,;:()'"&/-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !LEGAL_WORDS.has(w))
    .join(' ')
    .trim();
}

/** Duplicate: same customer (normalized name) + overlapping dates with an open project. */
export function findDuplicates(candidate: { customerName: string | null; startDate: string | null; endDate: string | null }, open: { id: string; code: string; customerName: string | null; startDate: string | null; endDate: string | null }[]): { projectId: string; code: string; reason: string }[] {
  if (!candidate.customerName || !candidate.startDate) return [];
  const name = normalizeCustomerName(candidate.customerName);
  if (!name) return [];
  const cs = candidate.startDate.slice(0, 10);
  const ce = (candidate.endDate ?? candidate.startDate).slice(0, 10);
  const out: { projectId: string; code: string; reason: string }[] = [];
  for (const p of open) {
    if (!p.customerName || !p.startDate) continue;
    if (normalizeCustomerName(p.customerName) !== name) continue;
    const ps = p.startDate.slice(0, 10);
    const pe = (p.endDate ?? p.startDate).slice(0, 10);
    if (cs <= pe && ps <= ce) out.push({ projectId: p.id, code: p.code, reason: `Aynı müşteri (${p.customerName}) için çakışan tarihli açık proje: ${ps} – ${pe}` });
  }
  return out;
}

/** Mark fields with confidence < threshold as needsReview. Returns a new object (input is not mutated). */
export function markLowConfidence(extraction: RequestExtraction, threshold: number): RequestExtraction {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extraction)) {
    if (v && typeof v === 'object' && 'confidence' in v) {
      const ex = v as Extracted<unknown>;
      out[k] = { ...ex, needsReview: ex.confidence < threshold };
    } else out[k] = v;
  }
  return out as unknown as RequestExtraction;
}

/** Assignment suggestion by workload and customer history.
 *  Only sales clerks are considered (admin as fallback when no clerk exists); score = 2 × projects with this customer − open projects. */
export function suggestAssignee(users: { id: string; fullName: string; role: string; openProjects: number; customerProjects: number }[]): { userId: string; fullName: string; reason: string } | null {
  let pool = users.filter((u) => u.role === 'clerk_sales');
  if (!pool.length) pool = users.filter((u) => u.role === 'admin');
  if (!pool.length) return null;
  const scored = pool
    .map((u) => ({ u, score: 2 * (u.customerProjects || 0) - (u.openProjects || 0) }))
    .sort((a, b) => b.score - a.score || a.u.openProjects - b.u.openProjects || a.u.fullName.localeCompare(b.u.fullName, 'tr'));
  const best = scored[0].u;
  const parts: string[] = [];
  if (best.customerProjects > 0) parts.push(`bu müşteriyle ${best.customerProjects} proje geçmişi`);
  parts.push(`${best.openProjects} açık proje`);
  return { userId: best.id, fullName: best.fullName, reason: `Öneri: ${parts.join(', ')}.` };
}
