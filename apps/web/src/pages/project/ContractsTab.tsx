import { useEffect, useState } from 'react';
import type { Contract, ContractDiffItem, User } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n';
import { dateTime, eur } from '../../lib/format';
import { formatValue } from '../../components/DetailView';
import { useToast } from '../../components/Toast';
import { Button, Callout, Card, Checkbox, ConfidenceTag, EmptyState, FilePicker, InlineError, Pill, Segmented, Select, TextArea, TextInput, type Tone } from '../../components/ui';
import { useProject } from './ProjectContext';
import { supplierName, useSuppliers } from './useSuppliers';

const STATUS_TONE: Record<string, Tone> = { draft: 'neutral', diff_pending: 'warning', clean: 'success', pending_approval: 'warning', approved: 'accent', signed: 'success', amended: 'purple' };
const SEV_TONE: Record<ContractDiffItem['severity'], Tone> = { error: 'danger', warning: 'warning', info: 'neutral' };

export function ContractsTab() {
  const t = useT();
  const { detail } = useProject();
  const [creating, setCreating] = useState(false);
  return (
    <div className="stack stack--lg">
      <div className="row-between">
        <h2 className="section-title">{t.contracts.title}</h2>
        <Button variant="secondary" icon="plus" onClick={() => setCreating((x) => !x)}>{t.contracts.create}</Button>
      </div>
      {creating ? <CreateContract onDone={() => setCreating(false)} /> : null}
      {!detail.contracts.length && !creating ? <EmptyState icon="doc" title={t.contracts.noContracts} /> : null}
      {[...detail.contracts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => <ContractCard key={c.id} c={c} />)}
    </div>
  );
}

function CreateContract({ onDone }: { onDone: () => void }) {
  const t = useT();
  const { detail, reload } = useProject();
  const { byId } = useSuppliers();
  // suppliers of selected offers
  const pairs = detail.items
    .map((i) => ({ item: i, supplierId: i.offers.find((o) => o.id === i.selectedOfferId)?.supplierId ?? null }))
    .filter((p) => p.supplierId);
  const supplierIds = Array.from(new Set(pairs.map((p) => p.supplierId!)));
  const [supplierId, setSupplierId] = useState(supplierIds[0] ?? '');
  const [itemIds, setItemIds] = useState<Set<string>>(new Set(pairs.filter((p) => p.supplierId === supplierIds[0]).map((p) => p.item.id)));
  const [template, setTemplate] = useState<'agency' | 'supplier'>('agency');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidate = byId.get(supplierId)?.status === 'candidate';
  if (!supplierIds.length) return <Callout tone="warning" icon="info">Önce kalemler için teklif seçin.</Callout>;
  return (
    <Card title={t.contracts.create}>
      <div className="form-grid">
        <Select label={t.offers.supplier} value={supplierId} onChange={(e) => {
          setSupplierId(e.target.value);
          setItemIds(new Set(pairs.filter((p) => p.supplierId === e.target.value).map((p) => p.item.id)));
        }}>
          {supplierIds.map((id) => <option key={id} value={id}>{supplierName(byId, id)}</option>)}
        </Select>
        <div className="field">
          <span className="field__label">{t.contracts.template}</span>
          <Segmented label={t.contracts.template} value={template} onChange={setTemplate} options={[{ value: 'agency', label: t.contracts.agencyTemplate }, { value: 'supplier', label: t.contracts.supplierTemplate }]} />
        </div>
      </div>
      <fieldset className="stack">
        <legend className="field__label">{t.contracts.items}</legend>
        {pairs.filter((p) => p.supplierId === supplierId).map((p) => (
          <Checkbox key={p.item.id} label={`${t.serviceKind[p.item.kind]} · ${p.item.description}`} checked={itemIds.has(p.item.id)} onChange={(v) => {
            const s = new Set(itemIds);
            if (v) s.add(p.item.id);
            else s.delete(p.item.id);
            setItemIds(s);
          }} />
        ))}
      </fieldset>
      {candidate ? <Callout tone="danger" icon="alert">{t.contracts.candidateLock}</Callout> : null}
      <InlineError message={error} />
      <div className="row-end">
        <Button variant="ghost" onClick={onDone}>{t.common.cancel}</Button>
        <Button busy={busy} disabled={!itemIds.size} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.projects.createContract(detail.project.id, { supplierId, serviceItemIds: [...itemIds], template });
            await reload();
            onDone();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}>{t.common.create}</Button>
      </div>
    </Card>
  );
}

function ContractCard({ c }: { c: Contract }) {
  const t = useT();
  const toast = useToast();
  const { user } = useAuth();
  const { reload } = useProject();
  const { byId } = useSuppliers();
  const [panel, setPanel] = useState<'none' | 'parse' | 'sign' | 'amend'>('none');
  const [text, setText] = useState('');
  // signedBy is the signatory's user id (admin or canSign), not a free-text name
  const [signedBy, setSignedBy] = useState('');
  const [signatories, setSignatories] = useState<User[]>([]);
  useEffect(() => {
    if (panel !== 'sign' || signatories.length) return;
    api.users.list().then((us) => {
      const s = us.filter((u) => u.active !== false && (u.role === 'admin' || u.canSign));
      setSignatories(s);
      setSignedBy((cur) => cur || (s.find((u) => u.id === user?.id) ?? s[0])?.id || '');
    }).catch((e) => setError(errorMessage(e)));
  }, [panel, signatories.length, user?.id]);
  const [scan, setScan] = useState<File | null>(null);
  const [amendText, setAmendText] = useState('');
  const [amendReason, setAmendReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
      setPanel('none');
      toast(t.common.saved);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const errors = c.diff.filter((d) => d.severity === 'error').length;
  const canSign = (c.status === 'approved' || c.status === 'clean') && !c.locked && (user?.canSign || user?.role === 'admin' || user?.role === 'signatory');

  return (
    <Card
      title={<>{supplierName(byId, c.supplierId)} · v{c.version} <Pill tone={STATUS_TONE[c.status] ?? 'neutral'}>{t.contractStatus[c.status]}</Pill>{c.locked ? <Pill icon="shield">{t.contracts.locked}</Pill> : null}</>}
      actions={
        !c.locked ? (
          <div className="row">
            <Button size="sm" variant="secondary" icon="sparkle" onClick={() => setPanel(panel === 'parse' ? 'none' : 'parse')}>{t.contracts.parse}</Button>
            <Button size="sm" variant="secondary" icon="refresh" busy={busy && panel === 'none'} onClick={() => void run(() => api.contracts.compare(c.id))}>{t.contracts.compare}</Button>
            {canSign ? <Button size="sm" icon="check" onClick={() => setPanel('sign')}>{t.contracts.sign}</Button> : null}
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setPanel(panel === 'amend' ? 'none' : 'amend')}>{t.contracts.amend}</Button>
        )
      }
    >
      <div className="muted small row">
        <span>{c.template === 'agency' ? t.contracts.agencyTemplate : t.contracts.supplierTemplate}</span>
        {c.extractionConfidence !== null ? <span>{t.common.confidence}: <ConfidenceTag value={c.extractionConfidence} /></span> : null}
        {c.signedAt ? <span>{t.contractStatus.signed}: {dateTime(c.signedAt)}</span> : null}
        {c.amendmentOf ? <span>{t.contracts.amend}</span> : null}
      </div>

      {c.conditionRiskEur ? (
        <Callout tone="danger" icon="alert" title={`${t.contracts.conditionRisk}: ${eur(c.conditionRiskEur)}`}>{c.conditionRiskNote}</Callout>
      ) : null}

      {c.diff.length ? (
        <div className="table-wrap">
          <table className="table table--compact">
            <caption className="table__caption">{t.contracts.diff} {errors ? <Pill tone="danger">{errors} {t.contracts.severityLabel.error}</Pill> : null}</caption>
            <thead>
              <tr>
                <th scope="col">{t.contracts.field}</th>
                <th scope="col">{t.contracts.contractValue}</th>
                <th scope="col">{t.contracts.quoteValue}</th>
                <th scope="col">{t.contracts.severity}</th>
                <th scope="col">{t.common.description}</th>
              </tr>
            </thead>
            <tbody>
              {c.diff.map((d, i) => (
                <tr key={i} className={`diff diff--${d.kind === 'value_add' ? 'value-add' : d.severity}`}>
                  <th scope="row">{d.label}</th>
                  <td>{formatValue(d.field, d.contractValue)}</td>
                  <td>{formatValue(d.field, d.quoteValue)}</td>
                  <td>{d.kind === 'value_add' ? <Pill tone="purple">Katma değer</Pill> : <Pill tone={SEV_TONE[d.severity]}>{t.contracts.severityLabel[d.severity]}</Pill>}</td>
                  <td className="small">{d.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : c.status !== 'draft' ? <Callout tone="success" icon="check">{t.contracts.noDiff}</Callout> : null}

      {panel === 'parse' ? (
        <div className="subcard stack">
          <TextArea label={t.common.paste} rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row-between">
            <FilePicker label={t.common.upload} accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" disabled={busy} onFile={(f) => void run(() => api.contracts.parseFile(c.id, f))} />
            <Button icon="sparkle" busy={busy} disabled={!text.trim()} onClick={() => void run(() => api.contracts.parseText(c.id, text))}>{t.contracts.parse}</Button>
          </div>
        </div>
      ) : null}

      {panel === 'sign' ? (
        <div className="subcard form-grid">
          <Select label={t.contracts.signedBy} value={signedBy} onChange={(e) => setSignedBy(e.target.value)} required>
            {signatories.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </Select>
          <div className="field">
            <span className="field__label">{t.contracts.scanFile}</span>
            <FilePicker label={t.contracts.scanFile} accept=".pdf,.png,.jpg,.jpeg" onFile={setScan} />
          </div>
          <div className="span-full row-end">
            <Button variant="ghost" onClick={() => setPanel('none')}>{t.common.cancel}</Button>
            <Button icon="check" busy={busy} disabled={!signedBy || !scan} onClick={() => void run(() => api.contracts.sign(c.id, { signedBy, scanFileName: scan?.name }))}>{t.contracts.sign}</Button>
          </div>
        </div>
      ) : null}

      {panel === 'amend' ? (
        <div className="subcard stack">
          <TextArea label={t.contracts.changes} rows={4} value={amendText} onChange={(e) => setAmendText(e.target.value)} />
          <TextInput label={t.common.reason} value={amendReason} onChange={(e) => setAmendReason(e.target.value)} required />
          <div className="row-end">
            <Button variant="ghost" onClick={() => setPanel('none')}>{t.common.cancel}</Button>
            <Button busy={busy} disabled={!amendText.trim() || !amendReason.trim()} onClick={() => void run(() => api.contracts.amend(c.id, { changes: { text: amendText }, reason: amendReason }))}>{t.contracts.amend}</Button>
          </div>
        </div>
      ) : null}
      <InlineError message={error} />
    </Card>
  );
}
