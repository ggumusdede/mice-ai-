// Q5 follow-up: dated FX rates (TCMB) and value-date lookup. Pure: parsing the TCMB daily XML, converting it to the internal
// convention (1 EUR = x <currency>), picking the rate of a value date (weekend / holiday → the last published rate before it) and
// filling movements that were made WITHOUT conversion with that rate. Nothing is guessed: no rate in the window → null.
import type { FxMovement, FxRateType } from '@mice/shared';

export const FX_RATE_TYPES: readonly FxRateType[] = ['tcmb_forex_buying', 'tcmb_forex_selling', 'tcmb_banknote_buying', 'tcmb_banknote_selling'];
export const FX_RATE_TYPE_LABEL: Record<FxRateType, string> = {
  tcmb_forex_buying: 'döviz alış', tcmb_forex_selling: 'döviz satış', tcmb_banknote_buying: 'efektif alış', tcmb_banknote_selling: 'efektif satış',
};
/** How far back a value date may fall back to the last published rate (weekends + long bayram holidays). */
export const FX_LOOKBACK_DAYS = 10;

/** TCMB URL: today.xml or kurlar/YYYYMM/DDMMYYYY.xml */
export function tcmbUrl(date?: string): string {
  if (!date) return 'https://www.tcmb.gov.tr/kurlar/today.xml';
  const [y, m, d] = date.split('-');
  return `https://www.tcmb.gov.tr/kurlar/${y}${m}/${d}${m}${y}.xml`;
}

export interface TcmbCurrency { code: string; unit: number; forexBuying: number | null; forexSelling: number | null; banknoteBuying: number | null; banknoteSelling: number | null }
export interface TcmbDaily { date: string; currencies: TcmbCurrency[] }

const num = (s: string | undefined): number | null => {
  if (!s || !s.trim()) return null;
  const n = Number(s.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Parses TCMB `Tarih_Date` XML (Tarih="22.11.2026" Date="11/22/2026"; values are TRY per `Unit` units of the currency). */
export function parseTcmbXml(xml: string): TcmbDaily {
  const head = /<Tarih_Date\b([^>]*)>/i.exec(xml);
  if (!head) throw new Error('TCMB XML: Tarih_Date bulunamadı');
  const attr = (src: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(src)?.[1];
  let date: string | null = null;
  const tr = attr(head[1], 'Tarih');
  const us = attr(head[1], 'Date');
  if (tr && /^\d{2}\.\d{2}\.\d{4}$/.test(tr)) { const [d, m, y] = tr.split('.'); date = `${y}-${m}-${d}`; }
  else if (us && /^\d{2}\/\d{2}\/\d{4}$/.test(us)) { const [m, d, y] = us.split('/'); date = `${y}-${m}-${d}`; }
  if (!date) throw new Error('TCMB XML: tarih okunamadı');
  const currencies: TcmbCurrency[] = [];
  const re = /<Currency\b([^>]*)>([\s\S]*?)<\/Currency>/gi;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const code = (attr(m[1], 'CurrencyCode') ?? attr(m[1], 'Kod') ?? '').toUpperCase();
    if (!code) continue;
    const tag = (t: string) => new RegExp(`<${t}>([^<]*)</${t}>`, 'i').exec(m![2])?.[1];
    currencies.push({
      code, unit: num(tag('Unit')) ?? 1, forexBuying: num(tag('ForexBuying')), forexSelling: num(tag('ForexSelling')),
      banknoteBuying: num(tag('BanknoteBuying')), banknoteSelling: num(tag('BanknoteSelling')),
    });
  }
  return { date, currencies };
}

const FIELD: Record<FxRateType, keyof Omit<TcmbCurrency, 'code' | 'unit'>> = {
  tcmb_forex_buying: 'forexBuying', tcmb_forex_selling: 'forexSelling', tcmb_banknote_buying: 'banknoteBuying', tcmb_banknote_selling: 'banknoteSelling',
};

/** Internal convention rows: TRY = TRY per 1 EUR; USD / GBP = cross via TRY (1 EUR = x USD) of the same type. */
export function tcmbToEurRates(d: TcmbDaily, currencies: readonly string[] = ['TRY', 'USD', 'GBP']): { currency: string; rateType: FxRateType; rate: number; rateDate: string }[] {
  const eur = d.currencies.find((c) => c.code === 'EUR');
  if (!eur) return [];
  const out: { currency: string; rateType: FxRateType; rate: number; rateDate: string }[] = [];
  for (const t of FX_RATE_TYPES) {
    const eurTry = eur[FIELD[t]] != null ? eur[FIELD[t]]! / eur.unit : null;
    if (eurTry == null) continue;
    for (const cur of currencies) {
      if (cur === 'TRY') { out.push({ currency: 'TRY', rateType: t, rate: round6(eurTry), rateDate: d.date }); continue; }
      const c = d.currencies.find((x) => x.code === cur);
      const cTry = c && c[FIELD[t]] != null ? c[FIELD[t]]! / c.unit : null;
      if (cTry) out.push({ currency: cur, rateType: t, rate: round6(eurTry / cTry), rateDate: d.date });
    }
  }
  return out;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Rate valid on a value date: the rate published for that date, else (weekend / public holiday — TCMB publishes nothing) the last
 * one published before it, at most `lookbackDays` back. null = no rate → evidence gap (never a later or a guessed rate).
 */
export function rateOnValueDate(rows: { rateDate: string; rate: number }[], valueDate: string, lookbackDays = FX_LOOKBACK_DAYS): { rate: number; rateDate: string } | null {
  let best: { rate: number; rateDate: string } | null = null;
  for (const r of rows) {
    if (r.rateDate > valueDate || !(r.rate > 0)) continue;
    if (daysBetween(r.rateDate, valueDate) > lookbackDays) continue;
    if (!best || r.rateDate > best.rateDate) best = { rate: r.rate, rateDate: r.rateDate };
  }
  return best;
}

/**
 * Movements made without conversion (EUR paid / collected in EUR, TRY paid for a TRY invoice …) have no bank rate: their missing
 * rates come from the dated table (one rate type) at the movement's value date — source 'tcmb', note "TCMB <date> <type>".
 * Proven rates (bank-derived, e-Fatura, payment record) are never overwritten.
 */
export function fillRatesFromTable(movements: FxMovement[], table: { currency: string; rateDate: string; rate: number }[], rateType: FxRateType, lookbackDays = FX_LOOKBACK_DAYS): FxMovement[] {
  const by = new Map<string, { rateDate: string; rate: number }[]>();
  for (const r of table) by.set(r.currency, [...(by.get(r.currency) ?? []), r]);
  const pick = (cur: string, date: string) => rateOnValueDate(by.get(cur) ?? [], date, lookbackDays);
  return movements.map((m) => {
    if (!m.date) return m;
    const pos = (v: number | null | undefined) => (v != null && v > 0 ? v : null);
    let eurRate = m.currency === 'EUR' ? 1 : pos(m.eurRate);
    let eurTry = m.currency === 'TRY' ? pos(m.eurTryRate) ?? pos(m.eurRate) : pos(m.eurTryRate);
    if (m.currency === 'TRY') eurRate = eurTry;
    const notes: string[] = [];
    if (eurTry == null) {
      const r = pick('TRY', m.date);
      if (r) { eurTry = r.rate; notes.push(`TCMB ${r.rateDate} ${FX_RATE_TYPE_LABEL[rateType]}`); if (m.currency === 'TRY') eurRate = r.rate; }
    }
    if (eurRate == null && m.currency !== 'TRY') {
      const r = pick(m.currency, m.date);
      if (r) { eurRate = r.rate; notes.push(`TCMB ${r.rateDate} ${FX_RATE_TYPE_LABEL[rateType]} (${m.currency})`); }
    }
    if (!notes.length) return m;
    const proven = m.rateSource !== 'missing' && m.rateSource !== 'currency';
    return {
      ...m, eurRate, eurTryRate: eurTry,
      rateSource: proven ? m.rateSource : 'tcmb',
      rateNote: [m.rateNote, ...notes].filter(Boolean).join(' · '),
    };
  });
}
