import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import type { Role } from '@mice/shared';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n';
import { Icon, type IconName } from './Icon';
import { BottomSheet } from './BottomSheet';
import { Button, Callout } from './ui';
import { registerBiometric, webauthnSupported } from '../lib/webauthn';
import { useToast } from './Toast';
import { errorMessage } from '../api/client';
import { useOfflineQueue } from '../lib/OfflineQueueProvider';
import { PushToggle } from './PushToggle';

interface NavItem { to: string; label: string; icon: IconName; roles?: Role[]; end?: boolean }

export function AppShell() {
  const t = useT();
  const { user, me, logout, isDelegate } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const loc = useLocation();
  const toast = useToast();
  const q = useOfflineQueue();
  const [regBusy, setRegBusy] = useState(false);
  const [regPassword, setRegPassword] = useState('');

  const nav: NavItem[] = [
    { to: '/', label: t.nav.inbox, icon: 'inbox', end: true },
    { to: '/projeler', label: t.nav.projects, icon: 'folder', roles: ['admin', 'clerk_sales', 'clerk_ops', 'finance', 'signatory'] },
    { to: '/saha', label: t.nav.field, icon: 'field' },
    { to: '/finans', label: t.nav.finance, icon: 'doc', roles: ['admin', 'finance'] },
    { to: '/rapor', label: t.nav.report, icon: 'chart', roles: ['admin'] }, // GET /api/reports/weekly is admin-only
    { to: '/yonetim', label: t.nav.admin, icon: 'settings', roles: ['admin'] },
  ];
  const visible = nav.filter((n) => !n.roles || (user && n.roles.includes(user.role)));
  const canCreate = !!user && ['admin', 'clerk_sales', 'clerk_ops'].includes(user.role);
  // mobile tab bar (§15 mobile-first): at most 4 tabs + profile; "Yeni talep" for sales / ops / admin; the rest in the profile sheet
  const TAB_ORDER = ['/', '/projeler', '/saha', '/finans'];
  const primary: NavItem[] = visible.filter((n) => TAB_ORDER.includes(n.to));
  if (canCreate) primary.splice(Math.min(2, primary.length), 0, { to: '/projeler/yeni', label: t.nav.newRequest, icon: 'plus', end: true });
  const tabs = primary.slice(0, 4);
  const overflow = visible.filter((n) => !tabs.some((x) => x.to === n.to));
  const wide = /^\/projeler\/[^/]+/.test(loc.pathname) && loc.pathname !== '/projeler/yeni';

  return (
    <div className={`shell ${wide ? 'shell--wide' : ''}`}>
      <a href="#main" className="skip-link">İçeriğe geç</a>
      <aside className="sidebar" aria-label="Ana menü">
        <div className="sidebar__brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          <div>
            <div className="sidebar__name">{t.app.short}</div>
            <div className="sidebar__tenant">{me?.tenant.name || t.app.agency}</div>
          </div>
        </div>
        {canCreate ? (
          <NavLink to="/projeler/yeni" className="btn btn--primary sidebar__cta">
            <Icon name="plus" size={18} />
            <span>{t.nav.newRequest}</span>
          </NavLink>
        ) : null}
        <nav className="sidebar__nav">
          {visible.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `sidebar__link ${isActive ? 'is-active' : ''}`}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__foot">
          {!q.online || q.pending.length ? (
            <div className="sidebar__offline">
              <Icon name={q.online ? 'cloud' : 'cloudOff'} size={16} />
              {q.online ? t.field.offlineQueue(q.pending.length) : t.field.offline}
            </div>
          ) : null}
          <button type="button" className="sidebar__user" onClick={() => setProfileOpen(true)}>
            <span className="avatar" aria-hidden>{initials(user?.fullName)}</span>
            <span className="sidebar__user-text">
              <span className="sidebar__user-name">{user?.fullName}</span>
              <span className="sidebar__user-role">{user ? t.role[user.role] : ''}{isDelegate ? ' · Vekil' : ''}</span>
            </span>
          </button>
        </div>
      </aside>

      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Ana menü">
        {tabs.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end || n.to === '/projeler'} className={({ isActive }) => `tabbar__link ${n.to === '/projeler/yeni' ? 'tabbar__link--new' : ''} ${isActive ? 'is-active' : ''}`}>
            {n.to === '/projeler/yeni' ? <span className="tabbar__plus" aria-hidden><Icon name="plus" size={20} /></span> : <Icon name={n.icon} size={22} />}
            <span>{n.label}</span>
          </NavLink>
        ))}
        <button type="button" className="tabbar__link" onClick={() => setProfileOpen(true)} aria-label={t.nav.settings}>
          <span className="avatar avatar--sm" aria-hidden>{initials(user?.fullName)}</span>
          <span>{t.nav.settings}</span>
        </button>
      </nav>

      <BottomSheet open={profileOpen} onClose={() => setProfileOpen(false)} title={user?.fullName ?? ''}>
        <p className="muted">{user?.email} · {user ? t.role[user.role] : ''}</p>
        {isDelegate ? <Callout tone="purple" icon="shield">{t.inbox.delegationMarker}</Callout> : null}
        {overflow.length ? (
          <nav className="sheet-nav" aria-label={t.nav.more}>
            {overflow.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setProfileOpen(false)} className={({ isActive }) => `sheet-nav__link ${isActive ? 'is-active' : ''}`}>
                <Icon name={n.icon} size={20} />
                <span>{n.label}</span>
                <Icon name="chevronRight" size={16} />
              </NavLink>
            ))}
          </nav>
        ) : null}
        <div className="stack">
          <PushToggle />
          {webauthnSupported() ? (
            <input
              type="password"
              className="input"
              autoComplete="current-password"
              placeholder={t.inbox.registerFaceIdPassword}
              aria-label={t.inbox.registerFaceIdPassword}
              value={regPassword}
              onChange={(e) => setRegPassword(e.target.value)}
            />
          ) : null}
          {webauthnSupported() ? (
            <Button
              variant="secondary"
              icon="faceid"
              busy={regBusy}
              disabled={!regPassword}
              onClick={async () => {
                setRegBusy(true);
                try {
                  if (await registerBiometric(regPassword)) toast(t.inbox.faceIdRegistered);
                  setRegPassword('');
                } catch (e) {
                  toast(errorMessage(e), 'danger');
                } finally {
                  setRegBusy(false);
                }
              }}
            >
              {t.inbox.registerFaceId}
            </Button>
          ) : null}
          <Button variant="danger" icon="logout" onClick={logout}>
            {t.common.logout}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}

function initials(name?: string | null) {
  if (!name) return '·';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toLocaleUpperCase('tr-TR')).join('');
}

export function PageHeader({ title, subtitle, actions, large = true }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; large?: boolean }) {
  return (
    <header className={`page-head ${large ? 'page-head--large' : ''}`}>
      <div>
        <h1 className="page-head__title">{title}</h1>
        {subtitle ? <p className="page-head__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </header>
  );
}
