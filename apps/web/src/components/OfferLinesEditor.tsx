import type { OfferLine, ServiceKind } from '@mice/shared';
import { SERVICE_KINDS } from '@mice/shared';
import { useT } from '../i18n';
import { money } from '../lib/format';
import { Button } from './ui';

export function emptyLine(kind: ServiceKind, defaults: Partial<OfferLine> = {}): OfferLine {
  const acc = kind === 'accommodation';
  return {
    description: '',
    kind,
    quantity: 1,
    unit: acc ? 'room_night' : kind === 'transfer' ? 'vehicle' : 'pax_day',
    unitPrice: 0,
    vatIncluded: false,
    vatRate: acc ? 0.1 : 0.2,
    ...(acc ? { roomType: 'DBL', board: 'BB', nights: 1, accommodationTaxIncluded: false } : {}),
    ...defaults,
  };
}

export function linesTotal(lines: OfferLine[]): number {
  return lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * (l.nights && l.unit === 'room_night' ? l.nights : 1), 0);
}

const UNITS = ['room_night', 'pax_day', 'pax', 'vehicle', 'lump_sum', 'hour', 'piece'];
const UNIT_LABEL: Record<string, string> = {
  room_night: 'oda/gece', pax_day: 'kişi/gün', pax: 'kişi', vehicle: 'araç', lump_sum: 'götürü', hour: 'saat', piece: 'adet',
};
const BOARDS = ['RO', 'BB', 'HB', 'FB', 'AI'];

/** Structured offer lines per item kind (supplier form, manual entry, low-confidence verification). */
export function OfferLinesEditor({
  lines, onChange, currency, readOnly = false, lockKind,
}: { lines: OfferLine[]; onChange: (l: OfferLine[]) => void; currency: string; readOnly?: boolean; lockKind?: ServiceKind }) {
  const t = useT();
  const set = (i: number, patch: Partial<OfferLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="lines">
      {lines.map((l, i) => {
        const acc = l.kind === 'accommodation';
        const lineTotal = (l.quantity || 0) * (l.unitPrice || 0) * (acc && l.nights && l.unit === 'room_night' ? l.nights : 1);
        return (
          <fieldset key={i} className="lines__row" disabled={readOnly}>
            <legend className="sr-only">Satır {i + 1}</legend>
            <div className="lines__grid">
              <label className="lines__cell lines__cell--wide">
                <span>{t.common.description}</span>
                <input className="input" value={l.description} required onChange={(e) => set(i, { description: e.target.value })} placeholder={acc ? 'Örn: DBL oda, BB' : 'Örn: Tam gün toplantı paketi'} />
              </label>
              {!lockKind ? (
                <label className="lines__cell">
                  <span>{t.items.kind}</span>
                  <select className="input" value={l.kind} onChange={(e) => set(i, emptyLine(e.target.value as ServiceKind, { description: l.description, quantity: l.quantity, unitPrice: l.unitPrice }))}>
                    {SERVICE_KINDS.map((k) => <option key={k} value={k}>{t.serviceKind[k]}</option>)}
                  </select>
                </label>
              ) : null}
              {acc ? (
                <>
                  <label className="lines__cell">
                    <span>{t.offers.roomType}</span>
                    <select className="input" value={l.roomType ?? 'DBL'} onChange={(e) => set(i, { roomType: e.target.value })}>
                      {['SGL', 'DBL', 'TWN', 'TRP', 'SUITE'].map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </label>
                  <label className="lines__cell">
                    <span>{t.offers.board}</span>
                    <select className="input" value={l.board ?? 'BB'} onChange={(e) => set(i, { board: e.target.value })}>
                      {BOARDS.map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </label>
                  <label className="lines__cell lines__cell--num">
                    <span>{t.items.nights}</span>
                    <input className="input" type="number" min={1} inputMode="numeric" value={l.nights ?? 1} onChange={(e) => set(i, { nights: Number(e.target.value) })} />
                  </label>
                </>
              ) : null}
              <label className="lines__cell lines__cell--num">
                <span>{t.common.quantity}</span>
                <input className="input" type="number" min={0} inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} />
              </label>
              <label className="lines__cell">
                <span>{t.common.unit}</span>
                <select className="input" value={l.unit} onChange={(e) => set(i, { unit: e.target.value })}>
                  {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
                </select>
              </label>
              <label className="lines__cell lines__cell--num">
                <span>{t.offers.unitPrice} ({currency})</span>
                <input className="input" type="number" min={0} step="0.01" inputMode="decimal" value={l.unitPrice} onChange={(e) => set(i, { unitPrice: Number(e.target.value) })} />
              </label>
              <label className="lines__cell lines__cell--num">
                <span>{t.offers.vatRate}</span>
                <input className="input" type="number" min={0} max={100} inputMode="numeric" value={Math.round((l.vatRate ?? 0) * 100)} onChange={(e) => set(i, { vatRate: Number(e.target.value) / 100 })} />
              </label>
              <label className="lines__cell lines__cell--check">
                <input type="checkbox" checked={l.vatIncluded} onChange={(e) => set(i, { vatIncluded: e.target.checked })} />
                <span>{t.offers.vatIncluded}</span>
              </label>
              {acc ? (
                <label className="lines__cell lines__cell--check">
                  <input type="checkbox" checked={!!l.accommodationTaxIncluded} onChange={(e) => set(i, { accommodationTaxIncluded: e.target.checked })} />
                  <span>{t.offers.accTaxIncluded}</span>
                </label>
              ) : null}
            </div>
            <div className="lines__foot">
              <span className="muted small">{money(lineTotal, currency)}</span>
              {!readOnly && lines.length > 1 ? (
                <Button variant="ghost" size="sm" icon="x" onClick={() => onChange(lines.filter((_, j) => j !== i))}>
                  {t.common.remove}
                </Button>
              ) : null}
            </div>
          </fieldset>
        );
      })}
      {!readOnly ? (
        <Button variant="ghost" icon="plus" onClick={() => onChange([...lines, emptyLine(lockKind ?? lines[lines.length - 1]?.kind ?? 'other', lines[lines.length - 1]?.nights ? { nights: lines[lines.length - 1].nights } : {})])}>
          {t.offers.addLine}
        </Button>
      ) : null}
      <div className="lines__total">
        <span>{t.common.total}</span>
        <strong>{money(linesTotal(lines), currency)}</strong>
      </div>
    </div>
  );
}
