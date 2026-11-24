import { useState, type FormEvent } from 'react';
import { DEFAULT_RULES, SERVICE_KINDS, type Rfq, type ServiceItemDetail, type ServiceItemInput, type ServiceKind, type SupplierRanking } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useT } from '../../i18n';
import { dateRange, dateTime, num } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { Button, Callout, Card, Checkbox, CopyLink, EmptyState, InlineError, Pill, Select, TextInput } from '../../components/ui';
import { useProject } from './ProjectContext';
import { unitLabel } from '../../components/OfferLinesEditor';
import { supplierName, useSuppliers } from './useSuppliers';

export function ItemsTab() {
  const t = useT();
  const { detail } = useProject();
  const [adding, setAdding] = useState(detail.items.length === 0);
  return (
    <div className="stack stack--lg">
      <div className="row-between">
        <h2 className="section-title">{t.project.items}</h2>
        <Button variant="secondary" icon="plus" onClick={() => setAdding((x) => !x)}>{t.project.addItem}</Button>
      </div>
      {adding ? <AddItemForm onDone={() => setAdding(false)} /> : null}
      {detail.items.length === 0 && !adding ? <EmptyState icon="folder" title={t.project.noItems} /> : null}
      {detail.items.map((item) => <ItemRfqCard key={item.id} item={item} />)}
    </div>
  );
}

function AddItemForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const { detail, reload } = useProject();
  const p = detail.project;
  const [f, setF] = useState<ServiceItemInput>({
    kind: 'accommodation', description: '', quantity: p.pax ?? 1, unit: 'room_night', dateFrom: p.startDate ?? undefined, dateTo: p.endDate ?? undefined, nights: 1, valueAdd: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.projects.addItem(p.id, { ...f, nights: f.kind === 'accommodation' ? f.nights : undefined });
      await reload();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={t.project.addItem}>
      <form className="form-grid" onSubmit={submit}>
        <Select label={t.items.kind} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ServiceKind, unit: e.target.value === 'accommodation' ? 'room_night' : e.target.value === 'transfer' ? 'vehicle' : 'pax_day' })}>
          {SERVICE_KINDS.map((k) => <option key={k} value={k}>{t.serviceKind[k]}</option>)}
        </Select>
        <TextInput label={t.items.description} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required className="span-2" />
        <TextInput label={t.items.dateFrom} type="date" value={f.dateFrom ?? ''} onChange={(e) => setF({ ...f, dateFrom: e.target.value || undefined })} />
        <TextInput label={t.items.dateTo} type="date" value={f.dateTo ?? ''} onChange={(e) => setF({ ...f, dateTo: e.target.value || undefined })} />
        <TextInput label={t.items.quantity} type="number" min={0} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} />
        <TextInput label={t.items.unit} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
        {f.kind === 'accommodation' ? <TextInput label={t.items.nights} type="number" min={1} value={f.nights ?? 1} onChange={(e) => setF({ ...f, nights: Number(e.target.value) })} /> : null}
        <div className="span-full">
          <Checkbox label={t.items.valueAdd} checked={!!f.valueAdd} onChange={(v) => setF({ ...f, valueAdd: v })} />
        </div>
        <div className="span-full row-end">
          <InlineError message={error} />
          <Button variant="ghost" onClick={onDone}>{t.common.cancel}</Button>
          <Button type="submit" busy={busy}>{t.common.add}</Button>
        </div>
      </form>
    </Card>
  );
}

function ItemRfqCard({ item }: { item: ServiceItemDetail }) {
  const t = useT();
  const toast = useToast();
  const { reload } = useProject();
  const { byId, refresh: refreshSuppliers } = useSuppliers();
  const [shortlist, setShortlist] = useState<SupplierRanking[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deadlineHours, setDeadlineHours] = useState(48);
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Rfq[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [newSup, setNewSup] = useState<{ name: string; city: string; district: string; email: string } | null>(null);
  const min = DEFAULT_RULES.rfqMinSuppliers;
  const max = DEFAULT_RULES.rfqMaxSuppliers;
  const outside = selected.size > 0 && (selected.size < min || selected.size > max);

  const loadShortlist = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.items.shortlist(item.id);
      setShortlist(s);
      const already = new Set(item.rfqs.filter((r) => r.status !== 'cancelled').map((r) => r.supplierId));
      setSelected(new Set(s.filter((x) => !already.has(x.supplier.id)).slice(0, min).map((x) => x.supplier.id)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const createRfqs = async () => {
    if (outside && !overrideReason.trim()) {
      setError(t.items.overrideNeeded);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.items.createRfqs(item.id, {
        supplierIds: [...selected], deadlineHours, overrideReason: outside ? overrideReason.trim() : undefined,
      });
      setCreated(r);
      setShortlist(null);
      toast(t.items.rfqCreated);
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string, on: boolean) => {
    const s = new Set(selected);
    if (on) s.add(id);
    else s.delete(id);
    setSelected(s);
  };

  return (
    <Card
      title={<>{t.serviceKind[item.kind]} · {item.description}</>}
      actions={<span className="muted small">{dateRange(item.dateFrom, item.dateTo)} · {item.quantity} {unitLabel(item.unit)}</span>}
    >
      {item.rfqs.length ? (
        <div className="table-wrap">
          <table className="table table--compact">
            <caption className="table__caption">{t.items.rfqs}</caption>
            <thead><tr><th scope="col">{t.offers.supplier}</th><th scope="col">{t.common.status}</th><th scope="col">{t.publicPages.deadline}</th><th scope="col">{t.common.reason}</th><th scope="col"><span className="sr-only">İşlem</span></th></tr></thead>
            <tbody>
              {item.rfqs.map((r) => (
                <tr key={r.id}>
                  <td>{supplierName(byId, r.supplierId)}</td>
                  <td><Pill tone={r.status === 'responded' ? 'success' : r.status === 'cancelled' ? 'neutral' : r.status === 'pending_approval' ? 'warning' : 'accent'}>{t.rfqStatus[r.status]}</Pill></td>
                  <td className="nowrap">{dateTime(r.deadlineAt)}</td>
                  <td className="small">{r.overrideReason ?? '—'}</td>
                  <td className="num nowrap">
                    {r.status === 'sent' || r.status === 'responded' ? (
                      <Button size="sm" variant="ghost" icon="link" onClick={async () => {
                        try {
                          const l = await api.rfqs.link(r.id);
                          if (l.supplierLink) setLinks((m) => ({ ...m, [r.id]: l.supplierLink! }));
                        } catch (e) {
                          toast(errorMessage(e), 'danger');
                        }
                      }}>{t.items.supplierLink}</Button>
                    ) : null}
                    {r.status !== 'cancelled' && r.status !== 'closed' ? (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        const reason = window.prompt(t.items.cancelReason);
                        if (!reason) return;
                        try {
                          await api.rfqs.cancel(r.id, reason);
                          await reload();
                        } catch (e) {
                          toast(errorMessage(e), 'danger');
                        }
                      }}>{t.items.cancelRfq}</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {created.some((r) => r.supplierLink) || Object.keys(links).length ? (
        <Callout tone="success" icon="link" title={t.items.supplierLink}>
          <ul className="list">
            {created.filter((r) => r.supplierLink && !links[r.id]).map((r) => (
              <li key={r.id} className="list__row"><span>{supplierName(byId, r.supplierId)}</span><CopyLink url={r.supplierLink!} /></li>
            ))}
            {Object.entries(links).map(([rfqId, url]) => (
              <li key={rfqId} className="list__row"><span>{supplierName(byId, item.rfqs.find((x) => x.id === rfqId)?.supplierId)}</span><CopyLink url={url} /></li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {!shortlist ? (
        <div className="row">
          <Button variant="secondary" icon="sparkle" busy={busy} onClick={() => void loadShortlist()}>{t.items.loadShortlist}</Button>
          <Button variant="ghost" icon="plus" onClick={() => setNewSup({ name: '', city: '', district: '', email: '' })}>{t.items.newSupplier}</Button>
        </div>
      ) : (
        <div className="stack">
          <h3 className="section-title">{t.items.shortlist} <span className="muted small">— {t.items.selectSuppliers(min, max)} ({selected.size})</span></h3>
          <ul className="list list--selectable">
            {shortlist.map((s) => (
              <li key={s.supplier.id} className={`list__row ${selected.has(s.supplier.id) ? 'is-selected' : ''}`}>
                <Checkbox
                  checked={selected.has(s.supplier.id)}
                  onChange={(v) => toggle(s.supplier.id, v)}
                  label={<><strong>{s.supplier.name}</strong> <span className="muted small">{[s.supplier.city, s.supplier.district].filter(Boolean).join(' / ')}</span></>}
                  hint={s.reasons.join(' · ')}
                />
                <div className="list__end">
                  {s.sameDistrict ? <Pill tone="success">{t.intake.sameDistrict}</Pill> : null}
                  {s.candidate ? <Pill tone="warning">{t.intake.candidate}</Pill> : null}
                  <Pill>{t.items.score} {num(s.score)}</Pill>
                </div>
              </li>
            ))}
          </ul>
          <div className="form-grid">
            <TextInput label={t.items.deadlineHours} type="number" min={1} value={deadlineHours} onChange={(e) => setDeadlineHours(Number(e.target.value))} />
            {outside ? (
              <TextInput label={t.items.overrideReason} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} required className="span-2" warn hint={t.items.overrideNeeded} />
            ) : null}
          </div>
          <InlineError message={error} />
          <div className="row-end">
            <Button variant="ghost" icon="plus" onClick={() => setNewSup({ name: '', city: '', district: '', email: '' })}>{t.items.newSupplier}</Button>
            <Button icon="send" busy={busy} disabled={selected.size === 0} onClick={() => void createRfqs()}>{t.items.createRfqs}</Button>
          </div>
        </div>
      )}
      {!shortlist ? <InlineError message={error} /> : null}

      {newSup ? (
        <form
          className="form-grid subcard"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const s = await api.suppliers.create({ name: newSup.name, city: newSup.city, district: newSup.district || null, email: newSup.email || null, kinds: [item.kind] });
              toast(`${s.name} — ${t.supplierStatus.candidate}`);
              setNewSup(null);
              refreshSuppliers();
              if (shortlist) await loadShortlist();
            } catch (err) {
              toast(errorMessage(err), 'danger');
            }
          }}
        >
          <TextInput label={t.common.name} value={newSup.name} onChange={(e) => setNewSup({ ...newSup, name: e.target.value })} required />
          <TextInput label={t.items.city} value={newSup.city} onChange={(e) => setNewSup({ ...newSup, city: e.target.value })} required />
          <TextInput label={t.items.district} value={newSup.district} onChange={(e) => setNewSup({ ...newSup, district: e.target.value })} />
          <TextInput label={t.items.email} type="email" value={newSup.email} onChange={(e) => setNewSup({ ...newSup, email: e.target.value })} />
          <div className="span-full row-end">
            <Button variant="ghost" onClick={() => setNewSup(null)}>{t.common.cancel}</Button>
            <Button type="submit">{t.common.add}</Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
