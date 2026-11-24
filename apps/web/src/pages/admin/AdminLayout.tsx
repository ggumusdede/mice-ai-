import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n';
import { PageHeader } from '../../components/AppShell';
import { Callout } from '../../components/ui';

export function AdminLayout() {
  const t = useT();
  const { isAdmin } = useAuth();
  const links = [
    ['kurallar', t.admin.rules],
    ['kullanicilar', t.admin.users],
    ['vekalet', t.admin.delegations],
    ['otomasyon', t.admin.automation],
    ['kontrol-listesi', t.admin.checklist],
    ['tedarikciler', t.admin.suppliers],
    ['musteriler', t.admin.customers],
    ['veri-aktarimi', 'Veri aktarımı'],
    ['ekip-performansi', t.teamPerf.nav],
    ['ekip', 'Ekip ve nöbet'],
    ['devir', 'Devir-teslim'],
  ] as const;
  return (
    <div className="page">
      <PageHeader title={t.admin.title} />
      {!isAdmin ? <Callout tone="warning" icon="shield">{t.admin.adminOnly}</Callout> : null}
      <nav className="tabs" aria-label={t.admin.title}>
        {links.map(([to, label]) => (
          <NavLink key={to} to={`/yonetim/${to}`} className={({ isActive }) => `tabs__tab ${isActive ? 'is-active' : ''}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="admin__body">
        <Outlet />
      </div>
    </div>
  );
}
