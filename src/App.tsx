import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { SyncProvider } from '@/context/SyncContext';
import { AppLayout } from '@/components/Layout';
import { LoadingBlock, ToastProvider } from '@/components/ui';
import { IS_CONFIGURED } from '@/lib/env';
import SetupRequired from '@/pages/SetupRequired';
import Login from '@/pages/Login';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const MyDay = lazy(() => import('@/pages/MyDay'));
const Tasks = lazy(() => import('@/pages/Tasks'));
const Timetable = lazy(() => import('@/pages/Timetable'));
const Analytics = lazy(() => import('@/pages/Analytics'));
const Learning = lazy(() => import('@/pages/Learning'));
const Sections = lazy(() => import('@/pages/Sections'));
const Paths = lazy(() => import('@/pages/Paths'));
const Flashcards = lazy(() => import('@/pages/Flashcards'));
const Challenges = lazy(() => import('@/pages/Challenges'));
const Diary = lazy(() => import('@/pages/Diary'));
const Goals = lazy(() => import('@/pages/Goals'));
const Resources = lazy(() => import('@/pages/Resources'));
const Integrations = lazy(() => import('@/pages/Integrations'));
const Profile = lazy(() => import('@/pages/Profile'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const Admin = lazy(() => import('@/pages/Admin'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, authError } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LoadingBlock label="Opening your workspace…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (profile?.suspended) {
    return (
      <div className="grid min-h-screen place-items-center px-5">
        <div className="card max-w-md p-6 text-center">
          <h1 className="text-lg font-semibold text-ink">Account suspended</h1>
          <p className="mt-2 text-sm text-muted">
            {authError ?? 'This account has been suspended by the administrator.'} Contact the workspace owner if you
            believe this is a mistake.
          </p>
        </div>
      </div>
    );
  }
  return <AppLayout>{children}</AppLayout>;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return <LoadingBlock />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-[60vh] place-items-center">
          <LoadingBlock label="Loading module…" />
        </div>
      }
    >
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<Login />} />
        <Route path="/" element={<Protected><Dashboard /></Protected>} />
        <Route path="/my-day" element={<Protected><MyDay /></Protected>} />
        <Route path="/tasks" element={<Protected><Tasks /></Protected>} />
        <Route path="/timetable" element={<Protected><Timetable /></Protected>} />
        <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
        <Route path="/learning" element={<Protected><Learning /></Protected>} />
        <Route path="/sections" element={<Protected><Sections /></Protected>} />
        <Route path="/paths" element={<Protected><Paths /></Protected>} />
        <Route path="/flashcards" element={<Protected><Flashcards /></Protected>} />
        <Route path="/challenges" element={<Protected><Challenges /></Protected>} />
        <Route path="/diary" element={<Protected><Diary /></Protected>} />
        <Route path="/goals" element={<Protected><Goals /></Protected>} />
        <Route path="/resources" element={<Protected><Resources /></Protected>} />
        <Route path="/integrations" element={<Protected><Integrations /></Protected>} />
        <Route path="/profile" element={<Protected><Profile /></Protected>} />
        <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
        <Route path="/admin" element={<Protected><AdminOnly><Admin /></AdminOnly></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  if (!IS_CONFIGURED) return <SetupRequired />;

  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <SettingsProvider>
            <SyncProvider>
              <ScrollToTop />
              <AppRoutes />
            </SyncProvider>
          </SettingsProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
