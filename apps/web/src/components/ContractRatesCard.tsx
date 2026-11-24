// v0.5 S-03 / K-11: agreed (yearly / seasonal) supplier prices — the comparison anchor ("kontrat fiyatı"). Simple list + one
// collapsed add form; outdated prices are archived (never deleted).
import { useState } from 'react';
import { CURRENCIES, SERVICE_KINDS, type Currency, type ServiceKind, type Supplier } from '@mice/shared';
import { errorMessage } from '../api/client';
import { moneyApi } from '../api/moneyClient';
import { useApi } from '../api/hooks';
import { useT } from '../i18n';
import { date, money } from '../lib/format';
import { Button, Card, InlineError } from './ui';

export function ContractRatesCard({ suppliers, canEdit }: { suppliers: Supplier[]; canEdit: boolean }) {
  const t = useT();
  const res = useApi(() => moneyApi.contractRates(), []);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ supplierId: '', kind: 'accommodation' as ServiceKind, roomType: '', validFrom: '', validTo: '', price: '', currency: 'EUR' as Currency, conditions: '' });
  const save = async () => {
    setError(null);
    try {
      await moneyApi.createContractRate({
        supplierId: f.supplierId || suppliers[0]?.id, kind: f.kind, roomType: f.roomType || null, validFrom: f.validFrom, validTo: f.validTo,
        price: Number(f.price.replace(',', '.')), currency: f.currency, conditions: f.conditions || null,
      });
      setOpen(false);
      await res.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const input = (k: 'roomType' | 'validFrom' | 'validTo' | 'price' | 'conditions', label: string, type = 'text') => (
    <label className="field"><span className="field__label">{label}</span><input className="input" type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <Card title={t.money.contractRates} actions={canEdit ? <Button size="sm" variant="ghost" icon="plus" onClick={() => setOpen((x) => !x)}>{t.money.addContractRate}</Button> : null}>
      <p className="muted small">{t.money.contractHint}</p>
      {open ? (
        <div className="inline-form">
          <div className="grid-2">
            <label className="field"><span className="field__label">{t.money.supplier}</span>
              <select className="input select" value={f.supplierId || suppliers[0]?.id || ''} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="field"><span className="field__label">{t.items.kind}</span>
              <select className="input select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ServiceKind })}>
                {SERVICE_KINDS.map((k) => <option key={k} value={k}>{t.serviceKind[k]}</option>)}
              </select>
            </label>
            {input('validFrom', t.money.validFrom, 'date')}
            {input('validTo', t.money.validTo, 'date')}
            {input('price', t.money.price)}
            <label className="field"><span className="field__label">{t.quote.currency}</span>
              <select className="input select" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <details className="more">
            <summary>{t.money.advanced}</summary>
            <div className="grid-2">{input('roomType', t.money.roomType)}{input('conditions', t.money.conditions)}</div>
          </details>
          <InlineError message={error} />
          <div className="row-end"><Button size="sm" disabled={!f.validFrom || !f.validTo || !f.price} onClick={() => void save()}>{t.money.addContractRate}</Button></div>
        </div>
      ) : null}
      {res.data && !res.data.length ? <p className="muted small">{t.money.noContractRates}</p> : null}
      <ul className="list">
        {(res.data ?? []).map((r) => (
          <li key={r.id} className="list__row">
            <span><strong>{r.supplierName}</strong> · {t.serviceKind[r.kind]}{r.roomType ? ` ${r.roomType}` : ''}</span>
            <span className="small">{money(r.price, r.currency)} · {date(r.validFrom)} – {date(r.validTo)}</span>
            {canEdit ? <Button size="sm" variant="ghost" onClick={async () => { await moneyApi.archiveContractRate(r.id); await res.reload(); }}>{t.money.archive}</Button> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
