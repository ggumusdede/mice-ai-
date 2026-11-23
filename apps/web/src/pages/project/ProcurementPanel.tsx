// v0.5 S-03 (K-12, K-13): supplier options (1st / 2nd, T-3 card, extension) and group blocks (pickup, release, attrition) of the
// project — one simple card each, one primary action per row, add forms and advanced fields collapsed. The system never releases
// or drops anything by itself; messages to suppliers are drafts that come back for approval.
import { useState } from 'react';
import { CURRENCIES, type AllotmentBlock, type Currency, type SupplierOption } from '@mice/shared';
import { errorMessage } from '../../api/client';
import { moneyApi } from '../../api/moneyClient';
import { useApi } from '../../api/hooks';
import { useT } from '../../i18n';
import { date, money, pct, todayISO } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { Button, Card, InlineError, Pill } from '../../components/ui';
import { useProject } from './ProjectContext';
import { supplierName, useSuppliers } from './useSuppliers';

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function ProcurementPanel() {
  const t = useT();
  return (
    <section className="stack" aria-label={t.money.procurement}>
      <OptionsCard />
      <AllotmentsCard />
    </section>
  );
}

function OptionsCard() {
  const t = useT();
  const toast = useToast();
  const { detail, reload } = useProject();
  const { byId } = useSuppliers();
  const res = useApi(() => moneyApi.options(detail.project.id), [detail.project.id]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    setError(null);
    try {
      await fn();
      if (msg) toast(msg);
      await res.reload();
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const items = detail.items.filter((i) => i.status !== 'cancelled' && i.offers.length);
  return (
    <Card title={t.money.options} actions={items.length ? <Button size="sm" variant="ghost" icon="plus" onClick={() => setAdding((x) => !x)}>{t.money.addOption}</Button> : null}>
      {adding ? <OptionForm onDone={() => { setAdding(false); void res.reload(); }} /> : null}
      {res.data && !res.data.length && !adding ? <p className="muted small">{t.money.noOptions}</p> : null}
      <ul className="list">
        {(res.data ?? []).map((o) => <OptionRow key={o.id} o={o} supplier={supplierName(byId, o.supplierId)} item={detail.items.find((i) => i.id === o.serviceItemId)?.description ?? ''} run={run} />)}
      </ul>
      <InlineError message={error} />
    </Card>
  );
}

function OptionRow({ o, supplier, item, run }: { o: SupplierOption; supplier: string; item: string; run: (fn: () => Promise<unknown>, msg?: string) => Promise<void> }) {
  const t = useT();
  const [newDate, setNewDate] = useState('');
  const left = daysBetween(todayISO(), o.optionUntil);
  const open = o.status === 'active' || o.status === 'extension_requested';
  return (
    <li className="list__row stack">
      <div className="row row--wrap">
        <strong>{supplier}</strong>
        <span className="muted small">{item}</span>
        <Pill tone={o.rank === 2 ? 'warning' : 'accent'}>{t.money.rank(o.rank)}</Pill>
        <Pill tone={open && left <= 3 ? 'danger' : 'neutral'}>{t.money.optionStatus[o.status] ?? o.status}</Pill>
        <span className="small">{t.money.until}: {date(o.optionUntil)}{open ? ` · ${t.money.daysLeft(left)}` : ''}</span>
      </div>
      {open ? (
        <div className="row row--wrap">
          {o.status === 'active' ? <Button size="sm" onClick={() => void run(() => moneyApi.requestExtension(o.id), t.money.extensionAsked)}>{t.money.askExtension}</Button> : null}
          <details className="more">
            <summary>{t.money.more}</summary>
            <div className="row row--wrap">
              <label className="sr-only" htmlFor={`ext-${o.id}`}>{t.money.extended}</label>
              <input id={`ext-${o.id}`} className="input input--sm" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              <Button size="sm" variant="secondary" disabled={!newDate} onClick={() => void run(() => moneyApi.markExtended(o.id, newDate), t.money.extendedToast)}>{t.money.extended}</Button>
              <Button size="sm" variant="ghost" onClick={() => void run(() => moneyApi.setOptionStatus(o.id, 'confirmed'))}>{t.money.confirm}</Button>
              <Button size="sm" variant="ghost" onClick={() => void run(() => moneyApi.setOptionStatus(o.id, 'released'))}>{t.money.release}</Button>
            </div>
          </details>
        </div>
      ) : null}
    </li>
  );
}

function OptionForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const { detail } = useProject();
  const { byId } = useSuppliers();
  const items = detail.items.filter((i) => i.status !== 'cancelled' && i.offers.length);
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const item = items.find((i) => i.id === itemId);
  const offers = (item?.offers ?? []).filter((o) => !o.supersededBy);
  const [offerId, setOfferId] = useState(offers[0]?.id ?? '');
  const offer = offers.find((o) => o.id === offerId) ?? offers[0];
  const [until, setUntil] = useState(offer?.optionUntil ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!item || !offer) return;
    setError(null);
    try {
      const r = await moneyApi.createOption(detail.project.id, { serviceItemId: item.id, supplierId: offer.supplierId, offerId: offer.id, optionUntil: until });
      toast(r.warning ?? t.money.rank(r.rank));
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div className="inline-form">
      <div className="grid-2">
        <label className="field"><span className="field__label">{t.money.item}</span>
          <select className="input select" value={itemId} onChange={(e) => { setItemId(e.target.value); setOfferId(''); }}>
            {items.map((i) => <option key={i.id} value={i.id}>{i.description}</option>)}
          </select>
        </label>
        <label className="field"><span className="field__label">{t.money.supplier}</span>
          <select className="input select" value={offer?.id ?? ''} onChange={(e) => { setOfferId(e.target.value); setUntil(offers.find((o) => o.id === e.target.value)?.optionUntil ?? ''); }}>
            {offers.map((o) => <option key={o.id} value={o.id}>{supplierName(byId, o.supplierId)}</option>)}
          </select>
        </label>
        <label className="field"><span className="field__label">{t.money.until}</span><input className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
      </div>
      <InlineError message={error} />
      <div className="row-end"><Button size="sm" disabled={!until || !offer} onClick={() => void save()}>{t.money.addOption}</Button></div>
    </div>
  );
}

function AllotmentsCard() {
  const t = useT();
  const { detail } = useProject();
  const res = useApi(() => moneyApi.allotments(detail.project.id), [detail.project.id]);
  const [adding, setAdding] = useState(false);
  return (
    <Card title={t.money.allotments} actions={<Button size="sm" variant="ghost" icon="plus" onClick={() => setAdding((x) => !x)}>{t.money.addAllotment}</Button>}>
      {adding ? <AllotmentForm onDone={() => { setAdding(false); void res.reload(); }} /> : null}
      {res.data && !res.data.length && !adding ? <p className="muted small">{t.money.noAllotments}</p> : null}
      <ul className="list">
        {(res.data ?? []).map((b) => <AllotmentRow key={b.id} b={b} onChange={() => void res.reload()} />)}
      </ul>
    </Card>
  );
}

function AllotmentRow({ b, onChange }: { b: AllotmentBlock; onChange: () => void }) {
  const t = useT();
  const toast = useToast();
  const { byId } = useSuppliers();
  const s = b.summary;
  const [rooms, setRooms] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    try { await fn(); toast(msg); setRooms(''); onChange(); } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <li className="list__row stack">
      <div className="row row--wrap">
        <strong>{b.supplierName ?? supplierName(byId, b.supplierId)}</strong>
        <span className="small">{date(b.dateFrom)} – {date(b.dateTo)} · {b.roomsPerNight - b.releasedRooms} {t.money.roomsPerNight.toLowerCase()}</span>
        {s ? <Pill tone={s.stage === 'release_window' ? 'danger' : 'neutral'}>{t.money.stage[s.stage]}</Pill> : null}
        {b.releaseDate ? <span className="small muted">{t.money.releaseDate}: {date(b.releaseDate)}</span> : null}
      </div>
      {s ? (
        <p className="small">
          {t.money.summary(pct(s.pickupPct), s.releasableRooms)} · {t.money.penaltyHold}: {money(s.penaltyIfHold, b.currency)}
          {s.releasableRooms ? <> · {t.money.penaltyRelease}: {money(s.penaltyIfRelease, b.currency)}</> : null}
        </p>
      ) : null}
      <div className="row row--wrap">
        <label className="sr-only" htmlFor={`rooms-${b.id}`}>{t.money.pickup}</label>
        <input id={`rooms-${b.id}`} className="input input--sm" inputMode="numeric" placeholder={t.money.pickup} value={rooms} onChange={(e) => setRooms(e.target.value)} />
        <Button size="sm" variant="secondary" disabled={!rooms} onClick={() => void act(() => moneyApi.pickup(b.id, Number(rooms)), t.money.savePickup)}>{t.money.savePickup}</Button>
        {s && s.releasableRooms > 0 ? (
          <Button size="sm" onClick={() => void act(() => moneyApi.release(b.id, s.releasableRooms), t.money.releasedToast)}>{t.money.doRelease} ({s.releasableRooms})</Button>
        ) : null}
      </div>
      <InlineError message={error} />
    </li>
  );
}

function AllotmentForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const { detail } = useProject();
  const { suppliers } = useSuppliers();
  const acc = suppliers.filter((s) => s.kinds.includes('accommodation'));
  const [f, setF] = useState({
    supplierId: acc[0]?.id ?? '', dateFrom: detail.project.startDate ?? '', dateTo: detail.project.endDate ?? detail.project.startDate ?? '',
    roomsPerNight: '', rate: '', currency: (detail.project.baseCurrency ?? 'EUR') as Currency, releaseDate: '', attrition: '10', penalty: '100', terms: '',
  });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await moneyApi.createAllotment({
        projectId: detail.project.id, supplierId: f.supplierId, dateFrom: f.dateFrom, dateTo: f.dateTo, roomsPerNight: Number(f.roomsPerNight),
        ratePerRoomNight: Number(f.rate.replace(',', '.')), currency: f.currency, releaseDate: f.releaseDate || null,
        attritionPct: Number(f.attrition) / 100, penaltyPct: Number(f.penalty) / 100, penaltyTerms: f.terms || null,
      });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const field = (k: keyof typeof f, label: string, type = 'text') => (
    <label className="field"><span className="field__label">{label}</span><input className="input" type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <div className="inline-form">
      <div className="grid-2">
        <label className="field"><span className="field__label">{t.money.supplier}</span>
          <select className="input select" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
            {acc.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {field('roomsPerNight', t.money.roomsPerNight, 'number')}
        {field('dateFrom', t.money.firstNight, 'date')}
        {field('dateTo', t.money.lastNight, 'date')}
        {field('rate', t.money.rate)}
        <label className="field"><span className="field__label">{t.quote.currency}</span>
          <select className="input select" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        {field('releaseDate', t.money.releaseDate, 'date')}
      </div>
      <details className="more">
        <summary>{t.money.advanced}</summary>
        <div className="grid-2">
          {field('attrition', t.money.attrition, 'number')}
          {field('penalty', t.money.penalty, 'number')}
          {field('terms', t.money.penaltyTerms)}
        </div>
      </details>
      <InlineError message={error} />
      <div className="row-end"><Button size="sm" disabled={!f.supplierId || !f.roomsPerNight || !f.rate || !f.dateFrom || !f.dateTo} onClick={() => void save()}>{t.money.addAllotment}</Button></div>
    </div>
  );
}
