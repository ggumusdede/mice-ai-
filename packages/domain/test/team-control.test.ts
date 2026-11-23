import { describe, expect, it } from 'vitest';
import {
  bonusExplanation, corporateChannelCheck, deadlineFromDetail, deadlineRouting, effectiveQuietHours, escalationChain, escalationDue,
  estimatedBonus, fieldPackExpiry, fieldPackGuests, inQuietHours, isCorporateAddress, matchSalesOwner, nextInChain,
  participantMessageAllowed, promiseKeepingScore, quietHoursEnd, renderTemplate, routedDecisionAllowed, signCorporateMessage,
} from '../src/team-control.js';

const TZ = 'Europe/Istanbul';
const ist = (s: string) => new Date(`${s}:00+03:00`);

describe('S-14 sessiz saat', () => {
  const qh = { enabled: true, start: '22:00', end: '08:00' };
  it('kapalıysa hiçbir zaman sessiz değil (varsayılan "her zaman")', () => {
    expect(inQuietHours(ist('2026-11-23T23:30'), TZ, { ...qh, enabled: false })).toBe(false);
    expect(inQuietHours(ist('2026-11-23T23:30'), TZ, null)).toBe(false);
  });
  it('gece yarısını aşan pencere', () => {
    expect(inQuietHours(ist('2026-11-23T23:30'), TZ, qh)).toBe(true);
    expect(inQuietHours(ist('2026-11-24T07:59'), TZ, qh)).toBe(true);
    expect(inQuietHours(ist('2026-11-24T08:00'), TZ, qh)).toBe(false);
    expect(inQuietHours(ist('2026-11-24T12:00'), TZ, qh)).toBe(false);
  });
  it('aynı gün penceresi ve bitiş zamanı', () => {
    expect(inQuietHours(ist('2026-11-24T13:00'), TZ, { enabled: true, start: '12:00', end: '14:00' })).toBe(true);
    expect(quietHoursEnd(ist('2026-11-23T23:30'), TZ, qh)?.toISOString()).toBe(ist('2026-11-24T08:00').toISOString());
    expect(quietHoursEnd(ist('2026-11-24T06:00'), TZ, qh)?.toISOString()).toBe(ist('2026-11-24T08:00').toISOString());
    expect(quietHoursEnd(ist('2026-11-24T12:00'), TZ, qh)).toBeNull();
  });
  it('çalışan ayarı acenta ayarını ezer, null = acenta', () => {
    expect(effectiveQuietHours(qh, null)).toBe(qh);
    expect(effectiveQuietHours(qh, { enabled: false, start: '22:00', end: '08:00' }).enabled).toBe(false);
  });
});

describe('S-01 eskalasyon', () => {
  it('zincir: nöbetçi → vekili → yöneticiler, tekrarsız', () => {
    expect(escalationChain({ first: 'n', firstDeputy: 'v', admins: ['a', 'n'] })).toEqual(['n', 'v', 'a']);
    expect(escalationChain({ first: null, admins: ['a'] })).toEqual(['a']);
  });
  it('sıradaki kişi; zincir sonu null (otomatik onay yok)', () => {
    expect(nextInChain(['n', 'v', 'a'], null)).toBe('n');
    expect(nextInChain(['n', 'v', 'a'], 'n')).toBe('v');
    expect(nextInChain(['n', 'v', 'a'], 'a')).toBeNull();
    expect(nextInChain(['n', 'a'], 'x')).toBe('n');
    expect(nextInChain([], 'x')).toBeNull();
  });
  it('süre dolunca', () => {
    const t0 = ist('2026-11-23T23:00');
    expect(escalationDue(t0, ist('2026-11-23T23:09'), 10)).toBe(false);
    expect(escalationDue(t0, ist('2026-11-23T23:10'), 10)).toBe(true);
    expect(escalationDue(t0, ist('2026-11-24T23:10'), 0)).toBe(false);
  });
});

describe('S-13 meşgul vekâleti', () => {
  const base = { enabled: true, createdAt: ist('2026-11-23T09:00'), deadlineAt: ist('2026-11-24T18:00'), waitHours: 4, leadHours: 24, approverNotified: false, routed: false };
  it('beklemeden veya son tarih uzakken bir şey yapmaz', () => {
    expect(deadlineRouting({ ...base, now: ist('2026-11-23T10:00') })).toBe('none');
    expect(deadlineRouting({ ...base, deadlineAt: ist('2026-11-30T18:00'), now: ist('2026-11-23T20:00') })).toBe('none');
    expect(deadlineRouting({ ...base, deadlineAt: null, now: ist('2026-11-24T17:00') })).toBe('none');
    expect(deadlineRouting({ ...base, enabled: false, now: ist('2026-11-24T17:00') })).toBe('none');
  });
  it('önce onaylayana kritik bildirim, sonra vekile; bir kez', () => {
    expect(deadlineRouting({ ...base, now: ist('2026-11-23T20:00') })).toBe('notify_approver');
    expect(deadlineRouting({ ...base, approverNotified: true, now: ist('2026-11-23T21:00') })).toBe('route_to_deputy');
    expect(deadlineRouting({ ...base, approverNotified: true, routed: true, now: ist('2026-11-23T21:00') })).toBe('none');
  });
  it('kart detayından son tarih', () => {
    expect(deadlineFromDetail({ optionUntil: '2026-11-25' })).toBe('2026-11-25');
    expect(deadlineFromDetail({ ticketTimeLimit: '2026-11-25T12:00:00Z', optionUntil: 'x' })).toBe('2026-11-25T12:00:00Z');
    expect(deadlineFromDetail({ foo: 1 })).toBeNull();
  });
});

describe('S-02 kurumsal hat', () => {
  it('onaylayanın adı mesaja bir kez eklenir', () => {
    const once = signCorporateMessage('Merhaba', 'Ayşe Kaya', 'Demo MICE');
    expect(once).toBe('Merhaba\n— Ayşe Kaya · Demo MICE');
    expect(signCorporateMessage(once, 'Ayşe Kaya', 'Demo MICE')).toBe(once);
  });
  it('sohbet kişiye atanmamışsa veya onaylayan yoksa gitmez', () => {
    expect(corporateChannelCheck({ assignedUserId: null, approverName: 'A' })).toMatchObject({ ok: false, code: 'CONVERSATION_UNASSIGNED' });
    expect(corporateChannelCheck({ assignedUserId: 'u', approverName: ' ' })).toMatchObject({ ok: false, code: 'APPROVER_UNKNOWN' });
    expect(corporateChannelCheck({ assignedUserId: 'u', approverName: 'A' })).toEqual({ ok: true });
  });
  it('katılımcı mesajı: kapalı / yalnız lojistik / açık', () => {
    expect(participantMessageAllowed('off', true)).toBe(false);
    expect(participantMessageAllowed('logistics', true)).toBe(true);
    expect(participantMessageAllowed('logistics', false)).toBe(false);
    expect(participantMessageAllowed('on', false)).toBe(true);
  });
});

describe('S-09 kurumsal adres', () => {
  it('kişisel sağlayıcılar kurumsal sayılmaz', () => {
    expect(isCorporateAddress('ali@gmail.com', { corporateDomains: [], loginEmail: 'ali@gmail.com' })).toBe(false);
  });
  it('liste yoksa giriş adresinin alan adı; liste varsa liste', () => {
    expect(isCorporateAddress('ali@acenta.com', { corporateDomains: [], loginEmail: 'x@acenta.com' })).toBe(true);
    expect(isCorporateAddress('ali@baska.com', { corporateDomains: [], loginEmail: 'x@acenta.com' })).toBe(false);
    expect(isCorporateAddress('ali@acenta.com.tr', { corporateDomains: ['@acenta.com.tr'], loginEmail: 'x@acenta.com' })).toBe(true);
  });
});

describe('S-01 şablon', () => {
  it('değişkenleri doldurur, boşları listeler', () => {
    const r = renderTemplate('Merhaba {{customerName}}, {{projectCode}} {{note}}\n\n\n{{senderName}}', { customerName: 'Acme', projectCode: 'PRJ-1', senderName: 'Ayşe' });
    expect(r.text).toBe('Merhaba Acme, PRJ-1\n\nAyşe');
    expect(r.missing).toEqual(['note']);
  });
});

describe('S-11 tahmini prim (şeffaf formül)', () => {
  const f = { basis: 'realized_profit' as const, rate: 0.05, onlyCollected: true };
  it('tahsil edilen kâr × oran; negatif olmaz; veri yoksa null', () => {
    expect(estimatedBonus(f, { realizedProfit: 10_000, realizedCollectedProfit: 6_000, plannedProfit: 20_000 })).toBe(300);
    expect(estimatedBonus({ ...f, onlyCollected: false }, { realizedProfit: 10_000, realizedCollectedProfit: 6_000, plannedProfit: null })).toBe(500);
    expect(estimatedBonus({ ...f, basis: 'planned_profit' }, { realizedProfit: null, realizedCollectedProfit: null, plannedProfit: 20_000 })).toBe(1000);
    expect(estimatedBonus(f, { realizedProfit: -5, realizedCollectedProfit: -5, plannedProfit: null })).toBe(0);
    expect(estimatedBonus(f, { realizedProfit: null, realizedCollectedProfit: null, plannedProfit: null })).toBeNull();
    expect(bonusExplanation(f)).toContain('%5');
  });
});

describe('S-12 söz tutma skoru', () => {
  it('iki bileşenin ortalaması; veri yoksa null', () => {
    expect(promiseKeepingScore({ paymentsDue: 4, paymentsOnTime: 3, optionsDue: 2, optionsHandled: 2 })).toBe(88);
    expect(promiseKeepingScore({ paymentsDue: 0, paymentsOnTime: 0, optionsDue: 2, optionsHandled: 1 })).toBe(50);
    expect(promiseKeepingScore({ paymentsDue: 0, paymentsOnTime: 0, optionsDue: 0, optionsHandled: 0 })).toBeNull();
  });
});

describe('S-15 saha paketi', () => {
  const guests = [
    { fullName: 'Zeynep Ak', roomNo: '204', transferGroup: 'Otobüs 1', phone: '+90 532', anonymized: false },
    { fullName: 'Ali Can', roomNo: '101', transferGroup: 'Otobüs 2', phone: '+90 533', anonymized: false },
    { fullName: null, roomNo: '9', transferGroup: 'Otobüs 1', phone: null, anonymized: true },
  ];
  it('yalnız ad + oda + grup (+ telefon); anonim misafir düşer', () => {
    const r = fieldPackGuests(guests, { includePhone: true, onlyGroup: null });
    expect(r).toHaveLength(2);
    expect(Object.keys(r[0]).sort()).toEqual(['group', 'name', 'phone', 'room']);
    expect(fieldPackGuests(guests, { includePhone: false, onlyGroup: null }).every((g) => g.phone === null)).toBe(true);
  });
  it('hostes yalnız kendi otobüsü', () => {
    expect(fieldPackGuests(guests, { includePhone: true, onlyGroup: 'otobüs 1' }).map((g) => g.name)).toEqual(['Zeynep Ak']);
  });
  it('geçerlilik: gün başı + N saat', () => {
    expect(fieldPackExpiry('2026-11-24', TZ, 36).toISOString()).toBe(ist('2026-11-25T12:00').toISOString());
  });
});

describe('D-3 satış sorumlusu eşleştirme', () => {
  const users = [{ id: '1', email: 'ayse@acenta.com', fullName: 'Ayşe Kaya' }, { id: '2', email: 'ali@acenta.com', fullName: 'Ali Veli' }, { id: '3', email: 'ali2@acenta.com', fullName: 'Ali Veli' }];
  it('e-posta veya ad (Türkçe harf duyarsız); belirsiz ad eşleşmez', () => {
    expect(matchSalesOwner('AYSE@acenta.com', users)).toEqual({ userId: '1', reason: 'email' });
    expect(matchSalesOwner('ayse kaya', users)).toEqual({ userId: '1', reason: 'name' });
    expect(matchSalesOwner('Ali Veli', users)).toEqual({ userId: null, reason: 'ambiguous' });
    expect(matchSalesOwner('Mehmet', users)).toEqual({ userId: null, reason: 'not_found' });
    expect(matchSalesOwner('', users)).toEqual({ userId: null, reason: 'empty' });
  });
});

describe('S-01 / S-13 yönlendirilen kartta yetki', () => {
  const base = { kind: 'outbound_message', requiresBiometric: false, assignedTo: 'u1', deputyId: null, deadlineAt: null };
  it('nöbetçi atandığı dış mesajı onaylayabilir; Face ID gereken veya başka tür kartı değil', () => {
    expect(routedDecisionAllowed(base, 'u1')).toBe(true);
    expect(routedDecisionAllowed(base, 'u2')).toBe(false);
    expect(routedDecisionAllowed({ ...base, requiresBiometric: true }, 'u1')).toBe(false);
    expect(routedDecisionAllowed({ ...base, kind: 'quote_approval' }, 'u1')).toBe(false);
  });
  it('vekil yalnız son tarihli kartı; yönetişim kartları asla', () => {
    expect(routedDecisionAllowed({ ...base, kind: 'quote_approval', requiresBiometric: true, assignedTo: null, deputyId: 'd', deadlineAt: '2026-11-24' }, 'd')).toBe(true);
    expect(routedDecisionAllowed({ ...base, assignedTo: null, deputyId: 'd', deadlineAt: null }, 'd')).toBe(false);
    expect(routedDecisionAllowed({ ...base, kind: 'supplier_accreditation', assignedTo: null, deputyId: 'd', deadlineAt: '2026-11-24' }, 'd')).toBe(false);
  });
});
