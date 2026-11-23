import { useState } from 'react';
import { CURRENCIES, LANGUAGES, type Currency, type Customer, type CustomerRules, type Language } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useT } from '../../i18n';
import { pct } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { Button, Card, Checkbox, ErrorBox, InlineError, Loading, Pill, Select, TextArea, TextInput } from '../../components/ui';
import { CustomerRelations } from '../../components/CustomerRelations';

/** §17.2 default for a new customer: signed approval or PO, no deposit. */
const DEFAULT_CUSTOMER_RULES: CustomerRules = {
  firmApproval: 'signed_or_po', depositRate: 0, omitPaymentCancellationClauses: false, specialClauses: [], preferredLanguage: 'tr', preferredCurrency: 'EUR',
};

export function CustomersPage() {
  const t = useT();
  const res = useApi(() => api.customers.list(), []);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  if (res.error && !res.data) return <ErrorBox error={res.error} onRetry={() => void res.reload()} />;
  if (!res.data) return <Loading />;
  return (
    <div className="stack stack--lg">
      <div className="row-end"><Button variant="secondary" icon="plus" onClick={() => setEditing('new')}>{t.admin.newCustomer}</Button></div>
      {editing ? (
        <CustomerEditor
          key={editing === 'new' ? 'new' : editing.id}
          customer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            res.setData((p) => (p?.some((x) => x.id === c.id) ? p.map((x) => (x.id === c.id ? c : x)) : [c, ...(p ?? [])]));
            setEditing(null);
          }}
        />
      ) : null}
      <CustomerRelations />
      <Card title={t.admin.customers} padded={false}>
        <div className="table-wrap">
          <table className="table table--hover">
            <thead>
              <tr>
                <th scope="col">{t.common.name}</th>
                <th scope="col">{t.admin.shortCode}</th>
                <th scope="col">{t.admin.firmApproval}</th>
                <th scope="col">{t.admin.depositRate}</th>
                <th scope="col">{t.admin.perCustomerRules}</th>
              </tr>
            </thead>
            <tbody>
              {res.data.map((c) => (
                <tr key={c.id} className="is-clickable" onClick={() => setEditing(c)}>
                  <td><button type="button" className="link-btn strong" onClick={(e) => { e.stopPropagation(); setEditing(c); }}>{c.name}</button></td>
                  <td className="mono">{c.shortCode}</td>
                  <td>{c.rules.firmApproval === 'online' ? <Pill tone="success">{t.admin.firmOnline}</Pill> : <Pill tone="warning">{t.admin.firmSigned}</Pill>}</td>
                  <td>{pct(c.rules.depositRate, 0)}</td>
                  <td className="small">
                    {c.rules.omitPaymentCancellationClauses ? <Pill tone="purple">{t.admin.omitClauses}</Pill> : null}
                    {c.rules.specialClauses.length ? <span className="muted"> +{c.rules.specialClauses.length} madde</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function CustomerEditor({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: (c: Customer) => void }) {
  const t = useT();
  const toast = useToast();
  const [c, setC] = useState<Partial<Customer>>(customer ?? { name: '', shortCode: '', contacts: [], rules: DEFAULT_CUSTOMER_RULES, taxOffice: null, taxNumber: null, billingAddress: null });
  const rules = c.rules ?? DEFAULT_CUSTOMER_RULES;
  const setRules = (p: Partial<CustomerRules>) => setC({ ...c, rules: { ...rules, ...p } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title={customer ? customer.name : t.admin.newCustomer}>
      <div className="form-grid">
        <TextInput label={t.common.name} value={c.name ?? ''} onChange={(e) => setC({ ...c, name: e.target.value })} required />
        <TextInput label={t.admin.shortCode} value={c.shortCode ?? ''} onChange={(e) => setC({ ...c, shortCode: e.target.value.toUpperCase() })} required maxLength={12} />
        <TextInput label="Vergi dairesi" value={c.taxOffice ?? ''} onChange={(e) => setC({ ...c, taxOffice: e.target.value || null })} />
        <TextInput label="Vergi no" value={c.taxNumber ?? ''} onChange={(e) => setC({ ...c, taxNumber: e.target.value || null })} />
        <TextArea label="Fatura adresi" className="span-full" rows={2} value={c.billingAddress ?? ''} onChange={(e) => setC({ ...c, billingAddress: e.target.value || null })} />
      </div>
      <h3 className="section-title">{t.admin.perCustomerRules}</h3>
      <div className="form-grid">
        <Select label={t.admin.firmApproval} value={rules.firmApproval} onChange={(e) => setRules({ firmApproval: e.target.value as CustomerRules['firmApproval'] })}>
          <option value="signed_or_po">{t.admin.firmSigned}</option>
          <option value="online">{t.admin.firmOnline}</option>
        </Select>
        <TextInput label={`${t.admin.depositRate} (%)`} type="number" min={0} max={100} value={Math.round(rules.depositRate * 100)} onChange={(e) => setRules({ depositRate: Number(e.target.value) / 100 })} />
        <Select label={t.admin.preferredLanguage} value={rules.preferredLanguage} onChange={(e) => setRules({ preferredLanguage: e.target.value as Language })}>
          {LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </Select>
        <Select label={t.admin.preferredCurrency} value={rules.preferredCurrency} onChange={(e) => setRules({ preferredCurrency: e.target.value as Currency })}>
          {CURRENCIES.map((cur) => <option key={cur}>{cur}</option>)}
        </Select>
        <div className="span-full">
          <Checkbox label={t.admin.omitClauses} checked={rules.omitPaymentCancellationClauses} onChange={(v) => setRules({ omitPaymentCancellationClauses: v })} />
        </div>
        <TextArea label={t.admin.specialClauses} className="span-full" rows={3} value={rules.specialClauses.join('\n')} onChange={(e) => setRules({ specialClauses: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
      </div>
      <InlineError message={error} />
      <div className="row-end">
        <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
        <Button busy={busy} disabled={!c.name || !c.shortCode} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const saved = customer ? await api.customers.patch(customer.id, c) : await api.customers.create(c);
            toast(t.common.saved);
            onSaved(saved);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}>{t.common.save}</Button>
      </div>
    </Card>
  );
}
