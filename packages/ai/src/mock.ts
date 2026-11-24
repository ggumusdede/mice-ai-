// MockAiService — deterministic, regex/heuristic implementation of the full AiService contract. No network.
// This is what dev/test runs without ANTHROPIC_API_KEY, so it aims for realistic results on TR (and EN) inputs.
import type { ContractFields, Language } from '@mice/shared';
import type {
  AiResult, AiService, AskAnswer, AskContext, Draft, DraftRequest, FileInput, ParsedInvoice, ParsedOffer,
} from './index.js';
import type { RequestExtraction } from '@mice/shared';
import { draftActionFor } from './authority.js';
import { revealsAi, styleStats, templateDraft } from './drafts.js';
import {
  contractConfidence, heuristicExtractRequest, heuristicParseContract, heuristicParseInvoice, heuristicParseOffer,
  invoiceConfidence, offerConfidence, requestExtractionConfidence,
} from './heuristics.js';
import { detectLanguage, fold, round2 } from './text.js';

const MODEL = 'mock-heuristic-v1';

/** Text from an input: plain text wins; text-like files (txt/csv/html/eml/json) are decoded; PDFs/images can't be read by the mock. */
function inputText(input: { text?: string; file?: FileInput }): { text: string; unreadable: boolean } {
  if (input.text && input.text.trim()) return { text: input.text, unreadable: false };
  if (input.file) {
    const mt = input.file.mimeType.toLowerCase();
    const binaryOffice = /openxmlformats|ms-excel|msword|zip|octet-stream|vnd\.oasis/.test(mt);
    if (!binaryOffice && (mt.startsWith('text/') || /json|csv|xml|rfc822|message/.test(mt) || /\.(txt|csv|eml|html?|json|xml)$/i.test(input.file.filename))) {
      return { text: Buffer.from(input.file.base64, 'base64').toString('utf8'), unreadable: false };
    }
    return { text: '', unreadable: true };
  }
  return { text: '', unreadable: false };
}

// ---------------------------------------------------------------- ask() helpers
const STOP = new Set(['bu', 'su', 'ne', 'mi', 'mu', 'icin', 'ile', 've', 'de', 'da', 'bir', 'kac', 'hangi', 'nedir', 'var', 'yok', 'mi?', 'the', 'is', 'are', 'what', 'which', 'how', 'many', 'much', 'for', 'and', 'did', 'does', 'was', 'were', 'of', 'in', 'on', 'to', 'we', 'our', 'with', 'this', 'that', 'projede', 'proje', 'project', 'bize', 'biz', 'en', 'son', 'gecen', 'sene', 'yil', 'kim', 'firma', 'firmasi', 'isim', 'adi', 'zaman', 'who', 'name']);
const SYNONYMS: Record<string, string[]> = {
  otel: ['hotel', 'venue', 'tesis', 'supplier', 'tedarikci', 'mekan'],
  fiyat: ['price', 'rate', 'cost', 'ucret', 'tutar', 'amount', 'unitprice', 'maliyet'],
  kisi: ['pax', 'people', 'katilimci', 'guest'],
  tarih: ['date', 'start', 'end', 'startdate', 'enddate', 'gun'],
  marj: ['margin', 'kar', 'profit', 'markup'],
  musteri: ['customer', 'client'],
  odeme: ['payment', 'paid', 'vade', 'due'],
  opsiyon: ['option', 'optionuntil'],
  oda: ['room', 'rooms', 'sgl', 'dbl', 'accommodation', 'konaklama'],
  salon: ['hall', 'layout', 'meeting'],
  butce: ['budget'],
  sehir: ['city', 'district', 'semt'],
};

function tokens(s: string): string[] {
  return fold(s).replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^a-z0-9а-я]+/).filter((w) => w.length >= 2 && !STOP.has(w));
}
function expand(ws: string[]): Set<string> {
  const out = new Set<string>();
  for (const w of ws) {
    out.add(w);
    for (const [k, syn] of Object.entries(SYNONYMS)) {
      const all = [k, ...syn];
      if (all.some((x) => w.startsWith(x.slice(0, Math.max(3, Math.min(5, x.length)))) || x.startsWith(w.slice(0, Math.max(3, Math.min(5, w.length)))))) all.forEach((x) => out.add(x));
    }
  }
  return out;
}
function flatten(v: unknown, path: string, out: { key: string; value: string }[]): void {
  if (v === null || v === undefined) return;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x === null)) out.push({ key: path, value: v.join(', ') });
    else v.forEach((x, i) => flatten(x, `${path}[${i}]`, out));
  } else if (typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(x, path ? `${path}.${k}` : k, out);
  else out.push({ key: path, value: String(v) });
}

function noData(lang: Language): string {
  return lang === 'en' ? 'Bu konuda veri yok. (No data on this.)' : lang === 'ru' ? 'Bu konuda veri yok. (Нет данных по этому вопросу.)' : 'Bu konuda veri yok.';
}

// ---------------------------------------------------------------- checklist suggestions
const LESSON_RULES: { re: RegExp; q: string; field: string | null }[] = [
  { re: /(vejetaryen|vegan|diyet|alerji|glutensiz|helal|vegetarian|allerg|diet)/, q: 'Özel diyet / alerji ihtiyacı olan katılımcı var mı?', field: 'fnb' },
  { re: /(vize|visa|pasaport)/, q: 'Vize gerektiren yabancı katılımcı var mı?', field: null },
  { re: /(ucus|flight|havalimani|varis saati|arrival)/, q: 'Katılımcıların uçuş / varış saatleri belli mi?', field: 'transfer' },
  { re: /(transfer|servis|shuttle)/, q: 'Transfer ihtiyacı (havalimanı, gün içi) var mı?', field: 'transfer' },
  { re: /(projeksiyon|ses sistemi|mikrofon|led|teknik|sahne|technical)/, q: 'Teknik ihtiyaçlar (projeksiyon, ses, LED, sahne) neler?', field: 'technical' },
  { re: /(simultane|cevirmen|tercuman|translation)/, q: 'Simultane çeviri gerekiyor mu, hangi dillerde?', field: 'technical' },
  { re: /(fatura|vergi|billing|invoice)/, q: 'Fatura bilgileri (unvan, vergi dairesi / no, adres) nedir?', field: 'billingInfo' },
  { re: /(rooming|oda listesi|isim listesi)/, q: 'Rooming list hangi tarihte iletilecek?', field: null },
  { re: /(oda dagilimi|sgl|dbl|single|double)/, q: 'Oda dağılımı (SGL / DBL) nasıl olacak?', field: 'roomsSgl' },
  { re: /(butce|budget)/, q: 'Kişi başı / toplam bütçe aralığı nedir?', field: 'budget' },
  { re: /(tarih|esnek|date)/, q: 'Tarihlerde esneklik var mı?', field: 'dateFlexibility' },
  { re: /(salon|duzen|layout|oturma)/, q: 'Salon düzeni (tiyatro / sınıf / U / banket) nasıl olmalı?', field: 'hallLayout' },
  { re: /(engelli|erisilebilir|tekerlekli|accessib)/, q: 'Erişilebilirlik ihtiyacı olan katılımcı var mı?', field: null },
  { re: /(otopark|park yeri|vale|parking)/, q: 'Otopark / vale ihtiyacı var mı?', field: null },
  { re: /(karar tarihi|karar|decision)/, q: 'Karar tarihi ne zaman?', field: 'decisionDate' },
  { re: /(odeme|on odeme|kapora|payment|deposit)/, q: 'Ödeme koşulları ve ön ödeme beklentisi nedir?', field: null },
  { re: /(hediye|gift|kit|yaka karti|badge|baski)/, q: 'Hediye / yaka kartı / baskı malzemesi ihtiyacı var mı?', field: null },
  { re: /(fotograf|video|cekim)/, q: 'Fotoğraf / video çekimi isteniyor mu?', field: null },
];

export class MockAiService implements AiService {
  readonly name = 'mock';

  private result<T>(data: T, confidence: number, action: AiResult<T>['action']): AiResult<T> {
    return { data, confidence: round2(Math.max(0, Math.min(1, confidence))), model: MODEL, action, tokens: { input: 0, output: 0 } };
  }

  async extractRequest(text: string, opts: { channel: string; today: string; knownCustomers?: string[] }): Promise<AiResult<RequestExtraction>> {
    const data = heuristicExtractRequest(text, { today: opts.today, knownCustomers: opts.knownCustomers });
    let c = requestExtractionConfidence(data);
    // voice / phone notes are noisier than written requests
    if (opts.channel === 'voice' || opts.channel === 'phone_note') c *= 0.95;
    return this.result(data, c, 'request_extraction');
  }

  async parseSupplierOffer(input: { text?: string; file?: FileInput; itemKind?: string; today: string }): Promise<AiResult<ParsedOffer>> {
    const { text, unreadable } = inputText(input);
    const data = heuristicParseOffer(text, input.today, input.itemKind);
    if (unreadable) data.notes = `Mock: ${input.file?.filename} (${input.file?.mimeType}) okunamadı; manuel doğrulama gerekli.`;
    return this.result(data, unreadable ? 0 : offerConfidence(data), 'document_reading');
  }

  async parseContract(input: { text?: string; file?: FileInput; today: string }): Promise<AiResult<ContractFields>> {
    const { text, unreadable } = inputText(input);
    const { fields, fieldConfidence } = heuristicParseContract(text, input.today);
    return this.result(fields, unreadable ? 0 : contractConfidence(fieldConfidence), 'document_reading');
  }

  async parseInvoice(input: { text?: string; file?: FileInput; today: string }): Promise<AiResult<ParsedInvoice>> {
    const { text, unreadable } = inputText(input);
    const data = heuristicParseInvoice(text, input.today);
    return this.result(data, unreadable ? 0 : invoiceConfidence(data.fieldConfidence), 'document_reading');
  }

  async draftMessage(req: DraftRequest): Promise<AiResult<Draft>> {
    const d = templateDraft(req);
    return this.result(d, revealsAi(d.body) ? 0.3 : 0.9, draftActionFor(req.kind));
  }

  async ask(ctx: AskContext): Promise<AiResult<AskAnswer>> {
    const lang = detectLanguage(ctx.question);
    const flat: { key: string; value: string }[] = [];
    flatten(ctx.facts, '', flat);
    const q = expand(tokens(ctx.question));
    const scored = flat.map((f) => {
      const keyToks = tokens(f.key.replace(/\[\d+\]/g, ' '));
      const valToks = tokens(f.value);
      let s = 0;
      for (const t of keyToks) if ([...q].some((w) => w.length >= 3 && (t.startsWith(w.slice(0, 4)) || w.startsWith(t.slice(0, 4))))) s += 2;
      for (const t of valToks) if (t.length >= 3 && [...q].some((w) => w.length >= 4 && (t.startsWith(w.slice(0, 5)) || w.startsWith(t.slice(0, 5))))) s += 1;
      return { ...f, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    if (!scored.length) return this.result({ answer: noData(lang), usedFacts: [] }, 0.9, 'draft_generation');
    const best = scored.filter((x) => x.s >= scored[0].s - 1).slice(0, 3);
    const answer = best.map((b) => `${b.key}: ${b.value}`).join('; ');
    return this.result({ answer, usedFacts: best.map((b) => b.key) }, best[0].s >= 2 ? 0.75 : 0.55, 'draft_generation');
  }

  async interpretCommand(transcript: string, today: string): Promise<AiResult<{ intent: 'create_project' | 'ask' | 'unknown'; requestText?: string; question?: string }>> {
    void today;
    const t = transcript.trim();
    const f = fold(t);
    const create = /(,?\s*(?:yeni\s+)?proje(?:yi|si)?\s+(?:ac|olustur|baslat|kur)\w*|\bnew project\b|\b(?:create|open|start)\s+(?:a\s+)?(?:new\s+)?project\b|создай\w*\s+проект|открой\w*\s+проект)/.exec(f);
    if (create) {
      const requestText = (t.slice(0, create.index) + ' ' + t.slice(create.index + create[0].length)).replace(/\s+/g, ' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '').trim();
      return this.result({ intent: 'create_project', requestText }, requestText.length > 5 ? 0.9 : 0.6, 'request_extraction');
    }
    const isQ = /\?\s*$/.test(t) || /(^|\s)(ne|neler|kac|hangi|nerede|kim|ne zaman|neden|nasil|mi|mu|mı|mü|mudur|midir|what|how|which|when|who|where|why|did|does|is|are|сколько|какой|когда|где|кто|почему)(\s|$|\?)/.test(f);
    if (isQ) return this.result({ intent: 'ask', question: t }, /\?\s*$/.test(t) ? 0.85 : 0.7, 'request_extraction');
    return this.result({ intent: 'unknown' }, 0.3, 'request_extraction');
  }

  async suggestChecklistQuestions(lessons: string, eventType: string | null, existing: string[]): Promise<AiResult<{ question: string; field: string | null }[]>> {
    void eventType;
    const f = fold(lessons);
    const ex = existing.map((e) => fold(e));
    const out: { question: string; field: string | null }[] = [];
    for (const r of LESSON_RULES) {
      if (!r.re.test(f)) continue;
      const fq = fold(r.q);
      const keyWords = fq.split(/[^a-z]+/).filter((w) => w.length >= 5);
      const dup = ex.some((e) => e === fq || keyWords.filter((w) => e.includes(w.slice(0, 5))).length >= Math.min(2, keyWords.length));
      if (!dup && !out.some((o) => o.question === r.q)) out.push({ question: r.q, field: r.field });
    }
    return this.result(out.slice(0, 5), out.length ? 0.7 : 0.5, 'checklist_new_question');
  }

  async summarizeStyle(corrections: { before: string; after: string }[], language: Language): Promise<AiResult<{ summary: string }>> {
    if (!corrections.length) {
      const s = language === 'en' ? 'No corrections this month.' : language === 'ru' ? 'В этом месяце правок не было.' : 'Bu ay düzeltme yok.';
      return this.result({ summary: s }, 0.9, 'draft_generation');
    }
    const st = styleStats(corrections);
    const parts: string[] = [];
    if (language === 'en') {
      parts.push(`${corrections.length} drafts corrected.`);
      if (st.shorter > st.longer) parts.push(`Texts were shortened (avg ${st.avgDeltaPct}%).`);
      else if (st.longer > st.shorter) parts.push(`Texts were lengthened (avg +${st.avgDeltaPct}%).`);
      if (st.addedGreetings.length) parts.push(`Preferred opening: "${st.addedGreetings[0]}".`);
      if (st.removedPhrases.length) parts.push(`Often removed: "${st.removedPhrases[0]}".`);
    } else if (language === 'ru') {
      parts.push(`Исправлено черновиков: ${corrections.length}.`);
      if (st.shorter > st.longer) parts.push(`Тексты сокращались (в среднем ${st.avgDeltaPct}%).`);
      if (st.addedGreetings.length) parts.push(`Предпочтительное приветствие: «${st.addedGreetings[0]}».`);
    } else {
      parts.push(`${corrections.length} taslak düzeltildi.`);
      if (st.shorter > st.longer) parts.push(`Metinler kısaltıldı (ortalama %${Math.abs(st.avgDeltaPct)}).`);
      else if (st.longer > st.shorter) parts.push(`Metinler uzatıldı (ortalama +%${st.avgDeltaPct}).`);
      if (st.addedGreetings.length) parts.push(`Tercih edilen açılış: "${st.addedGreetings[0]}".`);
      if (st.removedPhrases.length) parts.push(`Sık çıkarılan ifade: "${st.removedPhrases[0]}".`);
    }
    return this.result({ summary: parts.join(' ') }, 0.7, 'draft_generation');
  }
}
