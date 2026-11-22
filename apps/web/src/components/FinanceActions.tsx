// Small inline finance actions shared by the project Finans tab and the /finans page.
// The system never moves money (§6): "Ödendi" only records a payment a human made in the bank after the admin approval.
import { useState } from 'react';
import type { BankTransaction, FinanceEntry } from '@mice/shared';
import { api, errorMessage } from '../api/client';
import { useT } from '../i18n';
import { money, todayISO } from '../lib/format';
import { Button, InlineError } from './ui';

export function MarkPaidAction({ entry, onDone }: { entry: FinanceEntry; onDone: (e: FinanceEntry) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState('');
  const [paidAt, setPaidAt] = useState(todayISO());
  // Q5: what was actually paid and the proof of its rate (rate or TL amount); EUR paid in EUR → no rate (TCMB value-date rate)
  const [paidCurrency, setPaidCurrency] = useState<FinanceEntry['currency']>(entry.currency);
  const [paidAmount, setPaidAmount] = useState(String(entry.amount));
  const [rate, setRate] = useState('');
  const [tryAmount, setTryAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button size="sm" variant="secondary" icon="check" onClick={() => setOpen(true)}>{t.finance.markPaid}</Button>;
  const num = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : undefined);
  const converted = paidCurrency !== entry.currency;
  return (
    <div className="inline-form">
      <label className="sr-only" htmlFor={`ref-${entry.id}`}>{t.finance.paymentRef}</label>
      <input id={`ref-${entry.id}`} className="input input--sm" placeholder={t.finance.paymentRef} value={ref} onChange={(e) => setRef(e.target.value)} />
      <label className="sr-only" htmlFor={`pd-${entry.id}`}>{t.finance.paidAt}</label>
      <input id={`pd-${entry.id}`} className="input input--sm" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
      <div className="row row--wrap">
        <label className="sr-only" htmlFor={`pc-${entry.id}`}>{t.finance.paidCurrency}</label>
        <select id={`pc-${entry.id}`} className="input input--sm select" value={paidCurrency}
          onChange={(e) => { const c = e.target.value as FinanceEntry['currency']; setPaidCurrency(c); if (c === entry.currency) setPaidAmount(String(entry.amount)); else setPaidAmount(''); }}>
          {[...new Set([entry.currency, 'EUR', 'TRY'])].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="sr-only" htmlFor={`pa-${entry.id}`}>{t.finance.paidAmount}</label>
        <input id={`pa-${entry.id}`} className="input input--sm" inputMode="decimal" placeholder={t.finance.paidAmount} value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} />
        <label className="sr-only" htmlFor={`pr-${entry.id}`}>{t.finance.eurTryRate}</label>
        <input id={`pr-${entry.id}`} className="input input--sm" inputMode="decimal" placeholder={t.finance.eurTryRate} value={rate} onChange={(e) => setRate(e.target.value)} />
        {paidCurrency !== 'TRY' ? (
          <>
            <label className="sr-only" htmlFor={`pt-${entry.id}`}>{t.finance.tryAmount}</label>
            <input id={`pt-${entry.id}`} className="input input--sm" inputMode="decimal" placeholder={t.finance.tryAmount} value={tryAmount} onChange={(e) => setTryAmount(e.target.value)} />
          </>
        ) : null}
      </div>
      <p className="muted small">{converted ? t.finance.rateHintConverted : t.finance.rateHintSame}</p>
      <div className="row">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
        <Button size="sm" busy={busy} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            onDone(await api.finance.markPaid(entry.id, {
              reference: ref.trim() || undefined, paidAt: paidAt || undefined,
              paidCurrency, paidAmount: num(paidAmount), eurTryRate: num(rate), tryAmount: paidCurrency !== 'TRY' ? num(tryAmount) : undefined,
            }));
            setOpen(false);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}>{t.common.save}</Button>
      </div>
      <InlineError message={error} />
    </div>
  );
}

export function ReconcileAction({ entry, onDone }: { entry: FinanceEntry; onDone: (e: FinanceEntry) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState(entry.invoiceNo ?? '');
  const [amount, setAmount] = useState(String(entry.amount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{t.finance.reconcile}</Button>;
  return (
    <div className="inline-form">
      <label className="sr-only" htmlFor={`ci-${entry.id}`}>{t.finance.commissionInvoiceNo}</label>
      <input id={`ci-${entry.id}`} className="input input--sm" placeholder={t.finance.commissionInvoiceNo} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
      <label className="sr-only" htmlFor={`ca-${entry.id}`}>{t.common.amount}</label>
      <input id={`ca-${entry.id}`} className="input input--sm" type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
      <div className="row">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
        <Button size="sm" busy={busy} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            onDone(await api.finance.reconcileCommission(entry.id, { invoiceNo: invoiceNo.trim() || undefined, amount: amount ? Number(amount) : undefined }));
            setOpen(false);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}>{t.common.save}</Button>
      </div>
      <InlineError message={error} />
    </div>
  );
}

/** Label for a finance entry in a picker: kind · invoice/reference · amount. */
export function entryLabel(e: FinanceEntry, kindLabel: string): string {
  return `${kindLabel} · ${e.invoiceNo ?? e.reference ?? '—'} · ${money(e.amount, e.currency)}`;
}

/** Manual match of a bank transaction to a finance entry of the same direction (correction = learning data). */
export function ManualMatchAction({ tx, entries, kindLabel, onDone }: { tx: BankTransaction; entries: FinanceEntry[]; kindLabel: (e: FinanceEntry) => string; onDone: (t: BankTransaction) => void }) {
  const t = useT();
  const out = tx.amount < 0;
  const candidates = entries.filter((e) => (out ? ['payable', 'supplier_invoice'] : ['receivable', 'customer_invoice', 'commission']).includes(e.kind) && !['matched', 'cancelled'].includes(e.status));
  const [entryId, setEntryId] = useState(tx.matchedEntryId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="inline-form">
      <label className="sr-only" htmlFor={`m-${tx.id}`}>{t.finance.matchTo}</label>
      <select id={`m-${tx.id}`} className="input input--sm select" value={entryId} onChange={(e) => setEntryId(e.target.value)}>
        <option value="">{t.finance.matchTo} —</option>
        {candidates.map((e) => <option key={e.id} value={e.id}>{entryLabel(e, kindLabel(e))}</option>)}
      </select>
      <Button size="sm" variant="secondary" busy={busy} disabled={!entryId} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          onDone(await api.finance.matchBankTransaction(tx.id, entryId));
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}>{t.finance.match}</Button>
      <InlineError message={error} />
    </div>
  );
}
