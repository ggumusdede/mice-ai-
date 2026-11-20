// §7 Adım 0 Proje kodu: PRJ-####-MÜŞTERİ-TARİH-KİŞİ-TESİS
import { notImplemented } from './_todo.js';
/** e.g. formatProjectCode({prefix:'PRJ', seq:42, customer:'Acme İlaç', date:'2027-03-12', pax:80, venue:'Hilton Bomonti'})
 *  → 'PRJ-0042-ACMEILAC-20270312-80-HILTONBOMONTI'. Turkish chars transliterated, uppercase, non-alnum removed,
 *  customer max 12 chars, venue max 14 chars; unknown parts → 'TBD'. */
export function formatProjectCode(p: { prefix: string; seq: number; customer: string | null; date: string | null; pax: number | null; venue: string | null }): string { return notImplemented('formatProjectCode'); }
export function slugTr(s: string): string { return notImplemented('slugTr'); }
