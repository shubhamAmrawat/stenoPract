import { Link, Route, Routes } from 'react-router'
import { AccessPage } from './admin/AccessPage'
import { AdminLayout } from './admin/AdminLayout'
import { ConfigPage } from './admin/ConfigPage'
import { ContentPage } from './admin/ContentPage'
import { DictationEditorPage } from './admin/DictationEditorPage'
import { ReportsPage } from './admin/ReportsPage'
import { ResourcesAdminPage } from './admin/ResourcesAdminPage'
import { RequireAdmin, RequireAuth, StudentArea } from './auth/guards'
import { AppShell } from './components/AppShell'
import { AnalysisPage } from './pages/AnalysisPage'
import { DashboardPage } from './pages/DashboardPage'
import { DictationPage } from './pages/DictationPage'
import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { ResourcesPage } from './pages/ResourcesPage'
import { SetPage } from './pages/SetPage'
import { SettingsPage } from './pages/SettingsPage'
import { WritePage } from './pages/WritePage'

function NotFound() {
  return (
    <div className="center">
      <h1>Page not found</h1>
      <Link className="btn btn-primary" to="/">Back to home</Link>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        {/* Admin console: its own shell and colours, not the student AppShell. */}
        <Route path="/admin" element={<RequireAdmin />}>
          <Route element={<AdminLayout />}>
            <Route index element={<ContentPage />} />
            <Route path="d/:id" element={<DictationEditorPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="resources" element={<ResourcesAdminPage />} />
            <Route path="access" element={<AccessPage />} />
            <Route path="config" element={<ConfigPage />} />
          </Route>
        </Route>
        {/* Student side. Admins only get here through "Student view". */}
        <Route element={<StudentArea />}>
          {/* Full-screen writing page: no top bar, nothing to distract from typing. */}
          <Route path="/attempts/:id/write" element={<WritePage />} />
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="/practice/:slug" element={<SetPage />} />
            <Route path="/resources/:group" element={<ResourcesPage />} />
            <Route path="/d/:id" element={<DictationPage />} />
            <Route path="/attempts/:id" element={<AnalysisPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
