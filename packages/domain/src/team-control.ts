// v0.5-A "Ekip, iletişim ve kontrol" — pure rules (no I/O): quiet hours (S-14), escalation chain (S-01), busy-deputy routing
// of deadline-linked cards (S-13), corporate-channel signature (S-02), personal-account check (S-09), quick templates (S-01),
// estimated bonus (S-11), promise-keeping score (S-12), field pack data minimisation (S-15), sales-owner matching (D-3).
import { isBusinessDay, localParts, parseHm, zonedTimeToUtc, type BusinessCalendar } from './business-time.js';
import { slugTr } from './project-code.js';

// ------------------------------------------------------------------ S-14 sessiz saat
export interface QuietHours { enabled: boolean; start: string; end: string }

/** true when `now` (in tz) falls inside the quiet window. Windows may cross midnight (22:00–08:00). */
export function inQuietHours(now: Date, tz: string, qh: QuietHours | null | undefined): boolean {
  if (!qh?.enabled) return false;
  const s = parseHm(qh.start);
  const e = parseHm(qh.end);
  if (s === e) return false;
  const p = localParts(now, tz);
  const m = p.hour * 60 + p.minute;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** The end of the current quiet window (UTC instant) — routine digests wait until then. null when not in quiet hours. */
export function quietHoursEnd(now: Date, tz: string, qh: QuietHours | null | undefined): Date | null {
  if (!inQuietHours(now, tz, qh)) return null;
  const e = parseHm(qh!.end);
  const p = localParts(now, tz);
  const m = p.hour * 60 + p.minute;
  const dayOffset = m < e ? 0 : 1;
  return new Date(zonedTimeToUtc(p.year, p.month, p.day + dayOffset, Math.floor(e / 60), e % 60, tz));
}

/** User setting wins over the agency setting (null = follow the agency). */
export function effectiveQuietHours(agency: QuietHours, user: QuietHours | null | undefined): QuietHours {
  return user ?? agency;
}

// ------------------------------------------------------------------ S-01 eskalasyon zinciri
/** nöbetçi → nöbetçinin vekili → yöneticiler (tekrarsız, boşlar atılır). */
export function escalationChain(input: { first?: string | null; firstDeputy?: string | null; admins: string[] }): string[] {
  const out: string[] = [];
  for (const id of [input.first, input.firstDeputy, ...input.admins]) if (id && !out.includes(id)) out.push(id);
  return out;
}

/** Next assignee after `current` in the chain (null = end of chain: the card stays with the last person, nothing auto). */
export function nextInChain(chain: string[], current: string | null | undefined): string | null {
  if (!chain.length) return null;
  if (!current) return chain[0];
  const i = chain.indexOf(current);
  if (i < 0) return chain[0];
  return chain[i + 1] ?? null;
}

/** Is the card due for escalation? `since` = assignment / last escalation time. minutes ≤ 0 → never. */
export function escalationDue(since: Date, now: Date, minutes: number): boolean {
  return minutes > 0 && now.getTime() - since.getTime() >= minutes * 60_000;
}

// ------------------------------------------------------------------ S-13 meşgul vekâleti (son tarihli kartlar)
export type DeadlineRouting = 'none' | 'notify_approver' | 'route_to_deputy';
/** Deadline-linked card: after waitHours without an answer AND within leadHours of the deadline → first notify the approver
 *  (critical), then (next run) route to the deputy. Never approves anything. */
export function deadlineRouting(input: {
  enabled: boolean; createdAt: Date; deadlineAt: Date | null; now: Date; waitHours: number; leadHours: number; approverNotified: boolean; routed: boolean;
}): DeadlineRouting {
  if (!input.enabled || !input.deadlineAt || input.routed) return 'none';
  const waited = input.now.getTime() - input.createdAt.getTime() >= input.waitHours * 3_600_000;
  const close = input.deadlineAt.getTime() - input.now.getTime() <= input.leadHours * 3_600_000;
  if (!waited || !close) return 'none';
  return input.approverNotified ? 'route_to_deputy' : 'notify_approver';
}

/** Deadline of a card from its detail when the creator did not set one (option expiry, ticket time limit, release date …). */
export function deadlineFromDetail(detail: Record<string, unknown> | null | undefined): string | null {
  if (!detail) return null;
  for (const k of ['deadlineAt', 'optionUntil', 'ticketTimeLimit', 'releaseDate', 'releaseAt', 'nameListDeadline', 'dueAt']) {
    const v = detail[k];
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v))) return v;
  }
  return null;
}

// ------------------------------------------------------------------ S-02 kurumsal WhatsApp / SMS
export function corporateSignature(approverName: string, agencyName: string): string {
  return `— ${approverName.trim()}${agencyName.trim() ? ` · ${agencyName.trim()}` : ''}`;
}
/** Appends the approver's name to a corporate-line message unless it already ends with it (idempotent). */
export function signCorporateMessage(body: string, approverName: string, agencyName: string): string {
  const sig = corporateSignature(approverName, agencyName);
  const trimmed = body.replace(/\s+$/, '');
  if (trimmed.endsWith(sig)) return trimmed;
  return `${trimmed}\n${sig}`;
}
/** A corporate line counts as "the human's address" only when the conversation is assigned to a person and the approver is known. */
export function corporateChannelCheck(input: { assignedUserId: string | null | undefined; approverName: string | null | undefined }): { ok: true } | { ok: false; code: 'CONVERSATION_UNASSIGNED' | 'APPROVER_UNKNOWN'; message: string } {
  if (!input.assignedUserId) return { ok: false, code: 'CONVERSATION_UNASSIGNED', message: 'Kurumsal hattan mesaj için sohbet bir kişiye atanmış olmalı' };
  if (!input.approverName?.trim()) return { ok: false, code: 'APPROVER_UNKNOWN', message: 'Onaylayan kişi bilinmeden kurumsal hattan mesaj gitmez' };
  return { ok: true };
}

/** S-02 / S-26 #8: participant messaging mode check. 'logistics' allows only logistics templates. */
export function participantMessageAllowed(mode: 'off' | 'logistics' | 'on', logistics: boolean): boolean {
  return mode === 'on' || (mode === 'logistics' && logistics);
}

// ------------------------------------------------------------------ S-09 kişisel hesaplar
export const PERSONAL_MAIL_DOMAINS: readonly string[] = [
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.tr', 'outlook.com', 'outlook.com.tr', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.com.tr', 'icloud.com', 'me.com', 'yandex.com', 'yandex.com.tr', 'mynet.com', 'proton.me', 'protonmail.com',
];
export function mailDomain(address: string): string {
  return address.trim().toLowerCase().split('@')[1] ?? '';
}
/** Corporate = not a known personal provider AND (when the agency listed domains) one of them; with no list the login address's
 *  domain counts as corporate. */
export function isCorporateAddress(address: string, opts: { corporateDomains: string[]; loginEmail: string }): boolean {
  const d = mailDomain(address);
  if (!d || PERSONAL_MAIL_DOMAINS.includes(d)) return false;
  const list = opts.corporateDomains.map((x) => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  if (list.length) return list.includes(d);
  return d === mailDomain(opts.loginEmail);
}

// ------------------------------------------------------------------ S-01 hazır şablonlar
/** {{var}} substitution; returns the rendered text and the variables that stayed empty. */
export function renderTemplate(text: string, vars: Record<string, string | number | null | undefined>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined || v === null || String(v).trim() === '') {
      if (!missing.includes(k)) missing.push(k);
      return '';
    }
    return String(v);
  });
  return { text: out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), missing };
}

// ------------------------------------------------------------------ S-11 tahmini prim
export interface BonusFormula { basis: 'realized_profit' | 'planned_profit'; rate: number; onlyCollected: boolean }
/** Simple, transparent: rate × (realized or planned) profit; with onlyCollected only fully collected projects count. Never negative. */
export function estimatedBonus(f: BonusFormula, figures: { realizedProfit: number | null; realizedCollectedProfit: number | null; plannedProfit: number | null }): number | null {
  const base = f.basis === 'planned_profit' ? figures.plannedProfit : f.onlyCollected ? figures.realizedCollectedProfit : figures.realizedProfit;
  if (base == null || !Number.isFinite(base) || !(f.rate >= 0)) return null;
  return Math.round(Math.max(0, base) * f.rate * 100) / 100;
}
export function bonusExplanation(f: BonusFormula): string {
  const basis = f.basis === 'planned_profit' ? 'planlanan kâr' : f.onlyCollected ? 'tahsil edilmiş projelerin gerçekleşen kârı' : 'gerçekleşen kâr';
  return `Tahmini prim = ${basis} × %${Math.round(f.rate * 10_000) / 100}. Bilgi amaçlıdır; kesin prim finans onayıyla belirlenir.`;
}

// ------------------------------------------------------------------ S-12 tedarikçiye söz tutma
/** 0..100: half weight on supplier payments paid by their due date, half on option cards handled before the option date.
 *  null when neither component has data. Agency / project level only — never per person. */
export function promiseKeepingScore(x: { paymentsDue: number; paymentsOnTime: number; optionsDue: number; optionsHandled: number }): number | null {
  const parts: number[] = [];
  if (x.paymentsDue > 0) parts.push(Math.min(1, x.paymentsOnTime / x.paymentsDue));
  if (x.optionsDue > 0) parts.push(Math.min(1, x.optionsHandled / x.optionsDue));
  if (!parts.length) return null;
  return Math.round((parts.reduce((s, v) => s + v, 0) / parts.length) * 100);
}

// ------------------------------------------------------------------ S-15 saha paketi
export interface PackGuestSource { fullName: string | null; roomNo: string | null; transferGroup: string | null; phone: string | null; anonymized: boolean }
/** Data minimisation: name + room + transfer group (+ phone when allowed). A field user restricted to a transfer group only
 *  gets that group. Anonymized guests are dropped. Nothing else (e-mail, passport, birth date, health …) ever leaves. */
export function fieldPackGuests(guests: PackGuestSource[], opts: { includePhone: boolean; onlyGroup: string | null }): { name: string; room: string | null; group: string | null; phone: string | null }[] {
  const g = opts.onlyGroup?.trim().toLowerCase() || null;
  return guests
    .filter((x) => !x.anonymized && x.fullName)
    .filter((x) => !g || (x.transferGroup ?? '').trim().toLowerCase() === g)
    .map((x) => ({ name: x.fullName!, room: x.roomNo ?? null, group: x.transferGroup ?? null, phone: opts.includePhone ? x.phone ?? null : null }))
    .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '', 'tr') || a.name.localeCompare(b.name, 'tr'));
}
/** Pack expiry: start of the pack day (tz) + validHours. */
export function fieldPackExpiry(day: string, tz: string, validHours: number): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(zonedTimeToUtc(y, m, d, 0, 0, tz) + Math.max(1, validHours) * 3_600_000);
}

// ------------------------------------------------------------------ D-3 satış sorumlusu eşleştirme
export interface MatchableUser { id: string; email: string; fullName: string; active?: boolean }
/** Matches the import's "Satış sorumlusu" cell by e-mail (exact, case-insensitive) or by full name (Turkish-insensitive).
 *  Ambiguous names do not match. */
export function matchSalesOwner(value: string | null | undefined, users: MatchableUser[]): { userId: string | null; reason: 'empty' | 'email' | 'name' | 'not_found' | 'ambiguous' } {
  const v = (value ?? '').trim();
  if (!v) return { userId: null, reason: 'empty' };
  if (v.includes('@')) {
    const hit = users.find((u) => u.email.trim().toLowerCase() === v.toLowerCase());
    return hit ? { userId: hit.id, reason: 'email' } : { userId: null, reason: 'not_found' };
  }
  const key = slugTr(v);
  const hits = users.filter((u) => slugTr(u.fullName) === key);
  if (hits.length === 1) return { userId: hits[0].id, reason: 'name' };
  return { userId: null, reason: hits.length > 1 ? 'ambiguous' : 'not_found' };
}

// ------------------------------------------------------------------ S-01 / S-13 kart yönlendirmesiyle karar yetkisi
/** Kinds that may be approved with one tap / in a batch (outbound messages; no biometric gate). */
export const QUICK_APPROVAL_DECISION_KINDS: readonly string[] = ['outbound_message', 'rfq_send', 'negotiation_message'];
/** Governance kinds that stay with the admin whatever the routing (accreditation, rules, automation, checklist). */
const ADMIN_ONLY_KINDS = new Set(['supplier_accreditation', 'automation_promotion', 'automation_demotion', 'rule_suggestion', 'checklist_question', 'low_supplier_score', 'base_currency_change']);

/** A card routed to a person widens who may decide it — never what happens: the decision is still a human one, biometric gates
 *  stay (decide() verifies them), nothing is approved automatically.
 *  - on-call / escalation assignee: one-tap outbound kinds without biometric;
 *  - busy-deputy (S-13): deadline-linked cards, except admin-only governance kinds. */
export function routedDecisionAllowed(card: { kind: string; requiresBiometric: boolean; assignedTo: string | null; deputyId: string | null; deadlineAt: string | Date | null }, userId: string): boolean {
  if (ADMIN_ONLY_KINDS.has(card.kind)) return false;
  if (card.deputyId === userId && card.deadlineAt) return true;
  return card.assignedTo === userId && QUICK_APPROVAL_DECISION_KINDS.includes(card.kind) && !card.requiresBiometric;
}

/** Is `now` inside the agency's business hours (working day, start ≤ t < end, tz)? */
export function withinBusinessHours(now: Date, cal: BusinessCalendar): boolean {
  const p = localParts(now, cal.timezone);
  if (!isBusinessDay(p.year, p.month, p.day, cal)) return false;
  const m = p.hour * 60 + p.minute;
  return m >= parseHm(cal.start) && m < parseHm(cal.end);
}
