// §7 Adım 7 — tenant-wide finance screen (finance + admin): bank statement import with matching summary, bank transactions
// (matched / suggested / unmatched, manual match), approved payments to mark paid, commissions reconciliation, Mikro export and —
// for the admin — the unreflected price differences (field extras not passed on to the customer). The system never moves money.
import { useMemo, useState } from 'react';
import type { BankStatementImportResult, BankTransaction, FinanceEntry } from '@mice/shared';
import { api, errorMessage } from '../api/client';
import { useApi } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n';
import { date, eur, money, pct, tl, todayISO } from '../lib/format';
import { PageHeader } from '../components/AppShell';
import { useToast } from '../components/Toast';
import { ManualMatchAction, MarkPaidAction, ReconcileAction, entryLabel } from '../components/FinanceActions';
import { Button, Callout, Card, ErrorBox, FilePicker, InlineError, Loading, Pill, Segmented, Stat, TextInput, type Tone } from '../components/ui';

const TX_TONE: Record<string, Tone> = { matched: 'success', suggested: 'warning', unmatched: 'danger', ignored: 'neutral' };
type TxFilter = 'all' | BankTransaction['status'];

export function FinancePage() {
  const t = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const entries = useApi(() => api.finance.entries(), []);
  const kindLabel = (e: FinanceEntry) => t.financeKind[e.kind] ?? e.kind;

  if (user && !['admin', 'finance'].includes(user.role)) {
    return <div className="page"><PageHeader title={t.finance.pageTitle} /><Callout tone="warning" icon="shield">{t.admin.adminOnly}</Callout></div>;
  }
  return (
    <div className="page finance-page">
      <PageHeader title={t.finance.pageTitle} subtitle={t.finance.pageSubtitle} />
      <div className="stack stack--lg">
        <BankCard entries={entries.data ?? []} kindLabel={kindLabel} onChanged={() => void entries.reload()} />
        <div className="grid-2 grid-2--top">
          <ApprovedPayments entries={entries.data} loading={entries.loading} error={entries.error} onChanged={(n) => entries.setData((p) => (p ?? []).map((x) => (x.id === n.id ? n : x)))} />
          <MikroCard />
        </div>
        <Commissions entries={entries.data} onChanged={(n) => entries.setData((p) => (p ?? []).map((x) => (x.id === n.id ? n : x)))} />
        {isAdmin ? <UnreflectedCard /> : null}
      </div>
    </div>
  );
}

function BankCard({ entries, kindLabel, onChanged }: { entries: FinanceEntry[]; kindLabel: (e: FinanceEntry) => string; onChanged: () => void }) {
  const t = useT();
  const toast = useToast();
  const [filter, setFilter] = useState<TxFilter>('all');
  const txs = useApi(() => api.finance.bankTransactions(), []);
  const [summary, setSummary] = useState<BankStatementImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = (txs.data ?? []).filter((x) => filter === 'all' || x.status === filter);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const count = (s: BankTransaction['status']) => (txs.data ?? []).filter((x) => x.status === s).length;

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.finance.bankStatement(file);
      setSummary(r);
      await txs.reload();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t.finance.bank} padded={false} actions={<FilePicker label={busy ? t.common.loading : t.finance.uploadStatement} accept=".csv,.txt,.xlsx" disabled={busy} onFile={(f) => void upload(f)} />}>
      <div className="card--padded stack">
        <p className="muted small">{t.finance.statementHint}</p>
        <InlineError message={error} />
        {summary ? (
          <section aria-label={t.finance.importSummary} className="stats">
            <Stat label={t.finance.imported} value={summary.imported} />
            <Stat label={t.finance.matched} value={summary.matched} tone="success" />
            <Stat label={t.finance.suggested} value={summary.suggested} tone={summary.suggested ? 'warning' : undefined} />
            <Stat label={t.finance.unmatched} value={summary.unmatched} tone={summary.unmatched ? 'danger' : undefined} />
            <Stat label={t.finance.duplicates} value={summary.duplicates} />
          </section>
        ) : null}
        <Segmented<TxFilter>
          label={t.finance.transactions}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `${t.common.all} (${txs.data?.length ?? 0})` },
            { value: 'unmatched', label: `${t.finance.txStatus.unmatched} (${count('unmatched')})` },
            { value: 'suggested', label: `${t.finance.txStatus.suggested} (${count('suggested')})` },
            { value: 'matched', label: `${t.finance.txStatus.matched} (${count('matched')})` },
          ]}
        />
      </div>
      {txs.error ? <div className="card--padded"><ErrorBox error={txs.error} onRetry={() => void txs.reload()} /></div> : null}
      {txs.loading && !txs.data ? <Loading /> : null}
      {txs.data && !shown.length ? <p className="muted card--padded">{t.finance.noTransactions}</p> : null}
      {shown.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t.common.date}</th>
                <th scope="col">{t.common.description}</th>
                <th scope="col" className="num">{t.common.amount}</th>
                <th scope="col">{t.common.status}</th>
                <th scope="col">{t.finance.matchTo}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => {
                const m = x.matchedEntryId ? byId.get(x.matchedEntryId) : undefined;
                return (
                  <tr key={x.id}>
                    <td className="nowrap">{date(x.bookedAt)}</td>
                    <td>{x.description}{x.counterparty ? <div className="muted small">{x.counterparty}</div> : null}</td>
                    <td className={`num ${x.amount < 0 ? 'text-danger' : 'text-success'}`}>{money(x.amount, x.currency)}</td>
                    <td>
                      <Pill tone={TX_TONE[x.status] ?? 'neutral'}>{t.finance.txStatus[x.status] ?? x.status}</Pill>
                      {x.matchConfidence != null ? <div className="muted small">{t.common.confidence} {pct(x.matchConfidence, 0)}</div> : null}
                    </td>
                    <td>
                      {m ? <div className="small">{entryLabel(m, kindLabel(m))}</div> : null}
                      {x.status !== 'matched' ? (
                        <ManualMatchAction tx={x} entries={entries} kindLabel={kindLabel} onDone={(n) => {
                          txs.setData((p) => (p ?? []).map((y) => (y.id === n.id ? n : y)));
                          onChanged();
                          toast(t.finance.matched);
                        }} />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

function ApprovedPayments({ entries, loading, error, onChanged }: { entries: FinanceEntry[] | undefined; loading: boolean; error: unknown; onChanged: (e: FinanceEntry) => void }) {
  const t = useT();
  const toast = useToast();
  const approved = (entries ?? []).filter((e) => ['payable', 'supplier_invoice'].includes(e.kind) && e.status === 'approved');
  return (
    <Card title={t.finance.approvedPayments}>
      {error ? <ErrorBox error={error} /> : null}
      {loading && !entries ? <Loading /> : null}
      {entries && !approved.length ? <p className="muted">{t.finance.noApproved}</p> : null}
      <ul className="list">
        {approved.map((e) => (
          <li key={e.id} className="list__row">
            <div>
              <div>{e.invoiceNo ?? e.reference ?? t.financeKind[e.kind]} <span className="muted small">· {t.financeKind[e.kind]}</span></div>
              <div className="muted small">{money(e.amount, e.currency)}{e.dueDate ? ` · ${t.finance.dueDate} ${date(e.dueDate)}` : ''}</div>
            </div>
            <MarkPaidAction entry={e} onDone={(n) => { onChanged(n); toast(t.finance.markedPaid); }} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MikroCard() {
  const t = useT();
  const today = todayISO();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title={t.finance.mikro}>
      <p className="muted small">{t.finance.mikroHint}</p>
      <div className="form-grid">
        <TextInput label={t.finance.from} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextInput label={t.finance.to} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <InlineError message={error} />
      <div className="row-end">
        <Button icon="doc" busy={busy} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.finance.mikroExport({ from: from || undefined, to: to || undefined });
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}>{t.finance.mikroDownload}</Button>
      </div>
    </Card>
  );
}

function Commissions({ entries, onChanged }: { entries: FinanceEntry[] | undefined; onChanged: (e: FinanceEntry) => void }) {
  const t = useT();
  const toast = useToast();
  const list = (entries ?? []).filter((e) => e.kind === 'commission');
  return (
    <Card title={t.finance.commissions} padded={false}>
      {!list.length ? <p className="muted card--padded">{t.finance.noCommissions}</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th scope="col">{t.finance.reference}</th><th scope="col">{t.finance.invoiceNo}</th><th scope="col" className="num">{t.common.amount}</th><th scope="col">{t.common.status}</th><th scope="col"><span className="sr-only">İşlem</span></th></tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id}>
                  <td>{e.reference ?? '—'}</td>
                  <td>{e.invoiceNo ?? '—'}</td>
                  <td className="num">{money(e.amount, e.currency)}</td>
                  <td><Pill tone={e.status === 'matched' ? 'success' : 'accent'}>{e.status === 'matched' ? t.finance.reconciled : t.financeStatus[e.status] ?? e.status}</Pill></td>
                  <td>{e.status === 'open' ? <ReconcileAction entry={e} onDone={(n) => { onChanged(n); toast(t.finance.reconciled); }} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Admin: field extras NOT reflected to the customer (§17.1 "yansıtılmayan fiyat farkları"), per project and per customer. */
function UnreflectedCard() {
  const t = useT();
  const res = useApi(() => api.fieldExtras.unreflectedTotals(), []);
  return (
    <Card title={t.finance.unreflected} actions={res.data ? <strong>{eur(res.data.totalEur)} <span className="muted small">· {tl(res.data.totalTry)}</span></strong> : null}>
      {res.error ? <ErrorBox error={res.error} onRetry={() => void res.reload()} /> : null}
      {res.loading && !res.data ? <Loading /> : null}
      {res.data && !res.data.byProject.length ? <p className="muted">{t.finance.noUnreflected}</p> : null}
      {res.data?.byProject.length ? (
        <div className="grid-2 grid-2--top">
          <section>
            <h3 className="section-title">{t.finance.byProject}</h3>
            <ul className="list">
              {res.data.byProject.map((r) => (
                <li key={r.projectId} className="list__row">
                  <span className="mono small">{r.code}</span>
                  <span className="num"><strong>{tl(r.amountTry)}</strong> <span className="muted small">{eur(r.amountEur)} · {r.count}</span></span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="section-title">{t.finance.byCustomer}</h3>
            <ul className="list">
              {res.data.byCustomer.map((r, i) => (
                <li key={r.customerId ?? i} className="list__row">
                  <span>{r.customerName ?? '—'}</span>
                  <span className="num"><strong>{tl(r.amountTry)}</strong> <span className="muted small">{eur(r.amountEur)}</span></span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </Card>
  );
}
