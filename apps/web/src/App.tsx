import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppShell } from './components/AppShell';
import { Button, Loading } from './components/ui';
import { useT } from './i18n';
import { LoginPage } from './pages/Login';
import { DecisionInboxPage } from './pages/DecisionInbox';
import { ProjectsPage } from './pages/Projects';
import { IntakePage } from './pages/Intake';
import { ProjectPage } from './pages/project/ProjectPage';
import { FieldPanelPage } from './pages/FieldPanel';
import { WeeklyReportPage } from './pages/WeeklyReport';
import { AdminLayout } from './pages/admin/AdminLayout';
import { RulesPage } from './pages/admin/RulesPage';
import { UsersPage } from './pages/admin/UsersPage';
import { DelegationsPage } from './pages/admin/DelegationsPage';
import { AutomationPage } from './pages/admin/AutomationPage';
import { ChecklistPage } from './pages/admin/ChecklistPage';
import { SuppliersPage } from './pages/admin/SuppliersPage';
import { CustomersPage } from './pages/admin/CustomersPage';
import { SupplierRfqPage } from './pages/public/SupplierRfqPage';
import { CustomerQuotePage } from './pages/public/CustomerQuotePage';
import { RoomingPage } from './pages/public/RoomingPage';
import { ExtraApprovalPage } from './pages/public/ExtraApprovalPage';
import { SurveyPage } from './pages/public/SurveyPage';
import { EmptyState } from './components/ui';

function RequireAuth() {
  const { status, refresh } = useAuth();
  const t = useT();
  const loc = useLocation();
  if (status === 'loading') {
    return (
      <div className="center-screen">
        <Loading />
        <Button variant="ghost" size="sm" onClick={() => void refresh()}>{t.common.retry}</Button>
      </div>
    );
  }
  if (status === 'anonymous') return <Navigate to="/giris" replace state={{ from: loc.pathname + loc.search }} />;
  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      {/* Public token pages — no login, minimal layout (§10, §7 Adım 4/6/8, §17.7, §17.9) */}
      <Route path="/s/rfq/:token" element={<SupplierRfqPage />} />
      <Route path="/q/:token" element={<CustomerQuotePage />} />
      <Route path="/r/:token" element={<RoomingPage />} />
      <Route path="/e/:token" element={<ExtraApprovalPage />} />
      <Route path="/survey/:token" element={<SurveyPage />} />

      <Route path="/giris" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<DecisionInboxPage />} />
          <Route path="projeler" element={<ProjectsPage />} />
          <Route path="projeler/yeni" element={<IntakePage />} />
          <Route path="projeler/:id/:tab?" element={<ProjectPage />} />
          <Route path="saha" element={<FieldPanelPage />} />
          <Route path="rapor" element={<WeeklyReportPage />} />
          <Route path="yonetim" element={<AdminLayout />}>
            <Route index element={<Navigate to="kurallar" replace />} />
            <Route path="kurallar" element={<RulesPage />} />
            <Route path="kullanicilar" element={<UsersPage />} />
            <Route path="vekalet" element={<DelegationsPage />} />
            <Route path="otomasyon" element={<AutomationPage />} />
            <Route path="kontrol-listesi" element={<ChecklistPage />} />
            <Route path="tedarikciler" element={<SuppliersPage />} />
            <Route path="musteriler" element={<CustomersPage />} />
          </Route>
          <Route path="*" element={<EmptyState icon="info" title="Sayfa bulunamadı" />} />
        </Route>
      </Route>
    </Routes>
  );
}
