import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import TwitchCallbackPage from "./pages/TwitchCallbackPage";
import HomePage from "./pages/HomePage";
import { useAuthStore } from "./stores/auth";
import { checkForUpdates } from "./lib/updater";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated) {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite");
    if (invite) {
      localStorage.setItem("pendingInvite", invite);
    }
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function LoadingScreen() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-dark-950">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-nexe-600 text-xl font-bold text-white">
          N
        </div>
        <div className="h-1 w-32 overflow-hidden rounded-full bg-dark-800">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-nexe-500" />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);
  const authLoading = useAuthStore((s) => s.authLoading);

  useEffect(() => {
    loadFromStorage();
    checkForUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show loading while checking auth — prevents login flash on F5
  if (authLoading) {
    return <LoadingScreen />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <AuthRoute>
              <LoginPage />
            </AuthRoute>
          }
        />
        <Route
          path="/register"
          element={
            <AuthRoute>
              <RegisterPage />
            </AuthRoute>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <AuthRoute>
              <ForgotPasswordPage />
            </AuthRoute>
          }
        />
        <Route
          path="/auth/twitch/callback"
          element={<TwitchCallbackPage />}
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <HomePage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
