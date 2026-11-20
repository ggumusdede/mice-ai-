// Template drafts (used by MockAiService) + fact sanitation shared with ClaudeAiService.
// §3.3/§3.4: short, clear, owner's voice, never mentions AI. Negotiation: only volume / relationship / flexible dates /
// payment ease — competitor prices are stripped from facts before any drafting (mock or LLM).
import type { Language } from '@mice/shared';
import type { Draft, DraftRequest } from './index.js';
import { fold } from './text.js';

export const NEGOTIATION_ARGUMENTS = ['volume', 'relationship', 'flexible_dates', 'payment_ease'] as const;
export type NegotiationArgument = (typeof NEGOTIATION_ARGUMENTS)[number];

const COMPETITOR_KEY = /(competitor|rakip|other_?offers?|diger_?teklif|diğer_?teklif|benchmark|market_?price|piyasa|kanal_?fiyat|channel_?price|ota_?price|cheapest|en_?ucuz)/i;

/** Removes every fact that could leak competitor / channel prices into an outbound message. */
export function sanitizeDraftFacts(kind: DraftRequest['kind'], facts: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(facts)) {
    if (COMPETITOR_KEY.test(k)) continue;
    if (kind === 'negotiation' && k === 'arguments') {
      const arr = Array.isArray(v) ? v : [v];
      out[k] = arr.filter((a): a is NegotiationArgument => (NEGOTIATION_ARGUMENTS as readonly string[]).includes(String(a)));
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Detects text that reveals the message was machine-written (must never reach a customer/supplier). */
export function revealsAi(text: string): boolean {
  return /(yapay zek|\bAI\b|\bA\.I\.|language model|dil modeli|as an assistant|bir asistan olarak|chatgpt|claude|искусственн|нейросет)/i.test(text);
}

const MONTHS: Record<Language, string[]> = {
  tr: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
};

export function formatDate(iso: unknown, lang: Language): string | null {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return typeof iso === 'string' ? iso : null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return lang === 'en' ? `${MONTHS.en[m - 1]} ${d}, ${y}` : `${d} ${MONTHS[lang][m - 1]} ${y}`;
}

export function formatRange(start: unknown, end: unknown, lang: Language): string | null {
  if (typeof start !== 'string') return null;
  if (typeof end !== 'string' || end === start) return formatDate(start, lang);
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = end.split('-').map(Number);
  if (ys === ye && ms === me) return lang === 'en' ? `${MONTHS.en[ms - 1]} ${ds}–${de}, ${ys}` : `${ds}–${de} ${MONTHS[lang][ms - 1]} ${ys}`;
  return `${formatDate(start, lang)} – ${formatDate(end, lang)}`;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) return v.map(String).join(', ');
  return String(v);
}
function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x ? String((x as Record<string, unknown>).label ?? (x as Record<string, unknown>).question ?? JSON.stringify(x)) : String(x)));
  if (typeof v === 'string' && v) return [v];
  return [];
}
function money(v: unknown, cur: unknown): string | null {
  if (typeof v !== 'number') return str(v);
  return `${v.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${str(cur) ?? 'EUR'}`;
}

const T = {
  hello: { tr: 'Merhaba', en: 'Hello', ru: 'Здравствуйте' },
  closing: { tr: 'İyi çalışmalar,', en: 'Best regards,', ru: 'С уважением,' },
  pax: { tr: 'kişi', en: 'pax', ru: 'чел.' },
} as const;

function styleGreetingAndClosing(req: DraftRequest): { greeting: string; closing: string } {
  const lang = req.language;
  const name = req.recipientName?.trim();
  let greeting = name ? (lang === 'ru' ? `${T.hello.ru}, ${name}!` : `${T.hello[lang]} ${name},`) : (lang === 'ru' ? `${T.hello.ru}!` : `${T.hello[lang]},`);
  let closing = T.closing[lang];
  const ex = req.styleExamples?.length ? req.styleExamples[req.styleExamples.length - 1].after : null;
  if (ex) {
    const lines = ex.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const first = lines[0] ?? '';
    const sal = /^(merhaba|selam|selamlar|iyi günler|günaydın|hello|hi|dear|здравствуйте|добрый день)\b/i.exec(first);
    if (sal && first.length <= 40) {
      const punct = /[!,]$/.test(first) ? first.slice(-1) : ',';
      greeting = name ? `${sal[1]} ${name}${punct}` : `${sal[1]}${punct}`;
    }
    const closingLine = lines.slice(-3).find((l) => l.length <= 30 && /(iyi çalışmalar|saygılar|selamlar|görüşmek üzere|teşekkürler|kolay gelsin|best|regards|cheers|thanks|с уважением|спасибо)/i.test(l));
    if (closingLine) closing = closingLine;
  }
  return { greeting, closing };
}

function eventLine(f: Record<string, unknown>, lang: Language): string {
  const parts: string[] = [];
  const dates = formatRange(f.startDate, f.endDate, lang) ?? str(f.dates);
  if (dates) parts.push(dates);
  if (f.pax) parts.push(`${f.pax} ${T.pax[lang]}`);
  const place = [str(f.district), str(f.city)].filter(Boolean).join(lang === 'tr' ? ' / ' : ', ');
  if (place) parts.push(place);
  if (f.eventType) parts.push(String(f.eventType));
  return parts.join(', ');
}

const ARG_TEXT: Record<NegotiationArgument, Record<Language, string>> = {
  volume: { tr: 'Grubun büyüklüğünü ve toplam hacmi düşünürsek', en: 'Given the group size and total volume', ru: 'Учитывая размер группы и общий объём' },
  relationship: { tr: 'uzun süredir birlikte çalışıyoruz', en: 'we have worked together for a long time', ru: 'мы давно и успешно сотрудничаем' },
  flexible_dates: { tr: 'tarihlerde esneklik sağlayabiliriz', en: 'we can be flexible on dates', ru: 'мы можем быть гибкими по датам' },
  payment_ease: { tr: 'ödemeyi hızlı planlayabiliriz', en: 'we can arrange payment quickly', ru: 'можем быстро организовать оплату' },
};

/** Deterministic, short template draft. */
export function templateDraft(req: DraftRequest): Draft {
  const lang = req.language;
  const f = sanitizeDraftFacts(req.kind, req.facts);
  const { greeting, closing } = styleGreetingAndClosing(req);
  const ev = eventLine(f, lang);
  const code = str(f.projectCode);
  const body: string[] = [];
  let subject: string | null = null;
  const L = (tr: string, en: string, ru: string) => (lang === 'tr' ? tr : lang === 'en' ? en : ru);

  switch (req.kind) {
    case 'missing_info': {
      const qs = list(f.missingQuestions ?? f.missingFields ?? f.questions);
      subject = L(`${ev || 'Talebiniz'} – birkaç kısa soru`, `${ev || 'Your request'} – a few quick questions`, `${ev || 'Ваш запрос'} – несколько вопросов`);
      body.push(L(`Talebiniz için teşekkürler${ev ? ` (${ev})` : ''}. Teklifi hazırlamak için şunları netleştirebilir miyiz?`,
        `Thanks for your request${ev ? ` (${ev})` : ''}. To prepare the quote, could you confirm:`,
        `Спасибо за запрос${ev ? ` (${ev})` : ''}. Для подготовки предложения уточните, пожалуйста:`));
      for (const q of qs) body.push(`- ${q}`);
      break;
    }
    case 'rfq': {
      subject = L(`Fiyat talebi – ${ev}`, `Request for quotation – ${ev}`, `Запрос цены – ${ev}`);
      body.push(L(`Aşağıdaki etkinlik için fiyat ve müsaitlik rica ederiz:`, `Please send us your rates and availability for:`, `Просим прислать цены и наличие для:`));
      if (ev) body.push(`- ${ev}`);
      const rooms = [f.roomsSgl ? `${f.roomsSgl} SGL` : null, f.roomsDbl ? `${f.roomsDbl} DBL` : null].filter(Boolean).join(' + ');
      if (rooms) body.push(`- ${L('Oda', 'Rooms', 'Номера')}: ${rooms}`);
      if (f.hallLayout) body.push(`- ${L('Salon', 'Meeting room', 'Зал')}: ${f.hallLayout}`);
      if (f.fnb) body.push(`- F&B: ${str(f.fnb)}`);
      for (const it of list(f.items)) body.push(`- ${it}`);
      if (f.optionDays || f.optionUntil) body.push(L(`Opsiyon: ${str(f.optionUntil) ? formatDate(f.optionUntil, lang) : `${f.optionDays} gün`}`, `Option: ${str(f.optionUntil) ? formatDate(f.optionUntil, lang) : `${f.optionDays} days`}`, `Опция: ${str(f.optionUntil) ? formatDate(f.optionUntil, lang) : `${f.optionDays} дн.`}`));
      const dl = formatDate(f.responseDeadline, lang);
      if (dl) body.push(L(`${dl} tarihine kadar dönüşünüzü rica ederiz.`, `We would appreciate your reply by ${dl}.`, `Просим ответить до ${dl}.`));
      break;
    }
    case 'rfq_reminder': {
      subject = L(`Hatırlatma – ${ev || 'fiyat talebimiz'}`, `Reminder – ${ev || 'our RFQ'}`, `Напоминание – ${ev || 'наш запрос'}`);
      body.push(L(`${ev ? `${ev} için ` : ''}gönderdiğimiz fiyat talebine dönüşünüzü bekliyoruz. Müsait olup olmadığınızı kısaca iletebilir misiniz?`,
        `Just following up on our quotation request${ev ? ` for ${ev}` : ''}. Could you let us know your availability?`,
        `Напоминаем о нашем запросе${ev ? ` (${ev})` : ''}. Сообщите, пожалуйста, о наличии.`));
      break;
    }
    case 'negotiation': {
      const args = (f.arguments as NegotiationArgument[] | undefined) ?? [];
      subject = L(`${ev || 'Teklifiniz'} – fiyat hakkında`, `${ev || 'Your offer'} – pricing`, `${ev || 'Ваше предложение'} – по цене`);
      body.push(L('Teklifiniz için teşekkürler.', 'Thank you for your offer.', 'Спасибо за предложение.'));
      const reasons = args.map((a) => ARG_TEXT[a][lang]);
      const target = money(f.targetUnitPrice ?? f.targetPrice, f.currency);
      const ask = target
        ? L(`${target} seviyesine inebilirseniz hemen ilerleyebiliriz.`, `If you can meet ${target}, we can move ahead right away.`, `Если сможете предложить ${target}, сразу двигаемся дальше.`)
        : L('Fiyatta bir iyileştirme yapabilir misiniz?', 'Could you improve the rate?', 'Сможете ли улучшить цену?');
      if (reasons.length) body.push(`${reasons.join(lang === 'tr' ? ', ' : '; ')}. ${ask}`);
      else body.push(ask);
      break;
    }
    case 'quote_cover': {
      subject = L(`Teklifimiz – ${ev}`, `Our proposal – ${ev}`, `Наше предложение – ${ev}`);
      body.push(L(`${ev ? `${ev} için ` : ''}teklifimiz ektedir.`, `Please find attached our proposal${ev ? ` for ${ev}` : ''}.`, `Во вложении наше предложение${ev ? ` (${ev})` : ''}.`));
      const total = money(f.quoteTotal, f.currency);
      if (total) body.push(L(`Toplam: ${total}`, `Total: ${total}`, `Итого: ${total}`));
      const vu = formatDate(f.validUntil ?? f.optionUntil, lang);
      if (vu) body.push(L(`Opsiyon ${vu} tarihine kadar geçerlidir.`, `The option holds until ${vu}.`, `Опция действует до ${vu}.`));
      body.push(L('Sorunuz olursa buradayım.', 'Happy to answer any questions.', 'Готов ответить на вопросы.'));
      break;
    }
    case 'quote_followup': {
      subject = L(`${ev || 'Teklifimiz'} – takip`, `${ev || 'Our proposal'} – follow-up`, `${ev || 'Наше предложение'} – уточнение`);
      const vu = formatDate(f.validUntil ?? f.optionUntil, lang);
      body.push(L(`Gönderdiğimiz teklifle ilgili düşüncelerinizi merak ediyoruz.${vu ? ` Opsiyon ${vu} tarihinde doluyor.` : ''}`,
        `Checking in on the proposal we sent.${vu ? ` The option expires on ${vu}.` : ''}`,
        `Хотели узнать ваше мнение по предложению.${vu ? ` Опция истекает ${vu}.` : ''}`));
      break;
    }
    case 'option_extension': {
      const cur = formatDate(f.optionUntil, lang);
      const nxt = formatDate(f.newOptionUntil ?? f.requestedOptionUntil, lang);
      subject = L(`Opsiyon uzatma – ${ev || code || ''}`.trim(), `Option extension – ${ev || code || ''}`.trim(), `Продление опции – ${ev || code || ''}`.trim());
      body.push(L(`${cur ? `${cur} tarihinde dolan ` : ''}opsiyonu${nxt ? ` ${nxt} tarihine kadar` : ' birkaç gün'} uzatabilir misiniz? Müşterimizin kararı bekleniyor.`,
        `Could you extend the option${cur ? ` (expiring ${cur})` : ''}${nxt ? ` until ${nxt}` : ' by a few days'}? Our client's decision is pending.`,
        `Сможете ли продлить опцию${cur ? ` (до ${cur})` : ''}${nxt ? ` до ${nxt}` : ' на несколько дней'}? Ждём решения клиента.`));
      break;
    }
    case 'revision_request': {
      const items = list(f.revisions ?? f.diff ?? f.items);
      subject = L(`Sözleşme revizyonu – ${ev || code || ''}`.trim(), `Contract revision – ${ev || code || ''}`.trim(), `Правки к договору – ${ev || code || ''}`.trim());
      body.push(L('Sözleşmede teklifle uyuşmayan noktalar var, düzeltebilir misiniz?', 'A few points in the contract differ from the offer. Could you correct them?', 'В договоре есть расхождения с предложением, просим исправить:'));
      for (const it of items) body.push(`- ${it}`);
      break;
    }
    case 'supplier_confirmation': {
      subject = L(`Konfirmasyon – ${ev}`, `Confirmation – ${ev}`, `Подтверждение – ${ev}`);
      body.push(L(`${ev ? `${ev} için ` : ''}rezervasyonu konfirme ediyoruz. Detaylar aşağıda:`, `We confirm the booking${ev ? ` for ${ev}` : ''}. Details below:`, `Подтверждаем бронирование${ev ? ` (${ev})` : ''}. Детали:`));
      for (const it of list(f.items)) body.push(`- ${it}`);
      break;
    }
    case 'daily_summary': {
      subject = L(`Günlük özet${code ? ` – ${code}` : ''}`, `Daily summary${code ? ` – ${code}` : ''}`, `Итоги дня${code ? ` – ${code}` : ''}`);
      const lines = list(f.summaryLines ?? f.lines ?? f.items).slice(0, 3);
      for (const l of lines) body.push(`- ${l}`);
      if (!lines.length) body.push(L('Bugün her şey planlandığı gibi ilerledi.', 'Everything went to plan today.', 'Сегодня всё прошло по плану.'));
      break;
    }
    default: {
      subject = str(f.subject);
      body.push(str(f.message ?? f.text ?? f.note) ?? L('Kısa bir bilgi:', 'A quick note:', 'Коротко:'));
      if (ev) body.push(ev);
    }
  }
  const text = [greeting, '', ...body, '', closing, req.senderName].join('\n');
  return { subject: req.kind === 'daily_summary' || subject ? subject : null, body: text };
}

/** Rough style-diff stats used by the mock summarizeStyle. */
export function styleStats(corrections: { before: string; after: string }[]): { shorter: number; longer: number; avgDeltaPct: number; addedGreetings: string[]; removedPhrases: string[] } {
  let shorter = 0, longer = 0;
  const deltas: number[] = [];
  const added = new Map<string, number>();
  const removed = new Map<string, number>();
  for (const c of corrections) {
    const b = c.before.length || 1;
    deltas.push((c.after.length - c.before.length) / b);
    if (c.after.length < c.before.length * 0.9) shorter++;
    else if (c.after.length > c.before.length * 1.1) longer++;
    const fl = (s: string) => fold(s.split(/\r?\n/)[0] ?? '').replace(/[^a-zа-я ]/g, '').trim();
    const ga = fl(c.after), gb = fl(c.before);
    if (ga && ga !== gb && ga.length < 30) added.set(c.after.split(/\r?\n/)[0].trim(), (added.get(c.after.split(/\r?\n/)[0].trim()) ?? 0) + 1);
    const phrases = c.before.split(/[.!?\n]/).map((p) => p.trim()).filter((p) => p.length > 8 && !c.after.includes(p));
    for (const p of phrases) removed.set(p, (removed.get(p) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  return { shorter, longer, avgDeltaPct: deltas.length ? Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 100) : 0, addedGreetings: top(added), removedPhrases: top(removed) };
}
