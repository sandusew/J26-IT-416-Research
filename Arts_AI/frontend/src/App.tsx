import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { AppShell } from './layouts/AppShell'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import SubjectsPage from './pages/SubjectsPage'
import SubjectDetailPage from './pages/SubjectDetailPage'
import ResourceReaderPage from './pages/ResourceReaderPage'
import QuizPage from './pages/QuizPage'
import TwinPage from './pages/TwinPage'
import ProgressPage from './pages/ProgressPage'
import ChatPage from './pages/ChatPage'
import ConsultationsPage from './pages/ConsultationsPage'
import PeersPage from './pages/PeersPage'
import NotificationsPage from './pages/NotificationsPage'
import CataloguePage from './pages/CataloguePage'
import ModelExplorerPage from './pages/ModelExplorerPage'
import UnauthorizedPage from './pages/UnauthorizedPage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="subjects" element={<SubjectsPage />} />
              <Route path="subjects/:subjectId" element={<SubjectDetailPage />} />
              <Route path="resources/:resourceId" element={<ResourceReaderPage />} />
              <Route path="chat" element={<ChatPage />} />
              <Route path="consultations" element={<ConsultationsPage />} />
              <Route path="notifications" element={<NotificationsPage />} />

              <Route element={<ProtectedRoute roles={['student', 'admin']} />}>
                <Route path="quiz" element={<QuizPage />} />
                <Route path="twin" element={<TwinPage />} />
                <Route path="progress" element={<ProgressPage />} />
                <Route path="peers" element={<PeersPage />} />
              </Route>

              <Route element={<ProtectedRoute roles={['teacher', 'admin']} />}>
                <Route path="catalogue" element={<CataloguePage />} />
                <Route path="models" element={<ModelExplorerPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
