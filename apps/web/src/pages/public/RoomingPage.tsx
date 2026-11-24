import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import type { PublicRoomingGuestInput } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useT } from '../../i18n';
import { dateRange, dateTime } from '../../lib/format';
import { PublicLayout } from '../../components/PublicLayout';
import { Button, Callout, InlineError, Loading } from '../../components/ui';
import { InvalidLink } from './InvalidLink';

function blankGuest(v?: { startDate: string | null; endDate: string | null; roomTypes: string[] }): PublicRoomingGuestInput {
  // §17.9: consent is explicit and NOT pre-ticked.
  return { fullName: '', email: '', phone: '', roomType: v?.roomTypes[0] ?? '', arrival: v?.startDate ?? '', departure: v?.endDate ?? '', consentReuse: false };
}

/** Rooming list form with explicit per-guest KVKK consent (§17.9). */
export function RoomingPage() {
  const t = useT();
  const { token = '' } = useParams();
  const res = useApi(() => api.public.rooming(token), [token]);
  const [guests, setGuests] = useState<PublicRoomingGuestInput[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  if (res.error && !res.data) return <InvalidLink error={res.error} />;
  if (!res.data) return <PublicLayout title={t.publicPages.roomingTitle}><Loading /></PublicLayout>;
  const v = res.data;
  const list = guests ?? [blankGuest(v)];
  const set = (i: number, p: Partial<PublicRoomingGuestInput>) => setGuests(list.map((g, j) => (j === i ? { ...g, ...p } : g)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const clean = list.filter((g) => g.fullName.trim()).map((g) => ({
        ...g, fullName: g.fullName.trim(), email: g.email || undefined, phone: g.phone || undefined, roomType: g.roomType || undefined,
        arrival: g.arrival || undefined, departure: g.departure || undefined,
      }));
      const r = await api.public.submitRooming(token, { guests: clean });
      setSaved(r.saved);
      setGuests([blankGuest(v)]);
      void res.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicLayout
      agencyName={v.agencyName}
      title={t.publicPages.roomingTitle}
      subtitle={<><span className="mono">{v.projectCode}</span>{v.eventTitle ? ` · ${v.eventTitle}` : ''} · {dateRange(v.startDate, v.endDate)}</>}
    >
      <p className="muted">{t.publicPages.roomingIntro}{v.deadlineAt ? ` ${t.publicPages.deadline}: ${dateTime(v.deadlineAt)}.` : ''}{v.submittedCount ? ` (${v.submittedCount} kayıt alındı)` : ''}</p>
      {saved !== null ? <Callout tone="success" icon="check">{t.publicPages.roomingSaved(saved)}</Callout> : null}
      {v.readOnly ? <Callout tone="warning" icon="info">{t.publicPages.readOnly}</Callout> : null}

      <form onSubmit={submit} className="stack stack--lg">
        <fieldset disabled={v.readOnly} className="stack">
          {list.map((g, i) => (
            <section key={i} className="card card--padded guest" aria-label={`Misafir ${i + 1}`}>
              <div className="row-between">
                <h2 className="card__title">Misafir {i + 1}</h2>
                {list.length > 1 ? <Button size="sm" variant="ghost" icon="x" onClick={() => setGuests(list.filter((_, j) => j !== i))}>{t.common.remove}</Button> : null}
              </div>
              <div className="form-grid">
                <div className="field span-2">
                  <label className="field__label" htmlFor={`g-name-${i}`}>{t.publicPages.fullName}</label>
                  <input id={`g-name-${i}`} className="input" autoComplete="name" value={g.fullName} onChange={(e) => set(i, { fullName: e.target.value })} required={i === 0} />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`g-email-${i}`}>{t.items.email}</label>
                  <input id={`g-email-${i}`} className="input" type="email" autoComplete="email" value={g.email ?? ''} onChange={(e) => set(i, { email: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`g-phone-${i}`}>{t.publicPages.phone}</label>
                  <input id={`g-phone-${i}`} className="input" type="tel" autoComplete="tel" value={g.phone ?? ''} onChange={(e) => set(i, { phone: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`g-room-${i}`}>{t.ops.room}</label>
                  {v.roomTypes.length ? (
                    <select id={`g-room-${i}`} className="input select" value={g.roomType ?? ''} onChange={(e) => set(i, { roomType: e.target.value })}>
                      {v.roomTypes.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  ) : (
                    <input id={`g-room-${i}`} className="input" value={g.roomType ?? ''} onChange={(e) => set(i, { roomType: e.target.value })} />
                  )}
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`g-arr-${i}`}>{t.ops.arrival}</label>
                  <input id={`g-arr-${i}`} className="input" type="date" value={g.arrival ?? ''} onChange={(e) => set(i, { arrival: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`g-dep-${i}`}>{t.ops.departure}</label>
                  <input id={`g-dep-${i}`} className="input" type="date" value={g.departure ?? ''} min={g.arrival} onChange={(e) => set(i, { departure: e.target.value })} />
                </div>
              </div>
              <div className="consent">
                <input id={`g-consent-${i}`} type="checkbox" checked={g.consentReuse} onChange={(e) => set(i, { consentReuse: e.target.checked })} aria-describedby={`g-consent-hint-${i}`} />
                <label htmlFor={`g-consent-${i}`}>
                  <strong>{t.publicPages.consentLabel}</strong>
                  <span id={`g-consent-hint-${i}`} className="consent__hint">
                    {t.publicPages.consentHint}{' '}
                    {v.privacyNoticeUrl ? <a href={v.privacyNoticeUrl} target="_blank" rel="noreferrer">{t.publicPages.privacyNotice}</a> : <span>{t.publicPages.privacyNotice}: talep üzerine iletilir.</span>}
                  </span>
                </label>
              </div>
            </section>
          ))}
          <Button variant="secondary" icon="plus" onClick={() => setGuests([...list, blankGuest(v)])}>{t.publicPages.addGuest}</Button>
        </fieldset>
        <InlineError message={error} />
        {!v.readOnly ? (
          <div className="public__submit">
            <span className="muted">{list.filter((g) => g.fullName.trim()).length} misafir</span>
            <Button type="submit" size="lg" icon="send" busy={busy} disabled={!list.some((g) => g.fullName.trim())}>{t.publicPages.submitRooming}</Button>
          </div>
        ) : null}
      </form>
    </PublicLayout>
  );
}
