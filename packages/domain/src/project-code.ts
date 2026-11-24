// §7 Adım 0 Proje kodu: PRJ-####-MÜŞTERİ-TARİH-KİŞİ-TESİS

const TR_MAP: Record<string, string> = { ç: 'C', Ç: 'C', ğ: 'G', Ğ: 'G', ı: 'I', İ: 'I', ö: 'O', Ö: 'O', ş: 'S', Ş: 'S', ü: 'U', Ü: 'U', â: 'A', Â: 'A', î: 'I', Î: 'I', û: 'U', Û: 'U' };

/** e.g. formatProjectCode({prefix:'PRJ', seq:42, customer:'Acme İlaç', date:'2027-03-12', pax:80, venue:'Hilton Bomonti'})
 *  → 'PRJ-0042-ACMEILAC-20270312-80-HILTONBOMONTI'. Turkish chars transliterated, uppercase, non-alnum removed,
 *  customer max 12 chars, venue max 14 chars; unknown parts → 'TBD'. */
export function formatProjectCode(p: { prefix: string; seq: number; customer: string | null; date: string | null; pax: number | null; venue: string | null }): string {
  const prefix = slugTr(p.prefix || 'PRJ') || 'PRJ';
  const seq = Number.isFinite(p.seq) && p.seq >= 0 ? String(Math.trunc(p.seq)).padStart(4, '0') : 'TBD';
  const customer = (p.customer ? slugTr(p.customer) : '').slice(0, 12) || 'TBD';
  const m = p.date ? /^(\d{4})-(\d{2})-(\d{2})/.exec(p.date.trim()) : null;
  const date = m ? `${m[1]}${m[2]}${m[3]}` : 'TBD';
  const pax = p.pax != null && Number.isFinite(p.pax) && p.pax > 0 ? String(Math.round(p.pax)) : 'TBD';
  const venue = (p.venue ? slugTr(p.venue) : '').slice(0, 14) || 'TBD';
  return [prefix, seq, customer, date, pax, venue].join('-');
}

/** Turkish-aware slug: ç→C, ğ→G, ı/İ→I, ö→O, ş→S, ü→U, other diacritics stripped; uppercase A–Z0–9 only. */
export function slugTr(s: string): string {
  return s
    .replace(/[çÇğĞıİöÖşŞüÜâÂîÎûÛ]/g, (ch) => TR_MAP[ch] ?? ch)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Supplier-safe reference (security review G-15, [Ürün kararı] `hideCustomerFromSuppliers`): the project code without the
 *  customer and venue segments — `PRJ-0042-ACME-20270312-80-HILTON` → `PRJ-0042-20270312-80`. A code that does not have the
 *  six-segment shape (legacy / hand-edited) falls back to `<PREFIX>-<SEQ>` so nothing customer-specific can leak. */
export function supplierSafeCode(code: string): string {
  const parts = String(code ?? '').trim().split('-');
  if (parts.length === 6 && /^\d+$/.test(parts[1])) return [parts[0], parts[1], parts[3], parts[4]].join('-');
  const m = /^([A-Za-z0-9]+-\d+)/.exec(String(code ?? '').trim());
  return m ? m[1].toUpperCase() : 'PRJ';
}
