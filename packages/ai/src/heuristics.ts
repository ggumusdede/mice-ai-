// Deterministic, regex/heuristic document understanding for Turkish MICE agencies (TR first, EN + basic RU).
// Used by MockAiService (dev/test without an API key). No network, no randomness.
import {
  DEFAULT_CONFIDENCE_THRESHOLD, type ContractFields, type Currency, type Extracted, type OfferLine,
  type RequestExtraction, type ServiceKind,
} from '@mice/shared';
import type { ParsedInvoice, ParsedOffer } from './index.js';
import {
  addDays, detectLanguage, findDates, findMoney, firstDate, fold, mean, parseNumber, round2, splitLines, toCurrency,
  type DateMention,
} from './text.js';

// =============================================================================================== helpers
export function ex<T>(value: T | null, confidence: number, source?: string): Extracted<T> {
  const c = value === null ? 0 : Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100;
  const out: Extracted<T> = { value, confidence: c, needsReview: value !== null && c < DEFAULT_CONFIDENCE_THRESHOLD };
  if (source && value !== null) out.source = source.trim().slice(0, 200);
  return out;
}

const NUM_WORDS: Record<string, number> = {
  bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  'один': 1, 'два': 2, 'две': 2, 'три': 3, 'четыре': 4, 'пять': 5,
};
function numOrWord(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  return NUM_WORDS[fold(s)] ?? null;
}

const UPPER_RE = /[A-ZÇĞİÖŞÜА-ЯЁ]/;

// =============================================================================================== locations
const CITIES: { name: string; stems: string[] }[] = [
  { name: 'İstanbul', stems: ['istanbul'] }, { name: 'Ankara', stems: ['ankara'] }, { name: 'İzmir', stems: ['izmir', 'smyrna'] },
  { name: 'Antalya', stems: ['antalya'] }, { name: 'Bursa', stems: ['bursa'] }, { name: 'Muğla', stems: ['mugla'] },
  { name: 'Nevşehir', stems: ['nevsehir'] }, { name: 'Trabzon', stems: ['trabzon'] }, { name: 'Eskişehir', stems: ['eskisehir'] },
  { name: 'Adana', stems: ['adana'] }, { name: 'Gaziantep', stems: ['gaziantep', 'antep'] }, { name: 'Konya', stems: ['konya'] },
  { name: 'Kocaeli', stems: ['kocaeli', 'izmit'] }, { name: 'Sakarya', stems: ['sakarya'] }, { name: 'Bolu', stems: ['bolu'] },
  { name: 'Mersin', stems: ['mersin'] }, { name: 'Kayseri', stems: ['kayseri'] },
  { name: 'Samsun', stems: ['samsun'] }, { name: 'Denizli', stems: ['denizli'] }, { name: 'Edirne', stems: ['edirne'] },
  { name: 'Çanakkale', stems: ['canakkale'] }, { name: 'Rize', stems: ['rize'] }, { name: 'Diyarbakır', stems: ['diyarbakir'] },
  { name: 'Erzurum', stems: ['erzurum'] }, { name: 'Mardin', stems: ['mardin'] }, { name: 'Hatay', stems: ['hatay'] },
  { name: 'Tekirdağ', stems: ['tekirdag'] }, { name: 'Balıkesir', stems: ['balikesir'] }, { name: 'Şanlıurfa', stems: ['sanliurfa', 'urfa'] },
];
const DISTRICTS: { name: string; city: string; stems: string[]; cap?: boolean }[] = [
  // İstanbul
  ...['Kadıköy', 'Beşiktaş', 'Şişli', 'Beyoğlu', 'Sarıyer', 'Ataşehir', 'Üsküdar', 'Bakırköy', 'Maslak', 'Levent', 'Taksim',
    'Nişantaşı', 'Etiler', 'Ortaköy', 'Karaköy', 'Sultanahmet', 'Florya', 'Yeşilköy', 'Pendik', 'Maltepe', 'Ümraniye',
    'Beylikdüzü', 'Esenyurt', 'Başakşehir', 'Bağcılar', 'Zeytinburnu', 'Tuzla', 'Silivri', 'Beykoz', 'Kağıthane', 'Eyüpsultan',
    'Avcılar', 'Küçükçekmece', 'Büyükçekmece', 'Şile', 'Harbiye', 'Kozyatağı', 'Tarabya', 'Kurtköy', 'Sultanahmet', 'Mecidiyeköy',
    'Moda', 'Kartal', 'Fatih', 'Bebek', 'Arnavutköy', 'Çekmeköy', 'Sancaktepe', 'Esenler', 'Güngören', 'Bahçelievler', 'Adalar']
    .map((n) => ({ name: n, city: 'İstanbul', stems: [fold(n)], cap: ['Kartal', 'Fatih', 'Bebek', 'Moda', 'Adalar', 'Levent', 'Tuzla'].includes(n) })),
  // Ankara
  ...['Çankaya', 'Kızılay', 'Ulus', 'Gölbaşı', 'Keçiören', 'Yenimahalle'].map((n) => ({ name: n, city: 'Ankara', stems: [fold(n)], cap: n === 'Ulus' })),
  // İzmir
  ...['Alsancak', 'Konak', 'Çeşme', 'Urla', 'Karşıyaka', 'Bornova', 'Seferihisar', 'Dikili', 'Foça'].map((n) => ({ name: n, city: 'İzmir', stems: [fold(n)], cap: ['Konak', 'Çeşme', 'Urla', 'Foça'].includes(n) })),
  // Antalya
  ...['Belek', 'Lara', 'Kemer', 'Side', 'Alanya', 'Konyaaltı', 'Kundu', 'Kaş', 'Kalkan', 'Manavgat', 'Serik'].map((n) => ({ name: n, city: 'Antalya', stems: [fold(n)], cap: true })),
  // Muğla
  ...['Bodrum', 'Marmaris', 'Fethiye', 'Dalaman', 'Göcek', 'Datça', 'Ölüdeniz'].map((n) => ({ name: n, city: 'Muğla', stems: [fold(n)] })),
  // other resort areas
  { name: 'Kapadokya', city: 'Nevşehir', stems: ['kapadokya', 'cappadocia', 'urgup', 'goreme', 'uchisar'] },
  { name: 'Kuşadası', city: 'Aydın', stems: ['kusadasi'] }, { name: 'Didim', city: 'Aydın', stems: ['didim'] },
  { name: 'Sapanca', city: 'Sakarya', stems: ['sapanca'] }, { name: 'Kartepe', city: 'Kocaeli', stems: ['kartepe'] },
  { name: 'Abant', city: 'Bolu', stems: ['abant'] }, { name: 'Uludağ', city: 'Bursa', stems: ['uludag'] },
  { name: 'Ayvalık', city: 'Balıkesir', stems: ['ayvalik'] }, { name: 'Cunda', city: 'Balıkesir', stems: ['cunda'] },
];

const PLACE_SUFFIXES = new Set(['', 'da', 'de', 'ta', 'te', 'dan', 'den', 'tan', 'ten', 'a', 'e', 'ya', 'ye', 'i', 'u', 'yi', 'yu', 'in', 'un', 'nin', 'nun', 'daki', 'deki', 'taki', 'teki', 'li', 'lu', 'ca', 'ce']);

function findPlace<T extends { name: string; stems: string[]; cap?: boolean }>(text: string, f: string, list: T[]): { item: T; index: number }[] {
  const hits: { item: T; index: number }[] = [];
  for (const item of list) {
    for (const stem of item.stems) {
      const re = new RegExp(`(?<![a-z0-9])${stem}`, 'g');
      for (const m of f.matchAll(re)) {
        const idx = m.index ?? 0;
        // Turkish case suffixes may be written without an apostrophe ("Kadıköyde"); any other tail means another word ("bölüm" ≠ Bolu)
        const tail = f.slice(idx + stem.length).match(/^[a-z]*/)?.[0] ?? '';
        if (!PLACE_SUFFIXES.has(tail)) continue;
        if (item.cap && !UPPER_RE.test(text[idx] ?? '')) continue;
        hits.push({ item, index: idx });
      }
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

// =============================================================================================== request
const EVENT_TYPES: [RegExp, string][] = [
  [/\b(kongre|congress|конгресс)/, 'kongre'],
  [/\b(konferans|conference|summit|zirve|конференц)/, 'konferans'],
  [/\b(lansman|launch|tanitim etkinli)/, 'lansman'],
  [/\b(gala)\b/, 'gala'],
  [/\b(tesvik|incentive|odul gezisi|motivasyon gezisi|инсентив)/, 'teşvik gezisi'],
  [/\b(bayi toplantisi|dealer meeting|bayi)/, 'bayi toplantısı'],
  [/\b(egitim|training|seminer|seminar|workshop|calistay|тренинг|семинар)/, 'eğitim/seminer'],
  [/\b(offsite|off-site|kickoff|kick-off|strateji toplantisi|yonetim kurulu|board meeting)/, 'toplantı (offsite)'],
  [/\b(toplanti|meeting|встреч|совещани)/, 'toplantı'],
  [/\b(dugun|wedding|nisan toreni)/, 'düğün'],
  [/\b(fuar|exhibition|expo|выставк)/, 'fuar'],
  [/\b(yemek|dinner|reception|resepsiyon|kokteyl|cocktail)\b/, 'yemek/davet'],
];

const LAYOUTS: [RegExp, string][] = [
  [/\b(tiyatro|theat(?:er|re)|театр)/, 'tiyatro'],
  [/\b(sinif|classroom|class-room|class room|школ|класс)/, 'sınıf'],
  [/\b(u[ -]?(?:duzen|duzeni|masa|sekl|tipi|shape|shaped|форм)|u-?seklinde|п-образ)/, 'U'],
  [/\b(banket|banquet|yuvarlak masa|round table|cabaret|kabare|банкет)/, 'banket'],
  [/\b(kokteyl duzen|cocktail (?:style|setup|layout)|ayakta|standing|фуршет)/, 'kokteyl'],
  [/\b(boardroom|board room|toplanti masasi|oval masa|переговорн)/, 'boardroom'],
  [/\b(kokteyl|cocktail)/, 'kokteyl'],
];

const FNB: [RegExp, string][] = [
  [/\b(kahvalti|breakfast|завтрак)/, 'kahvaltı'],
  [/\b(ogle yemeg\w*|ogle|lunch|обед)/, 'öğle yemeği'],
  [/\b(aksam yemeg\w*|dinner|ужин)/, 'akşam yemeği'],
  [/\b(gala yemeg\w*|gala dinner)/, 'gala yemeği'],
  [/\b(kokteyl|cocktail|reception|resepsiyon|фуршет)/, 'kokteyl'],
  [/\b(tam pansiyon|full board)\b/, 'tam pansiyon'],
  [/\b(yarim pansiyon|half board)\b/, 'yarım pansiyon'],
  [/\b(her sey dahil|all inclusive)\b/, 'her şey dahil'],
];

const TECH: [RegExp, string][] = [
  [/\b(projeksiyon|projektor|projector|beamer|проектор)/, 'projeksiyon'],
  [/\b(ses sistemi|sound system|seslendirme|pa system|звук)/, 'ses sistemi'],
  [/\b(mikrofon|microphone|микрофон)/, 'mikrofon'],
  [/\b(led ekran|led screen|led wall|led duvar)/, 'LED ekran'],
  [/\b(sahne|stage|сцена)/, 'sahne'],
  [/\b(simultane|simultaneous|tercuman|interpret|синхрон)/, 'simultane çeviri'],
  [/\b(kursu|podium|lectern)/, 'kürsü'],
  [/\b(isik sistemi|isiklandirma|lighting)/, 'ışık'],
  [/\b(flipchart|flip chart)/, 'flipchart'],
  [/\b(wi-?fi|internet)/, 'internet/wifi'],
  [/(?<!led )\b(perde|projection screen|projeksiyon perdesi)\b/, 'perde'],
  [/\b(kayit|recording|canli yayin|streaming|hibrit|hybrid)\b/, 'kayıt/yayın'],
];

function findAll(f: string, list: [RegExp, string][]): { label: string; index: number; raw: string }[] {
  const out: { label: string; index: number; raw: string }[] = [];
  for (const [re, label] of list) {
    const m = re.exec(f);
    if (m && !out.some((o) => o.label === label)) out.push({ label, index: m.index, raw: m[0] });
  }
  return out.sort((a, b) => a.index - b.index);
}

const COMPANY_SUFFIX = "(?:A\\.?\\s?Ş\\.?|AŞ|A\\.S\\.|Ltd\\.?(?:\\s*Şti\\.?)?|Şti\\.?|Inc\\.?|LLC|GmbH|Holding|Group|Grup|İlaç|Ilac|Bank|Bankası|Sigorta|Teknoloji|Otomotiv|Enerji|Pharma|Pharmaceuticals|Limited|Corp\\.?|Co\\.|ООО|АО)";
const COMPANY_RE = new RegExp(`((?:[\\p{Lu}\\d][\\p{L}\\d&'’.-]*\\s+){0,4}[\\p{Lu}\\d][\\p{L}\\d&'’.-]*\\s+${COMPANY_SUFFIX})(?![\\p{L}])`, 'u');

const CLOSINGS = /(saygilarimizla|saygilarimla|saygilar|iyi calismalar|tesekkurler|best regards|kind regards|regards|sincerely|с уважением)/;

function cleanValue(v: string): string {
  return v.split(/\.\s+(?=[A-ZÇĞİÖŞÜ])/)[0].replace(/[\s.,;:]+$/, '').replace(/^[\s:–-]+/, '').trim();
}

/** Extracts labelled values: "Firma: X", "Company: X". Returns first match. */
export function labelled(text: string, labels: string[]): { value: string; index: number } | null {
  const re = new RegExp(`(?:^|[\\n.;]\\s*|\\s)(?:${labels.join('|')})\\s*(?:adı|adi|name|unvanı|ünvanı)?\\s*[:：]\\s*([^\\n;]+)`, 'iu');
  const m = re.exec(text);
  if (!m) return null;
  const value = cleanValue(m[1]);
  return value ? { value, index: m.index } : null;
}

function extractCustomer(text: string, f: string, knownCustomers: string[]): Extracted<string> {
  const lab = labelled(text, ['Firma', 'Şirket', 'Sirket', 'Müşteri', 'Musteri', 'Kurum', 'Company', 'Client', 'Customer', 'Компания', 'Организация']);
  if (lab) return ex(lab.value, 0.92, lab.value);
  for (const k of [...knownCustomers].sort((a, b) => b.length - a.length)) {
    if (k && f.includes(fold(k))) return ex(k, 0.9, k);
  }
  const close = CLOSINGS.exec(f);
  if (close) {
    const tail = text.slice(close.index).split(/\r?\n/).slice(1, 6).map((l) => l.trim()).filter(Boolean);
    const withSuffix = tail.find((l) => COMPANY_RE.test(l));
    if (withSuffix) return ex(cleanValue(COMPANY_RE.exec(withSuffix)![1]), 0.75, withSuffix);
    if (tail.length >= 2 && !/[@\d]/.test(tail[1]) && tail[1].length < 60) return ex(cleanValue(tail[1]), 0.5, tail[1]);
  }
  const any = COMPANY_RE.exec(text);
  if (any) return ex(cleanValue(any[1]), 0.65, any[1]);
  return ex<string>(null, 0);
}

const DECISION_BEFORE = /(karar|donus|yanit|cevap|deadline|decision|respond|reply|en gec|son gun|son tarih|\bby|until|before|opsiyon|option|до)(?:\s+[a-z'’]+){0,2}\W*$/;
const DECISION_AFTER = /^\S{0,6}\s{0,2}(?:tarihine\s+)?(kadar|itibariyle)/;

function classifyDates(text: string, f: string, today: string) {
  const all = findDates(text, today);
  const event: DateMention[] = [];
  const decision: DateMention[] = [];
  for (const d of all) {
    const before = f.slice(Math.max(0, d.index - 45), d.index);
    const after = f.slice(d.index + d.length, d.index + d.length + 25);
    const lastSentence = before.split(/[.!?\n]/).pop() ?? '';
    if (DECISION_BEFORE.test(lastSentence) || DECISION_AFTER.test(after)) decision.push(d);
    else event.push(d);
  }
  return { event, decision };
}

function extractDuration(f: string): { days: number | null; nights: number | null; raw: string | null } {
  const dm = /\b(\d+|bir|iki|uc|dort|bes|one|two|three|four|five)[\s-]*(gunluk|gun|days?|дн\S*|дня)\b/.exec(f)
    ?? /\b(\d+|один|два|три|четыре|пять)[\s-]*(дн\S*)/.exec(f);
  const nm = /\b(\d+|bir|iki|uc|dort|bes|one|two|three|four|five)[\s-]*(gecelik|gece|nights?|ноч\S*)/.exec(f);
  const days = dm ? numOrWord(dm[1]) : null;
  const nights = nm ? numOrWord(nm[1]) : null;
  return { days: days && days < 30 ? days : null, nights: nights && nights < 60 ? nights : null, raw: dm?.[0] ?? nm?.[0] ?? null };
}

export function extractPax(f: string): { value: number | null; confidence: number; raw: string | null } {
  const re = /(?:(yaklasik|yaklasik olarak|civari|around|approx\.?|approximately|about|~|ca\.?|max\.?|maksimum|en fazla|около)\s*)?\b(\d{1,5})\s*(?:-|–|ile)?\s*(\d{1,5})?\s*(?:kisilik|kisi(?!\s*bas)|pax|katilimci|misafir|delege|people|persons|person|guests|participants|attendees|delegates|человек|участник\S*|гост\S*)(?:\s*(civari|civarinda|kadar))?/g;
  const hits: { n: number; approx: boolean; raw: string }[] = [];
  for (const m of f.matchAll(re)) {
    const n = Number(m[3] ?? m[2]);
    if (n <= 0 || n > 20000) continue;
    hits.push({ n, approx: !!m[1] || !!m[3] || !!m[4], raw: m[0] });
  }
  if (!hits.length) return { value: null, confidence: 0, raw: null };
  const distinct = new Set(hits.map((h) => h.n));
  const first = hits[0];
  let c = first.approx ? 0.75 : 0.95;
  if (distinct.size > 1) c = Math.min(c, 0.65);
  return { value: first.n, confidence: c, raw: first.raw };
}

function extractRooms(f: string, kind: 'sgl' | 'dbl'): Extracted<number> {
  const words = kind === 'sgl' ? '(?:sgl|single|tek kisilik|tek yatak|одноместн\\S*)' : '(?:dbl|double|twin|cift kisilik|iki kisilik|двухместн\\S*)';
  const a = new RegExp(`\\b(\\d{1,4})\\s*(?:adet\\s*)?${words}`).exec(f);
  if (a) return ex(Number(a[1]), 0.92, a[0]);
  const b = new RegExp(`${words}\\s*(?:oda|room)?\\s*[:=x×]?\\s*(\\d{1,4})\\b(?!\\s*(?:eur|tl|usd|€|\\$|gece|night))`).exec(f);
  if (b) return ex(Number(b[1]), 0.8, b[0]);
  return ex<number>(null, 0);
}

function extractBudget(text: string, f: string): { budget: Extracted<number>; currency: Extracted<Currency> } {
  const withKw = /(butce|budget|бюджет)[^.\n]{0,40}?/.exec(f);
  const candidates: { amount: number; currency: Currency; conf: number; raw: string }[] = [];
  if (withKw) {
    const seg = text.slice(withKw.index, withKw.index + 80).split(/\.\s|\n/)[0];
    const money = findMoney(seg)[0];
    if (money) candidates.push({ ...money, conf: 0.9, raw: seg.slice(0, money.index + money.length) });
    else {
      const n = /(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(bin|k)?/.exec(fold(seg));
      if (n) {
        const v = (parseNumber(n[1]) ?? 0) * (n[2] ? 1000 : 1);
        if (v > 0) candidates.push({ amount: v, currency: null as unknown as Currency, conf: 0.7, raw: seg.slice(0, (n.index ?? 0) + n[0].length) });
      }
    }
  }
  if (!candidates.length) {
    const pp = /(kisi basi|kisi basina|per person|per pax|\bpp\b|на человека)/.exec(f);
    if (pp) {
      const seg = text.slice(Math.max(0, pp.index - 25), pp.index + 40);
      const money = findMoney(seg)[0];
      if (money) candidates.push({ ...money, conf: 0.7, raw: seg.trim() });
    }
  }
  const c = candidates[0];
  if (!c) return { budget: ex<number>(null, 0), currency: ex<Currency>(null, 0) };
  const perPerson = /(kisi basi|kisi basina|per person|per pax|\bpp\b|на человека)/.test(fold(c.raw));
  const source = perPerson ? `kişi başı: ${c.raw}` : c.raw;
  return {
    budget: ex(c.amount, c.conf, source),
    currency: c.currency ? ex(c.currency, 0.95, c.raw) : ex<Currency>(null, 0),
  };
}

/** true when an extracted budget was stated per person (mock and Claude both mark this in `budget.source`). */
export function budgetIsPerPerson(b: Extracted<number>): boolean {
  return !!b.source && /^(kişi başı|per person)/i.test(b.source);
}

function sentenceAround(text: string, index: number, max = 90): string {
  const start = Math.max(text.lastIndexOf('.', index) + 1, text.lastIndexOf(',', index) + 1, text.lastIndexOf('\n', index) + 1, 0);
  const rest = text.slice(index);
  const endRel = rest.search(/[.,;\n]/);
  const end = endRel < 0 ? text.length : index + endRel;
  return text.slice(start, end).trim().slice(0, max);
}

export function heuristicExtractRequest(text: string, opts: { today: string; knownCustomers?: string[] }): RequestExtraction {
  const f = fold(text);
  const language = detectLanguage(text);
  /** maps a snippet of the folded text back to the original spelling (fold() is length-preserving) */
  const orig = (raw: string | null | undefined): string | undefined => {
    if (!raw) return undefined;
    const i = f.indexOf(raw);
    return i < 0 ? raw : text.slice(i, i + raw.length);
  };

  // --- dates
  const { event, decision } = classifyDates(text, f, opts.today);
  const dur = extractDuration(f);
  let startDate = ex<string>(null, 0);
  let endDate = ex<string>(null, 0);
  let dateFlex = ex<string>(null, 0);
  if (event.length) {
    const d = event[0];
    const yearC = d.explicitYear ? 0 : 0.08;
    const distinct = new Set(event.map((e) => `${e.start}/${e.end}`));
    const multi = distinct.size > 1 ? 0.2 : 0;
    startDate = ex(d.start, 0.95 - yearC - multi, d.raw);
    if (d.end) endDate = ex(d.end, 0.95 - yearC - multi, d.raw);
    else if (dur.days) endDate = ex(addDays(d.start, dur.days - 1), 0.8 - yearC, `${d.raw} + ${dur.raw}`);
    else if (dur.nights) endDate = ex(addDays(d.start, dur.nights), 0.75 - yearC, `${d.raw} + ${dur.raw}`);
    if (distinct.size > 1) dateFlex = ex(`alternatif tarihler: ${event.map((e) => e.raw).join(' / ')}`, 0.7, event.map((e) => e.raw).join(' / '));
  }
  const flex = /(esnek|flexible|flexibility|alternatif tarih|alternative date|\+\/-|±|tarih(?:ler)? degisebilir|dates? (?:can|may) (?:change|shift)|veya bir sonraki hafta|гибк)/.exec(f);
  if (flex) dateFlex = ex(sentenceAround(text, flex.index), 0.8, sentenceAround(text, flex.index));
  else if (!event.length) {
    const vague = /\b(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|january|february|march|april|may|june|july|august|september|october|november|december)\w*\s+(ayi|basi|ortasi|sonu|month|icinde|başı)/.exec(f);
    if (vague) dateFlex = ex(text.slice(vague.index, vague.index + vague[0].length), 0.6, vague[0]);
  }
  const decisionDate = decision.length ? ex(decision[0].start, 0.8, decision[0].raw) : ex<string>(null, 0);

  // --- pax & rooms
  const pax = extractPax(f);
  const roomsSgl = extractRooms(f, 'sgl');
  const roomsDbl = extractRooms(f, 'dbl');

  // --- location
  const districts = findPlace(text, f, DISTRICTS);
  const cities = findPlace(text, f, CITIES);
  let city = ex<string>(null, 0);
  let district = ex<string>(null, 0);
  const distinctDistricts = [...new Set(districts.map((d) => d.item.name))];
  const distinctCities = [...new Set(cities.map((c) => c.item.name))];
  if (districts.length) {
    const d = districts[0].item;
    district = ex(d.name, distinctDistricts.length > 1 ? 0.65 : 0.92, text.slice(districts[0].index).match(/^[\p{L}'’]+/u)?.[0]);
    const explicit = cities.find((c) => c.item.name === d.city);
    city = ex(d.city, explicit ? 0.95 : 0.85, explicit ? explicit.item.name : `${d.name} → ${d.city}`);
  } else if (cities.length) {
    city = ex(cities[0].item.name, distinctCities.length > 1 ? 0.6 : 0.9, cities[0].item.name);
  }

  // --- layout / fnb / technical / transfer
  const layouts = findAll(f, LAYOUTS).filter((l, i, a) => !(l.label === 'kokteyl' && a.some((x) => x.label !== 'kokteyl')));
  let hallLayout = ex<string>(null, 0);
  if (layouts.length) {
    const near = /(duzen|setup|layout|oturma|seating|salon|hall|room|расстановк|зал)/.test(f.slice(Math.max(0, layouts[0].index - 25), layouts[0].index + 30));
    hallLayout = ex(layouts[0].label, (near ? 0.9 : 0.72) - (new Set(layouts.map((l) => l.label)).size > 1 ? 0.15 : 0), sentenceAround(text, layouts[0].index));
  }
  const fnbHits = findAll(f, FNB);
  const cb = /\b(?:(\d+|bir|iki|uc|one|two|three)\s*(?:adet\s*)?)?(coffee ?breaks?|kahve aras\w*|kahve molas\w*|кофе-?брейк\S*)/.exec(f);
  const fnbParts = fnbHits.map((h) => h.label);
  if (cb) fnbParts.push(`${cb[1] ? `${numOrWord(cb[1]) ?? cb[1]} ` : ''}coffee break`);
  const fnb = fnbParts.length ? ex(fnbParts.join(', '), 0.85, fnbParts.join(', ')) : ex<string>(null, 0);
  const techHits = findAll(f, TECH);
  const technical = techHits.length ? ex(techHits.map((t) => t.label).join(', '), 0.85, techHits.map((t) => orig(t.raw)).join(', ')) : ex<string>(null, 0);
  const tr = /(havalimani transfer\w*|havaalani transfer\w*|airport transfers?|transfer\w*|shuttle|servis aracı|trasfer|трансфер\S*)/.exec(f);
  const transfer = tr ? ex(sentenceAround(text, tr.index, 80), 0.85, sentenceAround(text, tr.index, 80)) : ex<string>(null, 0);

  // --- budget, customer, event type, billing
  const { budget, currency } = extractBudget(text, f);
  const customerName = extractCustomer(text, f, opts.knownCustomers ?? []);
  const types = findAll(f, EVENT_TYPES);
  const eventType = types.length ? ex(types[0].label, types.length > 2 ? 0.75 : 0.88, orig(types[0].raw)) : ex<string>(null, 0);
  const bill = /(fatura bilgi\w*|fatura adres\w*|fatura\s*:|vergi dairesi|vergi no|vkn|tax office|tax (?:id|no|number)|billing|invoice to|инн)/.exec(f);
  let billingInfo = ex<string>(null, 0);
  if (bill) {
    const lineStart = text.lastIndexOf('\n', bill.index) + 1;
    const lineEnd = text.indexOf('\n', bill.index);
    const line = text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim();
    billingInfo = ex(line.slice(0, 200), 0.8, line);
  }

  return {
    customerName, eventType, startDate, endDate, dateFlexibility: dateFlex, pax: ex(pax.value, pax.confidence, orig(pax.raw)),
    roomsSgl, roomsDbl, city, district, hallLayout, fnb, technical, transfer, budget, budgetCurrency: currency,
    decisionDate, billingInfo, language,
  };
}

/** Fields that make up the RFQ minimum (§7 Adım 0) plus the customer — used for the overall confidence. */
const CORE_FIELDS = ['customerName', 'startDate', 'pax', 'location', 'rooms', 'hallLayout', 'budget'] as const;

/**
 * Overall confidence of a RequestExtraction: mean confidence of the core fields that were FOUND (a missing field is
 * "missing info", handled by the checklist — not low reading confidence), discounted when neither date nor pax was
 * found (likely not a request at all). Nothing found → 0.1.
 */
export function requestExtractionConfidence(r: RequestExtraction): number {
  const conf: Record<(typeof CORE_FIELDS)[number], number | null> = {
    customerName: r.customerName.value !== null ? r.customerName.confidence : null,
    startDate: r.startDate.value !== null ? r.startDate.confidence : null,
    pax: r.pax.value !== null ? r.pax.confidence : null,
    location: r.city.value !== null || r.district.value !== null ? Math.max(r.city.confidence, r.district.confidence) : null,
    rooms: r.roomsSgl.value !== null || r.roomsDbl.value !== null ? Math.max(r.roomsSgl.confidence, r.roomsDbl.confidence) : null,
    hallLayout: r.hallLayout.value !== null ? r.hallLayout.confidence : null,
    budget: r.budget.value !== null ? r.budget.confidence : null,
  };
  const present = Object.values(conf).filter((c): c is number => c !== null);
  if (!present.length) return 0.1;
  let c = mean(present);
  if (conf.startDate === null && conf.pax === null) c *= 0.6;
  return round2(c);
}

// =============================================================================================== offers
const KIND_RULES: [RegExp, ServiceKind][] = [
  [/(toplanti odasi|toplanti salonu|meeting room|salon|\bhall\b|foyer|fuaye|ballroom|balo|конференц-?зал|\bзал)/, 'hall'],
  [/(\boda\b|odalar|\broom|konaklama|accommodation|\bsgl\b|\bdbl\b|\btwin\b|\btrp\b|single|double|\bsuite?\b|geceleme|номер|прожив)/, 'accommodation'],
  [/(coffee|kahve|ogle|lunch|aksam yemeg|dinner|kahvalti|breakfast|yemek|menu|gala|kokteyl|cocktail|icecek|beverage|f&b|ikram|catering|кофе|обед|ужин)/, 'fnb'],
  [/(transfer|arac|vito|otobus|minibus|midibus|\bbus\b|shuttle|vehicle|sprinter|трансфер)/, 'transfer'],
  [/(projeksiyon|projektor|projector|ses sistem|sound|mikrofon|microphone|\bled\b|teknik|technical|sahne|stage|isik|lighting|simultane|\bav\b|ekran)/, 'technical'],
  [/(tur\b|turu|aktivite|activity|tour|rehber|guide|workshop|team ?building|экскурс)/, 'activity'],
  [/(bilet|ticket|ucak|flight|ucus|билет)/, 'ticket'],
];
export function classifyKind(fLine: string): ServiceKind {
  for (const [re, k] of KIND_RULES) if (re.test(fLine)) return k;
  return 'other';
}

const DEFAULT_VAT: Record<ServiceKind, number> = { accommodation: 10, hall: 20, fnb: 10, transfer: 20, technical: 20, activity: 20, ticket: 20, other: 20 };

const TERM_LINE = /(iptal|cancel|odeme|payment|opsiyon|option|on odeme|deposit|kapora|depozito|attrition|garanti|guarantee|vade|ceza|penalty|no.?show)/;
const TOTAL_LINE = /^(\W*)(genel toplam|ara toplam|toplam|total|grand total|sub-?total|итого)/;

interface LineParse { line: OfferLine; confidence: number }

function vatOf(f: string): boolean | null {
  if (/(kdv\s*(dahil|dâhil|included)|vat\s*incl\w*|incl\w*\.?\s*vat|including vat|vergiler dahil|ндс включ)/.test(f)) return true;
  if (/(kdv\s*(haric|hariçtir|haricdir|ayrica|ilave)|\+\s*kdv|vat\s*excl\w*|excl\w*\.?\s*vat|excluding vat|plus vat|\+\s*vat|без ндс)/.test(f)) return false;
  return null;
}
function vatRateOf(f: string): number | null {
  const m = /%\s*(\d{1,2})\s*(?:kdv|vat)|(?:kdv|vat)\s*(?:orani)?\s*[:(]?\s*%\s*(\d{1,2})|(\d{1,2})\s*%\s*(?:kdv|vat)/.exec(f);
  return m ? Number(m[1] ?? m[2] ?? m[3]) : null;
}

function parsePriceLine(raw: string, ctx: { docVat: boolean | null; docVatRate: number | null; docPax: number | null; docNights: number | null }): LineParse | null {
  const f = fold(raw);
  if (TOTAL_LINE.test(f)) return null;
  const money = findMoney(raw);
  if (!money.length) return null;
  if (TERM_LINE.test(f) && !/(oda|room|salon|coffee|yemek|transfer)/.test(f.split(/[:]/)[0])) return null;
  const price = money[0];
  // strip money, percents and dates before looking for multiplicative factors
  let rest = f;
  for (const m of money) rest = rest.slice(0, m.index) + ' '.repeat(m.length) + rest.slice(m.index + m.length);
  rest = rest.replace(/%\s*\d+|\d+\s*%/g, ' ').replace(/\d{1,2}[./]\d{1,2}[./]\d{2,4}/g, ' ');

  const kind = classifyKind(f);
  const factors: { n: number; unit: string }[] = [];
  const unitRe = /(?:(?:x|×|\*)\s*)?(\d{1,5})\s*(oda|rooms?|gece|nights?|kisi|pax|persons?|people|katilimci|gun|days?|adet|pcs|pieces?|arac|vehicles?|saat|hours?|sgl|dbl|twin|trp|single|double|ogun|номер\S*|ноч\S*|чел\S*|дн\S*)?\b/g;
  for (const m of rest.matchAll(unitRe)) {
    const hasX = /^(x|×|\*)/.test(m[0]);
    const n = Number(m[1]);
    let unit = m[2] ?? '';
    if (!unit && !hasX) continue;
    if (/^(oda|room|sgl|dbl|twin|trp|single|double|номер)/.test(unit)) unit = 'oda';
    else if (/^(gece|night|ноч)/.test(unit)) unit = 'gece';
    else if (/^(kisi|pax|person|people|katilimci|чел)/.test(unit)) unit = 'kişi';
    else if (/^(gun|day|дн)/.test(unit)) unit = 'gün';
    else if (/^(arac|vehicle)/.test(unit)) unit = 'araç';
    else if (/^(saat|hour)/.test(unit)) unit = 'saat';
    else unit = 'adet';
    if (n > 0) factors.push({ n, unit });
  }
  const perPerson = /(kisi basi|kisi basina|per person|per pax|\bpp\b|\/\s*kisi|\/\s*pax|\/\s*person|kisilik fiyat|на человека)/.test(f);
  const roomType = /\b(sgl|dbl|twin|trp|single|double|triple|suite)\b/.exec(f)?.[1]?.toUpperCase()
    .replace('SINGLE', 'SGL').replace('DOUBLE', 'DBL').replace('TRIPLE', 'TRP') ?? undefined;
  const board = /\b(bb|hb|fb|ai|ro|uai)\b/.exec(f)?.[1]?.toUpperCase()
    ?? (/(oda kahvalti|bed (?:and|&) breakfast)/.test(f) ? 'BB' : /(yarim pansiyon|half board)/.test(f) ? 'HB' : /(tam pansiyon|full board)/.test(f) ? 'FB' : /(her sey dahil|all inclusive)/.test(f) ? 'AI' : undefined);

  let conf = 0.9;
  let quantity = 1;
  let unit = 'adet';
  let nights: number | undefined;
  if (kind === 'accommodation') {
    unit = 'oda';
    const rooms = factors.find((x) => x.unit === 'oda');
    const ni = factors.find((x) => x.unit === 'gece');
    quantity = rooms?.n ?? 1;
    if (!rooms) conf -= 0.25;
    nights = ni?.n ?? ctx.docNights ?? 1;
    if (!ni) conf -= ctx.docNights ? 0.1 : 0.25;
  } else {
    const nonNight = factors.filter((x) => x.unit !== 'gece');
    quantity = nonNight.reduce((a, b) => a * b.n, 1);
    unit = perPerson ? 'kişi' : nonNight[0]?.unit ?? (kind === 'hall' && /(gunluk|per day|\/\s*gun)/.test(f) ? 'gün' : 'adet');
    if (perPerson && !nonNight.some((x) => x.unit === 'kişi')) {
      if (ctx.docPax) { quantity *= ctx.docPax; conf -= 0.15; } else conf -= 0.35;
    }
    const ni = factors.find((x) => x.unit === 'gece');
    if (ni) quantity *= ni.n;
  }
  const lineVat = vatOf(f);
  const vatIncluded = lineVat ?? ctx.docVat ?? false;
  if (lineVat === null && ctx.docVat === null) conf -= 0.1;
  const vatRate = vatRateOf(f) ?? ctx.docVatRate ?? DEFAULT_VAT[kind];

  let description = raw.includes(':') ? raw.split(':')[0] : raw.slice(0, Math.max(0, price.index)).replace(/(kişi başı|kişi başına|per person)\s*$/i, '');
  description = description.replace(/^[\s\-–•*·\d.)]+(?=\D)/, '').replace(/[\s:–-]+$/, '').trim() || raw.trim().slice(0, 60);

  const line: OfferLine = { description, kind, quantity, unit, unitPrice: price.amount, vatIncluded, vatRate };
  if (nights !== undefined) line.nights = nights;
  if (roomType) line.roomType = roomType;
  if (board) line.board = board;
  if (kind === 'accommodation') {
    const fAll = f;
    if (/konaklama vergisi\s*(dahil|dâhil|included)/.test(fAll)) line.accommodationTaxIncluded = true;
    else if (/konaklama vergisi\s*(haric|ayrica|ilave|excluded)|\+\s*konaklama vergisi/.test(fAll)) line.accommodationTaxIncluded = false;
  }
  return { line, confidence: Math.max(0.3, round2(conf)) };
}

function linesMatching(lines: string[], re: RegExp): string[] {
  return lines.filter((l) => re.test(fold(l)));
}

function supplierNameFrom(text: string, lines: string[]): { value: string | null; c: number } {
  const lab = labelled(text, ['Otel', 'Hotel', 'Tesis', 'Tedarikçi', 'Tedarikci', 'Supplier', 'Gönderen', 'Gonderen', 'From', 'Firma', 'Satıcı', 'Satici', 'Отель', 'Поставщик']);
  if (lab && !/@/.test(lab.value)) return { value: lab.value, c: 0.85 };
  const venue = lines.find((l) => l.length < 70 && !findMoney(l).length && /\b(otel|hotel|resort|palace|suites|convention|kongre merkezi|turizm|tourism|a\.?s\.?|ltd|sti|transfer hizmetleri|catering|organizasyon)\b/.test(fold(l)));
  if (venue) return { value: cleanValue(venue.replace(/^(saygılarımızla|regards)[,\s]*/i, '')), c: 0.65 };
  const close = CLOSINGS.exec(fold(text));
  if (close) {
    const tail = text.slice(close.index).split(/\r?\n/).slice(1, 5).map((l) => l.trim()).filter(Boolean);
    const comp = tail.find((l) => COMPANY_RE.test(l));
    if (comp) return { value: cleanValue(comp), c: 0.6 };
  }
  return { value: null, c: 0 };
}

interface CommonTerms {
  currency: Currency | null; currencyC: number;
  optionUntil: string | null; guaranteePax: number | null; attritionTerms: string | null; paymentTerms: string | null;
  prepaymentRate: number | null; cancellationTerms: string | null; overtimeTerms: string | null; notes: string | null;
  docVat: boolean | null; docPax: number | null; docNights: number | null;
}

function commonTerms(text: string, today: string): CommonTerms {
  const f = fold(text);
  const lines = splitLines(text);
  const money = findMoney(text);
  const counts = new Map<Currency, number>();
  for (const m of money) counts.set(m.currency, (counts.get(m.currency) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const currency = sorted[0]?.[0] ?? null;
  const currencyC = !currency ? 0 : sorted.length === 1 ? 0.95 : 0.7;

  const optLine = linesMatching(lines, /(opsiyon|option|hold until|bloke|blokaj)/)[0];
  const optionUntil = optLine ? firstDate(optLine, today) : null;
  const g = /(?:garanti\w*|guarantee\w*|minimum|min\.)[^\d\n]{0,25}(\d{1,5})\s*(?:kisi|pax|person|katilimci)?|(\d{1,5})\s*(?:kisi|pax)\s*garanti/.exec(f);
  const guaranteePax = g ? Number(g[1] ?? g[2]) : null;
  const pre = /%\s*(\d{1,3})\s*(?:oraninda\s*)?(?:on ?odeme|pesin|kapora|depozito|deposit|prepayment|advance|avans)|(?:on ?odeme|pesin|kapora|depozito|deposit|prepayment|advance|avans)[^%\d\n]{0,30}%\s*(\d{1,3})|(\d{1,3})\s*%\s*(?:on ?odeme|deposit|prepayment|advance|pesin)/.exec(f);
  const prepaymentRate = pre ? Math.min(1, Number(pre[1] ?? pre[2] ?? pre[3]) / 100) : null;
  const join = (xs: string[]) => (xs.length ? xs.join(' ').slice(0, 500) : null);
  const paymentTerms = join(linesMatching(lines, /(odeme|payment|vade|pesin|kapora|depozito|deposit|avans|advance|havale|\beft\b|оплат)/));
  const cancellationTerms = join(linesMatching(lines, /(iptal|cancel|no.?show|отмен)/));
  const attritionTerms = join(linesMatching(lines, /(attrition|release|kisi sayisi.{0,30}(dus|azal)|reduction|azaltma|dusurul)/));
  const overtimeTerms = join(linesMatching(lines, /(fazla mesai|mesai|overtime|ek saat|extra hour|uzatma|saat \d{1,2}[:.]\d{2}.{0,20}sonra|after \d{1,2}[:.]?\d{0,2}\s*(?:pm|am)?)/));
  const notes = join(lines.filter((l) => /^(not|note|nb|n\.b\.|önemli|onemli)\s*[:：]/i.test(l)));
  const pm = extractPax(f);
  const nm = /\b(\d{1,2})\s*(gece|nights?)\b/.exec(f);
  return {
    currency, currencyC, optionUntil, guaranteePax, attritionTerms, paymentTerms, prepaymentRate, cancellationTerms,
    overtimeTerms, notes, docVat: vatOf(f), docPax: pm.value ?? guaranteePax, docNights: nm ? Number(nm[1]) : null,
  };
}

export function heuristicParseOffer(text: string, today: string, itemKind?: string): ParsedOffer {
  const lines = splitLines(text);
  const t = commonTerms(text, today);
  const f = fold(text);
  const docVatRate = /(fiyatlar|tum fiyat|all prices)/.test(f) ? vatRateOf(f) : null;
  const parsed: LineParse[] = [];
  for (const l of lines) {
    const p = parsePriceLine(l, { docVat: t.docVat, docVatRate, docPax: t.docPax, docNights: t.docNights });
    if (p) {
      if (itemKind && p.line.kind === 'other' && (KIND_LIST as string[]).includes(itemKind)) p.line.kind = itemKind as ServiceKind;
      parsed.push(p);
    }
  }
  // keep only lines in the dominant currency (others are usually FX notes / totals in another currency)
  const sup = supplierNameFrom(text, lines);
  const fc: Record<string, number> = {
    supplierName: sup.c,
    currency: t.currencyC,
    lines: parsed.length ? round2(mean(parsed.map((p) => p.confidence))) : 0,
    vat: t.docVat !== null ? 0.9 : parsed.length ? 0.5 : 0,
    optionUntil: t.optionUntil ? 0.85 : 0,
    guaranteePax: t.guaranteePax !== null ? 0.8 : 0,
    attritionTerms: t.attritionTerms ? 0.75 : 0,
    paymentTerms: t.paymentTerms ? 0.8 : 0,
    prepaymentRate: t.prepaymentRate !== null ? 0.9 : 0,
    cancellationTerms: t.cancellationTerms ? 0.8 : 0,
    overtimeTerms: t.overtimeTerms ? 0.7 : 0,
  };
  return {
    supplierName: sup.value, currency: t.currency, lines: parsed.map((p) => p.line), optionUntil: t.optionUntil,
    guaranteePax: t.guaranteePax, attritionTerms: t.attritionTerms, paymentTerms: t.paymentTerms, prepaymentRate: t.prepaymentRate,
    cancellationTerms: t.cancellationTerms, overtimeTerms: t.overtimeTerms, notes: t.notes, fieldConfidence: fc,
  };
}
const KIND_LIST: ServiceKind[] = ['accommodation', 'hall', 'fnb', 'transfer', 'technical', 'activity', 'ticket', 'other'];

/** Overall offer confidence: mean of the always-relevant fields (lines, currency, VAT) and every other field found. */
export function offerConfidence(o: Pick<ParsedOffer, 'lines' | 'fieldConfidence'>): number {
  const fc = o.fieldConfidence;
  const core = ['lines', 'currency', 'vat'].map((k) => fc[k] ?? 0);
  const extra = Object.entries(fc).filter(([k, v]) => !['lines', 'currency', 'vat'].includes(k) && v > 0).map(([, v]) => v);
  let c = mean([...core, ...extra]);
  if (!o.lines.length) c = Math.min(c, 0.3);
  return round2(c);
}

// =============================================================================================== contracts
export function heuristicParseContract(text: string, today: string): { fields: ContractFields; fieldConfidence: Record<string, number> } {
  const lines = splitLines(text);
  const f = fold(text);
  const t = commonTerms(text, today);
  const docVatRate = vatRateOf(f);
  const parsed = lines.map((l) => parsePriceLine(l, { docVat: t.docVat, docVatRate, docPax: t.docPax, docNights: t.docNights })).filter((p): p is LineParse => !!p);
  const supplierLab = labelled(text, ['Otel', 'Hotel', 'Tesis', 'Konaklama Tesisi', 'Tedarikçi', 'Tedarikci', 'Supplier', 'Satıcı', 'Hizmet Veren', 'Отель']);
  const supplier = supplierLab ? { value: supplierLab.value, c: 0.88 } : supplierNameFrom(text, lines);
  const customerLab = labelled(text, ['Müşteri', 'Musteri', 'Kurum', 'Firma', 'Grup Adı', 'Grup', 'Group Name', 'Group', 'Client', 'Customer', 'Etkinlik Sahibi', 'Заказчик']);

  // dates: explicit check-in/out labels, else first range not in a term context
  const ci = /(giris|check-?in|arrival|baslangic|etkinlik tarihi|event date)[^\n\d]{0,20}/.exec(f);
  const co = /(cikis|check-?out|departure|bitis)[^\n\d]{0,20}/.exec(f);
  let startDate: string | null = ci ? firstDate(text.slice(ci.index, ci.index + 60), today) : null;
  let endDate: string | null = co ? firstDate(text.slice(co.index, co.index + 60), today) : null;
  if (!startDate) {
    const { event } = classifyDates(text, f, today);
    const ev = event.find((d) => !TERM_LINE.test(f.slice(Math.max(0, d.index - 40), d.index)));
    if (ev) { startDate = ev.start; endDate = endDate ?? ev.end; }
  }
  const paxM = /\b(\d{1,5})\s*(kisi|pax|katilimci|people|persons)(?!\s*bas)/.exec(f.replace(/garanti\w*[^\d\n]{0,25}\d+/g, ' '));
  const rooms = parsed.filter((p) => p.line.kind === 'accommodation').map((p) => ({
    type: p.line.roomType ?? p.line.description, count: p.line.quantity, nights: p.line.nights ?? 1, unitPrice: p.line.unitPrice,
  }));
  const unitPrices = parsed.filter((p) => p.line.kind !== 'accommodation').map((p) => ({ description: p.line.description, unitPrice: p.line.unitPrice, quantity: p.line.quantity }));
  const menuLine = lines.find((l) => /(menu|menü|yemek listesi)/.test(fold(l)));
  const hallLine = lines.find((l) => /(salon|hall|toplanti odasi|meeting room)/.test(fold(l)));
  const totalLine = lines.find((l) => /(genel toplam|toplam tutar|sozlesme bedeli|total amount|grand total|^\W*toplam|^\W*total)/.test(fold(l)) && findMoney(l).length);
  const totalAmount = totalLine ? findMoney(totalLine).at(-1)!.amount : null;
  const billing = linesMatching(lines, /(fatura|vergi dairesi|\bvkn\b|tax office|tax (id|no)|billing)/);
  let accTaxSep: boolean | null = null;
  if (/konaklama vergisi\s*(haric|ayrica|ilave|ayrıca)|\+\s*konaklama vergisi|accommodation tax\s*(excl|not incl)/.test(f)) accTaxSep = true;
  else if (/konaklama vergisi\s*(dahil|dâhil)|accommodation tax\s*incl/.test(f)) accTaxSep = false;

  const fields: ContractFields = {
    supplierName: supplier.value,
    customerName: customerLab?.value ?? null,
    billingInfo: billing.length ? billing.join(' ').slice(0, 300) : null,
    startDate, endDate,
    pax: paxM ? Number(paxM[1]) : null,
    guaranteePax: t.guaranteePax,
    rooms, menu: menuLine ? menuLine.slice(0, 300) : null, hall: hallLine ? hallLine.slice(0, 200) : null, unitPrices,
    vatSeparated: t.docVat === null ? null : !t.docVat,
    accommodationTaxSeparated: accTaxSep,
    currency: t.currency,
    totalAmount,
    paymentTerms: t.paymentTerms,
    prepaymentRate: t.prepaymentRate,
    cancellationTerms: t.cancellationTerms,
    attritionTerms: t.attritionTerms,
    optionDate: t.optionUntil,
  };
  const fieldConfidence: Record<string, number> = {
    supplierName: supplier.c, customerName: customerLab ? 0.85 : 0, startDate: startDate ? (ci ? 0.9 : 0.8) : 0, endDate: endDate ? (co ? 0.9 : 0.8) : 0,
    pax: paxM ? 0.85 : 0, lines: parsed.length ? round2(mean(parsed.map((p) => p.confidence))) : 0, currency: t.currencyC,
    totalAmount: totalAmount !== null ? 0.85 : 0, paymentTerms: t.paymentTerms ? 0.8 : 0, cancellationTerms: t.cancellationTerms ? 0.8 : 0,
    vat: t.docVat !== null ? 0.9 : 0,
  };
  return { fields, fieldConfidence };
}

/** Contract confidence: mean of the key fields' confidences, missing key fields count as 0.5 (absent ≠ misread, but the diff needs them). */
export function contractConfidence(fc: Record<string, number>): number {
  const keys = ['supplierName', 'startDate', 'endDate', 'pax', 'lines', 'currency', 'totalAmount', 'paymentTerms', 'cancellationTerms', 'vat'];
  const vals = keys.map((k) => (fc[k] && fc[k] > 0 ? fc[k] : 0.5));
  const found = keys.filter((k) => (fc[k] ?? 0) > 0).length;
  let c = mean(vals);
  if (found < 3) c = Math.min(c, 0.3);
  return round2(c);
}

// =============================================================================================== invoices
export function heuristicParseInvoice(text: string, today: string): ParsedInvoice {
  const lines = splitLines(text);
  const f = fold(text);
  const fc: Record<string, number> = {};
  const noM = /(?:fatura\s*(?:no|numarasi|numara|#)|invoice\s*(?:no\.?|number|#)|belge\s*no|seri\s*sira\s*no|счет\s*№|№)\s*[:.]?\s*([A-Z0-9][A-Z0-9\-/]{2,30})/i.exec(text);
  const invoiceNo = noM ? noM[1] : null;
  fc.invoiceNo = invoiceNo ? 0.9 : 0;
  const dateAfter = (re: RegExp) => {
    const m = re.exec(f);
    return m ? firstDate(text.slice(m.index, m.index + 60), today) : null;
  };
  const issueDate = dateAfter(/(fatura tarihi|duzenleme tarihi|duzenlenme tarihi|invoice date|date of issue|issue date|дата сч)/) ?? dateAfter(/(^|\n)\s*tarih\s*[:]/);
  fc.issueDate = issueDate ? 0.85 : 0;
  const dueDate = dateAfter(/(son odeme tarihi|vade tarihi|vade|odeme tarihi|due date|payment due|pay by|срок оплаты)/);
  fc.dueDate = dueDate ? 0.85 : 0;
  const supLab = labelled(text, ['Satıcı', 'Satici', 'Firma', 'Unvan', 'Ünvan', 'Supplier', 'Seller', 'From', 'Düzenleyen', 'Duzenleyen', 'Поставщик']);
  let supplierName = supLab?.value ?? null;
  fc.supplierName = supLab ? 0.85 : 0;
  if (!supplierName) {
    const first = lines.find((l) => COMPANY_RE.test(l) || /\b(otel|hotel|turizm|a\.s\.|ltd)\b/.test(fold(l)));
    if (first) { supplierName = cleanValue(COMPANY_RE.exec(first)?.[1] ?? first); fc.supplierName = 0.6; }
  }
  let net: number | null = null, vat: number | null = null, total: number | null = null;
  const items: { description: string; amount: number }[] = [];
  const currencies = new Map<Currency, number>();
  for (const l of lines) {
    const fl = fold(l);
    const cleaned = l.replace(/%\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*%/g, ' ').replace(/\d{1,2}[./]\d{1,2}[./]\d{2,4}/g, ' ');
    const money = findMoney(cleaned);
    let amount: number | null = money.length ? money[money.length - 1].amount : null;
    if (money.length) for (const m of money) currencies.set(m.currency, (currencies.get(m.currency) ?? 0) + 1);
    if (amount === null && /(toplam|total|kdv|vat|matrah|tutar)/.test(fl)) {
      const nm = cleaned.match(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d+[.,]\d{2}/g);
      if (nm) amount = parseNumber(nm[nm.length - 1]);
    }
    if (amount === null) continue;
    if (/(genel toplam|odenecek tutar|odenecek|vergiler dahil|grand total|total due|amount due|toplam tutar \(kdv dahil\)|итого к оплате)/.test(fl)) total = amount;
    else if (/(ara toplam|matrah|subtotal|sub-total|mal hizmet toplam|kdv haric toplam|net tutar|net amount|total excl)/.test(fl)) net = amount;
    else if (/(hesaplanan kdv|kdv tutari|\bkdv\b|\bvat\b|ндс)/.test(fl)) vat = (vat ?? 0) + amount;
    else if (/(^\W*toplam|^\W*total)/.test(fl)) { if (total === null) total = amount; }
    else if (/(fatura no|invoice no|tarih|date|vergi no|vkn|iban|tel|phone)/.test(fl)) continue;
    else items.push({ description: (l.split(/[:]/)[0] || l).replace(/[\d.,]+\s*(EUR|TL|TRY|USD|GBP|€|₺|\$|£)?\s*$/i, '').trim().slice(0, 120) || l.slice(0, 60), amount });
  }
  let consistency = 0.75;
  if (net !== null && vat !== null && total !== null) consistency = Math.abs(net + vat - total) <= Math.max(0.05, total * 0.002) ? 0.95 : 0.45;
  else if (net !== null && vat !== null) { total = round2(net + vat); consistency = 0.7; }
  else if (total !== null && vat !== null) { net = round2(total - vat); consistency = 0.7; }
  else if (total !== null && net === null && items.length) {
    const s = round2(items.reduce((a, b) => a + b.amount, 0));
    if (Math.abs(s - total) < 0.05) net = s;
  }
  fc.netAmount = net !== null ? consistency : 0;
  fc.vatAmount = vat !== null ? consistency : 0;
  fc.totalAmount = total !== null ? consistency : 0;
  const cur = [...currencies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (/\b(tl|try)\b|₺/.test(f) ? 'TRY' : null);
  fc.currency = cur ? 0.9 : 0;
  fc.lines = items.length ? 0.75 : 0;
  return { invoiceNo, supplierName, issueDate, dueDate, currency: cur, netAmount: net, vatAmount: vat, totalAmount: total, lines: items, fieldConfidence: fc };
}

/** Invoice confidence: mean over the fields a payment match needs (no, supplier, date, total, currency). */
export function invoiceConfidence(fc: Record<string, number>): number {
  return round2(mean(['invoiceNo', 'supplierName', 'issueDate', 'totalAmount', 'currency'].map((k) => fc[k] ?? 0)));
}

export { toCurrency };
