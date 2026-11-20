// §7 Adım 1 Kısa liste: önce talep edilen semt, sonra şehir; kapasite uyumu, geçmiş fiyat avantajı, yanıt hızı, performans
import type { Supplier, ServiceKind } from '@mice/shared';
export interface ShortlistRequest { kind: ServiceKind; city: string | null; district: string | null; pax: number | null; rooms: number | null; avgHistoricalAdvantage?: Record<string, number> }

const norm = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase('tr-TR');

/** Filters suppliers of the requested kind in the requested city (passive suppliers excluded) and ranks them:
 *  requested district first, accredited before candidate, then score (capacity fit 0–25 / −30 if insufficient,
 *  historical advantage up to 20, response speed up to 15, performance up to 20). */
export function rankSuppliers(suppliers: Supplier[], req: ShortlistRequest): { supplier: Supplier; score: number; reasons: string[]; sameDistrict: boolean; candidate: boolean }[] {
  const city = norm(req.city);
  const district = norm(req.district);
  const res = suppliers
    .filter((s) => s.status !== 'passive' && s.kinds.includes(req.kind) && (!city || norm(s.city) === city))
    .map((s) => {
      const reasons: string[] = [];
      let score = 0;
      const sameDistrict = !!district && norm(s.district) === district;
      if (sameDistrict) reasons.push('Talep edilen semtte');

      // capacity fit
      const hallMax = Math.max(0, ...s.halls.map((h) => Math.max(h.capacityTheatre ?? 0, h.capacityClassroom ?? 0, h.capacityBanquet ?? 0)));
      const checks: { need: number; have: number | null; label: string }[] = [];
      if (req.pax != null && req.pax > 0) checks.push({ need: req.pax, have: s.capacityPax ?? (hallMax > 0 ? hallMax : null), label: 'kişi' });
      if (req.kind === 'accommodation' && req.rooms != null && req.rooms > 0) checks.push({ need: req.rooms, have: s.roomCount, label: 'oda' });
      if (checks.length) {
        if (checks.some((c) => c.have != null && c.have < c.need)) {
          score -= 30;
          reasons.push('Kapasite yetersiz');
        } else if (checks.every((c) => c.have != null)) {
          score += 25;
          reasons.push('Kapasite uygun');
        } else {
          score += 10;
          reasons.push('Kapasite bilinmiyor');
        }
      }

      const adv = req.avgHistoricalAdvantage?.[s.id];
      if (adv != null && Number.isFinite(adv)) {
        const pts = Math.max(0, Math.min(20, adv * 100));
        score += pts;
        if (pts > 0) reasons.push(`Geçmiş fiyat avantajı %${Math.round(adv * 100)}`);
      }
      if (s.avgResponseHours != null) {
        const pts = s.avgResponseHours <= 4 ? 15 : s.avgResponseHours <= 24 ? 10 : s.avgResponseHours <= 48 ? 5 : 0;
        score += pts;
        if (pts) reasons.push(`Ortalama yanıt ${Math.round(s.avgResponseHours)} saat`);
      }
      if (s.performanceScore != null) {
        score += Math.max(0, Math.min(100, s.performanceScore)) * 0.2;
        reasons.push(`Performans skoru ${s.performanceScore}`);
      }
      const candidate = s.status === 'candidate';
      if (candidate) reasons.push('Aday tedarikçi — akreditasyon gerekli');
      return { supplier: s, score: Math.round(score * 10) / 10, reasons, sameDistrict, candidate };
    });
  res.sort(
    (a, b) =>
      Number(b.sameDistrict) - Number(a.sameDistrict) ||
      Number(a.candidate) - Number(b.candidate) ||
      b.score - a.score ||
      a.supplier.name.localeCompare(b.supplier.name, 'tr'),
  );
  return res;
}
