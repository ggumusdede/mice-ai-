import { useState, type FormEvent } from 'react';
import type { FinanceEntry } from '@mice/shared';
import { CURRENCIES, type SupplierInvoiceInput } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useT } from '../../i18n';
import { date, eur, money } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { Button, Callout, Card, Checkbox, ErrorBox, FilePicker, InlineError, Loading, Pill, Select, TextInput, type Tone } from '../../components/ui';
import { useProject } from './ProjectContext';
import { MarkPaidAction, ReconcileAction } from '../../components/FinanceActions';
import { supplierName, useSuppliers } from './useSuppliers';

const PART_LABEL: Record<string, string> = { prepayment: 'Ön ödeme', balance: 'Bakiye', deposit: 'Kapora', full: 'Tamamı' };
const STATUS_TONE: Record<string, Tone> = { open: 'accent', pending_approval: 'warning', approved: 'success', paid: 'success', matched: 'success', cancelled: 'neutral' };

export function FinanceTab() {
  const t = useT();
  const toast = useToast();
  const { detail } = useProject();
  const { byId } = useSuppliers();
  const res = useApi(() => api.finance.entries({ projectId: detail.project.id }), [detail.project.id]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const { reload: reloadProject } = useProject();
  // references of contract entries are the project code (at signing time) — redundant inside the project
  const projectSeq = detail.project.code.split('-').slice(0, 2).join('-');
  const replace = (n: FinanceEntry) => {
    res.setData((p) => (p ?? []).map((x) => (x.id === n.id ? n : x)));
    void reloadProject();
  };

  return (
    <div className="stack stack--lg">
      <Card
        title={t.finance.entries}
        padded={false}
        actions={
          <Button size="sm" variant="secondary" icon="doc" busy={draftBusy} onClick={async () => {
            setDraftBusy(true);
            try {
              const doc = await api.projects.customerInvoiceDraft(detail.project.id);
              toast(`${t.docKind.customer_invoice_draft} v${doc.version}`);
            } catch (e) {
              toast(errorMessage(e), 'danger');
            } finally {
              setDraftBusy(false);
            }
          }}>{t.finance.customerInvoiceDraft}</Button>
        }
      >
        {res.error ? <div className="card--padded"><ErrorBox error={res.error} onRetry={() => void res.reload()} /></div> : null}
        {res.loading && !res.data ? <Loading /> : null}
        {res.data && !res.data.length ? <p className="muted card--padded">{t.finance.noEntries}</p> : null}
        {res.data?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t.finance.kind}</th>
                  <th scope="col">{t.finance.supplier}</th>
                  <th scope="col">{t.finance.invoiceNo} / {t.finance.reference}</th>
                  <th scope="col" className="num">{t.common.amount}</th>
                  <th scope="col" className="num">EUR</th>
                  <th scope="col">{t.finance.dueDate}</th>
                  <th scope="col">{t.common.status}</th>
                  <th scope="col"><span className="sr-only">İşlem</span></th>
                </tr>
              </thead>
              <tbody>
                {res.data.map((e) => (
                  <tr key={e.id}>
                    <td>{t.financeKind[e.kind]}</td>
                    <td>{e.supplierId ? supplierName(byId, e.supplierId) : '—'}</td>
                    <td className="small">{e.invoiceNo ?? (e.reference && !e.reference.startsWith(projectSeq) ? e.reference : '—')}{typeof e.meta?.part === 'string' ? <div className="muted">{PART_LABEL[e.meta.part] ?? e.meta.part}</div> : null}</td>
                    <td className="num nowrap">{money(e.amount, e.currency)}</td>
                    <td className="num nowrap">{eur(e.amountEur)}</td>
                    <td className="nowrap">{date(e.dueDate)}</td>
                    <td><Pill tone={STATUS_TONE[e.status] ?? 'neutral'}>{t.financeStatus[e.status] ?? e.status}</Pill></td>
                    <td className="num">
                      {(e.kind === 'payable' || e.kind === 'supplier_invoice') && e.status === 'open' ? (
                        <Button size="sm" variant="secondary" busy={busyId === e.id} onClick={async () => {
                          setBusyId(e.id);
                          try {
                            const n = await api.finance.paymentRequest(e.id);
                            res.setData((p) => (p ?? []).map((x) => (x.id === n.id ? n : x)));
                            toast(t.finance.paymentRequested);
                          } catch (err) {
                            toast(errorMessage(err), 'danger');
                          } finally {
                            setBusyId(null);
                          }
                        }}>{t.finance.paymentRequest}</Button>
                      ) : null}
                      {(e.kind === 'payable' || e.kind === 'supplier_invoice') && e.status === 'approved' ? (
                        <MarkPaidAction entry={e} onDone={(n) => { replace(n); toast(t.finance.markedPaid); }} />
                      ) : null}
                      {e.kind === 'commission' && e.status === 'open' ? (
                        <ReconcileAction entry={e} onDone={(n) => { replace(n); toast(t.finance.reconciled); }} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
      <SupplierInvoiceForm onSaved={() => void res.reload()} />
      <CustomerInvoiceForm onSaved={() => { void res.reload(); void reloadProject(); }} />
    </div>
  );
}

function SupplierInvoiceForm({ onSaved }: { onSaved: () => void }) {
  const t = useT();
  const { detail } = useProject();
  const { byId } = useSuppliers();
  const supplierIds = Array.from(new Set(detail.items.flatMap((i) => i.offers.filter((o) => o.id === i.selectedOfferId).map((o) => o.supplierId))));
  const [f, setF] = useState<SupplierInvoiceInput>({
    projectId: detail.project.id, supplierId: supplierIds[0] ?? '', invoiceNo: '', amount: 0, currency: 'TRY', issueDate: new Date().toISOString().slice(0, 10), serviceItemIds: [],
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alarms, setAlarms] = useState<string[] | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = file
        ? await api.finance.supplierInvoiceFile(file, {
            projectId: f.projectId, supplierId: f.supplierId, invoiceNo: f.invoiceNo, amount: String(f.amount), currency: f.currency, issueDate: f.issueDate,
            ...(f.dueDate ? { dueDate: f.dueDate } : {}), ...(f.vatAmount !== undefined ? { vatAmount: String(f.vatAmount) } : {}),
            ...(f.serviceItemIds?.length ? { serviceItemIds: f.serviceItemIds.join(',') } : {}),
          })
        : await api.finance.supplierInvoice(f);
      setAlarms(r.alarms);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t.finance.supplierInvoice}>
      <form className="form-grid" onSubmit={submit}>
        <Select label={t.finance.supplier} value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })} required>
          <option value="" disabled>—</option>
          {supplierIds.map((id) => <option key={id} value={id}>{supplierName(byId, id)}</option>)}
        </Select>
        <TextInput label={t.finance.invoiceNo} value={f.invoiceNo} onChange={(e) => setF({ ...f, invoiceNo: e.target.value })} required />
        <TextInput label={t.common.amount} type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} required />
        <Select label={t.common.currency} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <TextInput label={t.finance.vat} type="number" min={0} step="0.01" value={f.vatAmount ?? ''} onChange={(e) => setF({ ...f, vatAmount: e.target.value ? Number(e.target.value) : undefined })} />
        <TextInput label={t.finance.issueDate} type="date" value={f.issueDate} onChange={(e) => setF({ ...f, issueDate: e.target.value })} required />
        <TextInput label={t.finance.dueDate} type="date" value={f.dueDate ?? ''} onChange={(e) => setF({ ...f, dueDate: e.target.value || undefined })} />
        <div className="field">
          <span className="field__label">{t.finance.uploadInvoice}</span>
          <FilePicker label={t.common.upload} accept=".pdf,.xml,.png,.jpg,.jpeg" onFile={setFile} />
        </div>
        <fieldset className="span-full stack">
          <legend className="field__label">{t.contracts.items}</legend>
          <div className="chips">
            {detail.items.map((i) => (
              <Checkbox key={i.id} label={`${t.serviceKind[i.kind]} · ${i.description}`} checked={!!f.serviceItemIds?.includes(i.id)} onChange={(v) => setF({ ...f, serviceItemIds: v ? [...(f.serviceItemIds ?? []), i.id] : (f.serviceItemIds ?? []).filter((x) => x !== i.id) })} />
            ))}
          </div>
        </fieldset>
        {alarms ? (
          alarms.length ? (
            <div className="span-full"><Callout tone="danger" icon="alert" title={t.finance.alarms}><ul className="bullets">{alarms.map((a, i) => <li key={i}>{a}</li>)}</ul></Callout></div>
          ) : <div className="span-full"><Callout tone="success" icon="check">{t.common.saved}</Callout></div>
        ) : null}
        <div className="span-full row-end">
          <InlineError message={error} />
          <Button type="submit" busy={busy} disabled={!f.supplierId || !f.invoiceNo}>{t.common.save}</Button>
        </div>
      </form>
    </Card>
  );
}

/** The customer invoice is issued in Mikro by accounting (§17.8); its number and amount are recorded here. */
function CustomerInvoiceForm({ onSaved }: { onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const { detail } = useProject();
  const accepted = detail.quotes.find((q) => q.status === 'accepted' && q.acceptedOptionNo != null) ?? null;
  const opt = accepted?.options.find((o) => o.optionNo === accepted.acceptedOptionNo) ?? null;
  const suggested = opt && accepted ? Math.round(opt.totals.saleEur * accepted.fxRate * 100) / 100 : 0;
  const [f, setF] = useState({ invoiceNo: '', amount: suggested, currency: (accepted?.currency ?? 'EUR') as string, vatAmount: '' as string, issueDate: new Date().toISOString().slice(0, 10), dueDate: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.finance.customerInvoice({
        projectId: detail.project.id, invoiceNo: f.invoiceNo.trim(), amount: Number(f.amount), currency: f.currency,
        ...(f.vatAmount ? { vatAmount: Number(f.vatAmount) } : {}), issueDate: f.issueDate, ...(f.dueDate ? { dueDate: f.dueDate } : {}),
      });
      toast(t.finance.invoiceRecorded);
      setF({ ...f, invoiceNo: '' });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={t.finance.customerInvoice}>
      <p className="muted small">{t.finance.customerInvoiceHint}</p>
      <form className="form-grid" onSubmit={submit} aria-label={t.finance.customerInvoice}>
        <TextInput label={t.finance.invoiceNo} value={f.invoiceNo} onChange={(e) => setF({ ...f, invoiceNo: e.target.value })} required />
        <TextInput label={`${t.common.amount} (matrah)`} type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} required />
        <Select label={t.common.currency} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <TextInput label={t.finance.vat} type="number" min={0} step="0.01" value={f.vatAmount} onChange={(e) => setF({ ...f, vatAmount: e.target.value })} />
        <TextInput label={t.finance.issueDate} type="date" value={f.issueDate} onChange={(e) => setF({ ...f, issueDate: e.target.value })} required />
        <TextInput label={t.finance.dueDate} type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
        <div className="span-full row-end">
          <InlineError message={error} />
          <Button type="submit" busy={busy} disabled={!f.invoiceNo.trim() || !(Number(f.amount) > 0)}>{t.finance.recordInvoice}</Button>
        </div>
      </form>
    </Card>
  );
}
