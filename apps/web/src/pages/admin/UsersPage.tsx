import { useState } from 'react';
import { AUTHORITY_LEVELS, ROLES, type AuthorityLevel, type Role, type User, type UserStats } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n';
import { pct } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorBox, Loading, Pill } from '../../components/ui';

export function UsersPage() {
  const t = useT();
  const res = useApi(() => api.users.list(), []);
  if (res.error && !res.data) return <ErrorBox error={res.error} onRetry={() => void res.reload()} />;
  if (!res.data) return <Loading />;
  return (
    <Card title={t.admin.users} padded={false}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t.common.name}</th>
              <th scope="col">Rol</th>
              <th scope="col">{t.admin.authorityLevel}</th>
              <th scope="col">{t.admin.canSign}</th>
              <th scope="col">{t.admin.stats}</th>
              <th scope="col"><span className="sr-only">İşlem</span></th>
            </tr>
          </thead>
          <tbody>
            {res.data.map((u) => <UserRow key={u.id} u={u} onSaved={(n) => res.setData((p) => (p ?? []).map((x) => (x.id === n.id ? n : x)))} />)}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function UserRow({ u, onSaved }: { u: User; onSaved: (u: User) => void }) {
  const t = useT();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [role, setRole] = useState<Role>(u.role);
  const [level, setLevel] = useState<AuthorityLevel>(u.authorityLevel);
  const [canSign, setCanSign] = useState(u.canSign);
  const [scope, setScope] = useState((u.authorityScope.eventTypes ?? []).join(', '));
  const [stats, setStats] = useState<UserStats | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = role !== u.role || level !== u.authorityLevel || canSign !== u.canSign || scope !== (u.authorityScope.eventTypes ?? []).join(', ');
  return (
    <tr>
      <td><strong>{u.fullName}</strong><div className="muted small">{u.email}</div>{!u.active ? <Pill>Pasif</Pill> : null}</td>
      <td>
        <label className="sr-only" htmlFor={`role-${u.id}`}>Rol</label>
        <select id={`role-${u.id}`} className="input select input--sm" disabled={!isAdmin} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => <option key={r} value={r}>{t.role[r]}</option>)}
        </select>
      </td>
      <td>
        <label className="sr-only" htmlFor={`lvl-${u.id}`}>{t.admin.authorityLevel}</label>
        <select id={`lvl-${u.id}`} className="input select input--sm" disabled={!isAdmin} value={level} onChange={(e) => setLevel(e.target.value as AuthorityLevel)}>
          {AUTHORITY_LEVELS.map((l) => <option key={l} value={l}>{t.authority[l]}</option>)}
        </select>
        {level === 'scoped' ? (
          <input aria-label="Serbest etkinlik tipleri (virgülle)" className="input input--sm mt-xs" placeholder="toplantı, lansman" disabled={!isAdmin} value={scope} onChange={(e) => setScope(e.target.value)} />
        ) : null}
      </td>
      <td>
        <input type="checkbox" aria-label={`${t.admin.canSign}: ${u.fullName}`} disabled={!isAdmin} checked={canSign} onChange={(e) => setCanSign(e.target.checked)} />
      </td>
      <td className="small">
        {stats ? (
          <span>{t.admin.corrected}: {stats.quotesCorrected}/{stats.quotesTotal} · {t.admin.winRate}: {pct(stats.winRate, 0)} · Ø fiyat Δ {pct(stats.avgPriceChangePct / 100)}</span>
        ) : (
          <button type="button" className="link-btn" onClick={() => void api.users.stats(u.id).then(setStats).catch((e) => toast(errorMessage(e), 'danger'))}>{t.common.details}</button>
        )}
      </td>
      <td className="num">
        {isAdmin && dirty ? (
          <Button size="sm" busy={busy} onClick={async () => {
            setBusy(true);
            try {
              const eventTypes = scope.split(',').map((s) => s.trim()).filter(Boolean);
              onSaved(await api.users.patch(u.id, { role, authorityLevel: level, canSign, authorityScope: { ...u.authorityScope, eventTypes } }));
              toast(t.common.saved);
            } catch (e) {
              toast(errorMessage(e), 'danger');
            } finally {
              setBusy(false);
            }
          }}>{t.common.save}</Button>
        ) : null}
      </td>
    </tr>
  );
}
