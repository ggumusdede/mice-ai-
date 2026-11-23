// v0.5 S-03 (K-11, K-12, K-13) — tedarik çekirdeği: contract rates as comparison anchor, allotment release / attrition penalty
// and pickup, supplier option ranking and expiry cards. Pure, deterministic. The system never releases rooms or drops an option by
// itself (AI forbidden list: allotment_release); these functions only compute what the human decides on.
import type { AllotmentBlock, AllotmentSummary, ContractRate, SupplierOption } from '@mice/shared';
import { round2 } from './pricing.js';

const DAY = 86_400_000;
const d0 = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
/** whole days from `from` to `to` (ISO dates); negative when `to` is earlier */
export function daysUntil(from: string, to: string): number {
  return Math.round((d0(to) - d0(from)) / DAY);
}

// ------------------------------------------------------------------ K-11 contract rates
export interface ContractRateQuery { supplierId: string; kind: string; date: string | null; roomType?: string | null; board?: string | null }

const norm = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase('tr-TR');

/**
 * The active contract rate valid on `date` for supplier × kind; room type / board must match when both sides state them
 * (an unstated room type on the rate = valid for every room type). The most specific match wins, then the latest validFrom.
 */
export interface ContractRateLike { supplierId: string; kind: ContractRate['kind'] | string; roomType: string | null; board: string | null; validFrom: string; validTo: string; status: ContractRate['status'] | string }
export function findContractRate<T extends ContractRateLike>(rates: T[], q: ContractRateQuery): T | null {
  if (!q.date) return null;
  const date = q.date.slice(0, 10);
  let best: { r: T; score: number } | null = null;
  for (const r of rates) {
    if (r.status !== 'active' || r.supplierId !== q.supplierId || r.kind !== q.kind) continue;
    if (date < r.validFrom.slice(0, 10) || date > r.validTo.slice(0, 10)) continue;
    let score = 0;
    if (r.roomType) { if (q.roomType && norm(r.roomType) !== norm(q.roomType)) continue; score += q.roomType ? 2 : 0; }
    if (r.board) { if (q.board && norm(r.board) !== norm(q.board)) continue; score += q.board ? 1 : 0; }
    if (!best || score > best.score || (score === best.score && r.validFrom > best.r.validFrom)) best = { r, score };
  }
  return best?.r ?? null;
}

/** Offer price vs contract price (same basis, same currency): (contract − offer) ÷ contract. + = below contract. */
export function contractAdvantage(contractPrice: number, offerPrice: number | null): number | null {
  if (offerPrice == null || !Number.isFinite(offerPrice) || !(contractPrice > 0)) return null;
  return (contractPrice - offerPrice) / contractPrice;
}

// ------------------------------------------------------------------ K-12 allotment
type Block = Pick<AllotmentBlock, 'dateFrom' | 'dateTo' | 'roomsPerNight' | 'ratePerRoomNight' | 'releaseDate' | 'attritionPct' | 'penaltyPct' | 'releasedRooms' | 'pickup'>;

/** Nights of the block (first night .. last night inclusive). */
export function blockNights(b: Pick<Block, 'dateFrom' | 'dateTo'>): string[] {
  const out: string[] = [];
  for (let t = d0(b.dateFrom); t <= d0(b.dateTo) && out.length < 400; t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Contracted rooms per night after releases (never below 0). */
export function contractedRooms(b: Pick<Block, 'roomsPerNight' | 'releasedRooms'>): number {
  return Math.max(0, b.roomsPerNight - Math.max(0, b.releasedRooms ?? 0));
}

/** Picked-up rooms of a night (capped at the contracted rooms: rooms beyond the block are not block pickup). */
export function pickupOf(b: Block, night: string): number {
  const p = b.pickup.find((x) => x.date.slice(0, 10) === night);
  return Math.min(Math.max(0, p?.rooms ?? 0), contractedRooms(b));
}

/**
 * Attrition penalty (K-12): per night, the tolerated minimum is contracted × (1 − attrition%); each room-night below it is charged
 * at rate × penalty% (block currency). `releasedRooms` lowers the contracted rooms (released before the release date = free).
 */
export function attritionPenalty(b: Block, overrides: { releasedRooms?: number } = {}): { penalty: number; shortfallRoomNights: number } {
  const blk = { ...b, releasedRooms: overrides.releasedRooms ?? b.releasedRooms };
  const contracted = contractedRooms(blk);
  const min = contracted * (1 - Math.min(Math.max(blk.attritionPct ?? 0, 0), 1));
  let shortfall = 0;
  for (const n of blockNights(blk)) shortfall += Math.max(0, min - pickupOf(blk, n));
  const penalty = shortfall * blk.ratePerRoomNight * (blk.penaltyPct ?? 1);
  return { penalty: round2(penalty), shortfallRoomNights: Math.round(shortfall * 100) / 100 };
}

/**
 * Pickup / release summary on `today`. Before the release date the unsold rooms (contracted − max nightly pickup) can be released
 * free of charge → `penaltyIfRelease` assumes they are released now; after the release date the contracted rooms are final.
 */
export function allotmentSummary(b: Block, today: string, warningDays: number): AllotmentSummary {
  const nights = blockNights(b);
  const contracted = contractedRooms(b);
  const picked = nights.reduce((s, n) => s + pickupOf(b, n), 0);
  const contractedRoomNights = contracted * nights.length;
  const daysToRelease = b.releaseDate ? daysUntil(today, b.releaseDate) : null;
  const beforeRelease = daysToRelease != null && daysToRelease >= 0;
  const maxPick = nights.reduce((m, n) => Math.max(m, pickupOf(b, n)), 0);
  const releasableRooms = beforeRelease ? Math.max(0, contracted - maxPick) : 0;
  const hold = attritionPenalty(b).penalty;
  const rel = beforeRelease ? attritionPenalty(b, { releasedRooms: (b.releasedRooms ?? 0) + releasableRooms }).penalty : hold;
  return {
    contractedRoomNights, pickedUpRoomNights: picked,
    pickupPct: contractedRoomNights > 0 ? Math.round((picked / contractedRoomNights) * 1000) / 1000 : 0,
    daysToRelease, releasableRooms, penaltyIfHold: hold, penaltyIfRelease: rel,
    stage: !beforeRelease ? 'after_release' : daysToRelease! <= warningDays ? 'release_window' : 'before_release',
  };
}

/** T-x card: the block is in its release window, there is something to release and the decision is not taken yet. */
export function needsReleaseCard(s: AllotmentSummary): boolean {
  return s.stage === 'release_window' && s.releasableRooms > 0;
}

// ------------------------------------------------------------------ K-13 supplier options
/** Next rank for a new option on the same supplier × service dates: 1 when none active, else 2 (only two ranks are tracked). */
export function nextOptionRank(existing: Pick<SupplierOption, 'rank' | 'status'>[]): 1 | 2 {
  return existing.some((o) => o.rank === 1 && (o.status === 'active' || o.status === 'extension_requested')) ? 2 : 1;
}

/** Customer-facing warning for a 2nd option (another client holds the 1st). */
export function optionRankWarning(rank: 1 | 2): string | null {
  return rank === 2 ? '2. opsiyon: tedarikçide önce gelen bir 1. opsiyon var — kesinleşmesi 1. opsiyonun bırakılmasına bağlı.' : null;
}

/** T-n expiry card ("Uzat / Bırak / Konfirme et"): active option ending within `warningDays` (not yet expired). */
export function optionCardDue(o: Pick<SupplierOption, 'optionUntil' | 'status'>, today: string, warningDays: number): { due: boolean; daysLeft: number } {
  const daysLeft = daysUntil(today, o.optionUntil);
  return { due: (o.status === 'active' || o.status === 'extension_requested') && daysLeft >= 0 && daysLeft <= warningDays, daysLeft };
}

/** An extension must move the date forward. */
export function validateExtension(current: string, next: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return 'Geçersiz tarih';
  return next > current.slice(0, 10) ? null : 'Yeni opsiyon tarihi mevcut tarihten sonra olmalı';
}
