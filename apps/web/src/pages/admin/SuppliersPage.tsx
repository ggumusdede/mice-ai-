import { useState, type FormEvent } from 'react';
import { SERVICE_KINDS, SUPPLIER_STATUSES, type ServiceKind, type Supplier } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n';
import { num } from '../../lib/format';
import { ContractRatesCard } from '../../components/ContractRatesCard';
import { useToast } from '../../components/Toast';
import { Button, Card, Checkbox, ErrorBox, InlineError, Loading, Pill, TextInput, type Tone } from '../../components/ui';

const STATUS_TONE: Record<string, Tone> = { candidate: 'warning', accredited: 'success', passive: 'neutral' };

export function SuppliersPage() {
  const t = useT();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [city, setCity] = useState('');
  const res = useApi(() => api.suppliers.list({ kind, status, city }), [kind, status, city]);
  const [adding, setAdding] = useState(false);

  return (
    <div className="stack stack--lg">
      <div className="toolbar">
        <label className="toolbar__filter">
          <span className="sr-only">{t.items.kind}</span>
          <select className="input select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{t.items.kind}: {t.common.all}</option>
            {SERVICE_KINDS.map((k) => <option key={k} value={k}>{t.serviceKind[k]}</option>)}
          </select>
        </label>
        <label className="toolbar__filter">
          <span className="sr-only">{t.common.status}</span>
          <select className="input select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t.common.status}: {t.common.all}</option>
            {SUPPLIER_STATUSES.map((s) => <option key={s} value={s}>{t.supplierStatus[s]}</option>)}
          </select>
        </label>
        <label className="search">
          <span className="sr-only">{t.items.city}</span>
          <input className="search__input" placeholder={t.items.city} value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <Button variant="secondary" icon="plus" onClick={() => setAdding((x) => !x)}>{t.items.newSupplier}</Button>
      </div>
      {adding ? <NewSupplier onSaved={(s) => { res.setData((p) => [s, ...(p ?? [])]); setAdding(false); }} /> : null}
      {res.error ? <ErrorBox error={res.error} onRetry={() => void res.reload()} /> : null}
      {!res.data && res.loading ? <Loading /> : null}
      {res.data ? (
        <Card title={t.admin.suppliers} padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t.common.name}</th>
                  <th scope="col">{t.items.kind}</th>
                  <th scope="col">{t.items.city}</th>
                  <th scope="col" className="num">{t.admin.capacity}</th>
                  <th scope="col" className="num">{t.admin.performance}</th>
                  <th scope="col">{t.common.status}</th>
                  <th scope="col"><span className="sr-only">İşlem</span></th>
                </tr>
              </thead>
              <tbody>
                {res.data.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong><div className="muted small">{[s.contactName, s.email, s.phone].filter(Boolean).join(' · ')}</div></td>
                    <td className="small">{s.kinds.map((k) => t.serviceKind[k]).join(', ')}</td>
                    <td>{s.city}{s.district ? ` / ${s.district}` : ''}</td>
                    <td className="num">{s.capacityPax ?? '—'}{s.roomCount ? <div className="muted small">{s.roomCount} oda</div> : null}</td>
                    <td className="num">{s.performanceScore !== null ? <span className={s.performanceScore < 50 ? 'text-danger' : ''}>{num(s.performanceScore)}</span> : '—'}</td>
                    <td><Pill tone={STATUS_TONE[s.status]}>{t.supplierStatus[s.status]}</Pill></td>
                    <td className="num nowrap">
                      {s.status === 'candidate' ? (
                        <Button size="sm" variant="secondary" icon="shield" title={t.admin.accreditNote} onClick={async () => {
                          try {
                            const n = await api.suppliers.patch(s.id, { status: 'accredited' });
                            res.setData((p) => (p ?? []).map((x) => (x.id === n.id ? n : x)));
                            toast(t.admin.accreditNote);
                          } catch (e) {
                            toast(errorMessage(e), 'danger');
                          }
                        }}>{t.admin.accredit}</Button>
                      ) : null}
                      {isAdmin && s.status === 'accredited' ? (
                        <Button size="sm" variant="ghost" onClick={async () => {
                          try {
                            const n = await api.suppliers.patch(s.id, { status: 'passive' });
                            res.setData((p) => (p ?? []).map((x) => (x.id === n.id ? n : x)));
                          } catch (e) {
                            toast(errorMessage(e), 'danger');
                          }
                        }}>{t.supplierStatus.passive}</Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      {res.data?.length ? <ContractRatesCard suppliers={res.data} canEdit={isAdmin} /> : null}
    </div>
  );
}

function NewSupplier({ onSaved }: { onSaved: (s: Supplier) => void }) {
  const t = useT();
  const [f, setF] = useState({ name: '', city: '', district: '', email: '', phone: '', contactName: '', capacityPax: '', segment: '' });
  const [kinds, setKinds] = useState<Set<ServiceKind>>(new Set(['accommodation']));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.suppliers.create({
        name: f.name, city: f.city, district: f.district || null, email: f.email || null, phone: f.phone || null, contactName: f.contactName || null,
        capacityPax: f.capacityPax ? Number(f.capacityPax) : null, segment: f.segment || null, kinds: [...kinds],
      }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={`${t.items.newSupplier} (${t.supplierStatus.candidate})`}>
      <form className="form-grid" onSubmit={submit}>
        <TextInput label={t.common.name} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <TextInput label={t.items.city} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} required />
        <TextInput label={t.items.district} value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} />
        <TextInput label="Segment" placeholder="4*, 5*, butik" value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value })} />
        <TextInput label="Yetkili" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />
        <TextInput label={t.items.email} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <TextInput label={t.publicPages.phone} type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <TextInput label={t.admin.capacity} type="number" value={f.capacityPax} onChange={(e) => setF({ ...f, capacityPax: e.target.value })} />
        <fieldset className="span-full">
          <legend className="field__label">{t.items.kind}</legend>
          <div className="chips">
            {SERVICE_KINDS.map((k) => (
              <Checkbox key={k} label={t.serviceKind[k]} checked={kinds.has(k)} onChange={(v) => { const s = new Set(kinds); if (v) s.add(k); else s.delete(k); setKinds(s); }} />
            ))}
          </div>
        </fieldset>
        <div className="span-full row-end">
          <InlineError message={error} />
          <Button type="submit" busy={busy} disabled={!kinds.size}>{t.common.save}</Button>
        </div>
      </form>
    </Card>
  );
}
