import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useT } from '../../i18n';
import { dateTime, tl } from '../../lib/format';
import { PublicLayout } from '../../components/PublicLayout';
import { Icon } from '../../components/Icon';
import { Button, InlineError, Loading } from '../../components/ui';
import { InvalidLink } from './InvalidLink';

/** §17.7: customer representative approves a field extra with one tap; person, time and amount recorded. */
export function ExtraApprovalPage() {
  const t = useT();
  const { token = '' } = useParams();
  const res = useApi(() => api.public.extra(token), [token]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (res.error && !res.data) return <InvalidLink error={res.error} />;
  if (!res.data) return <PublicLayout title={t.publicPages.extraTitle}><Loading /></PublicLayout>;
  const v = res.data;

  return (
    <PublicLayout agencyName={v.agencyName} title={t.publicPages.extraTitle} subtitle={<span className="mono">{v.projectCode}</span>}>
      <div className="extra-approve">
        <p className="muted">{t.publicPages.extraIntro}</p>
        <div className="extra-approve__card">
          <div className="extra-approve__desc">{v.description}</div>
          <div className="extra-approve__amount">{tl(v.amountTry, 2)}</div>
          <div className="muted small">{dateTime(v.createdAt)}</div>
        </div>
        {v.approvedAt ? (
          <div className="extra-approve__done" role="status">
            <span className="allgood__orb allgood__orb--sm" aria-hidden><Icon name="check" size={28} /></span>
            <p>{t.publicPages.extraApproved(v.approverName ?? '', dateTime(v.approvedAt))}</p>
          </div>
        ) : (
          <div className="stack">
            <div className="field">
              <label className="field__label" htmlFor="approver">{t.publicPages.approverName}</label>
              <input id="approver" className="input input--lg" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <InlineError message={error} />
            <Button
              size="lg"
              className="btn--block btn--xl"
              icon="check"
              busy={busy}
              disabled={!name.trim()}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api.public.approveExtra(token, name.trim());
                  await res.reload();
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t.publicPages.approveExtra}
            </Button>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
