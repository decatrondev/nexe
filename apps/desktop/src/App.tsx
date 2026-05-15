import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import TwitchCallbackPage from "./pages/TwitchCallbackPage";
import HomePage from "./pages/HomePage";
import { useAuthStore } from "./stores/auth";
import { checkAndInstallUpdate, type UpdateStatus } from "./lib/updater";
import { ToastContainer } from "@nexe/ui";

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

// ── Splash Screen ──

function SplashScreen({ status, progress }: { status: string; progress: number }) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-dark-950 select-none" data-tauri-drag-region>
      {/* Logo with pulse animation */}
      <div className="relative mb-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-nexe-500 to-nexe-700 text-2xl font-bold text-white shadow-modal animate-pulse-subtle">
          N
        </div>
        <div className="absolute -inset-2 rounded-3xl bg-nexe-500/10 animate-pulse-subtle" />
      </div>

      {/* Status text */}
      <p className="mb-4 text-sm text-slate-400 animate-fade-in">
        {status}
      </p>

      {/* Progress bar */}
      <div className="h-[3px] w-48 overflow-hidden rounded-full bg-dark-800">
        <div
          className="h-full rounded-full bg-nexe-500 transition-all duration-300 ease-out"
          style={{ width: `${progress ?? 0}%` }}
        />
      </div>

      {/* Version */}
      <p className="mt-6 text-[11px] text-slate-700">
        Nexe v{APP_VERSION}
      </p>
    </div>
  );
}

const APP_VERSION = "0.0.19";
const API_URL =
  typeof window !== "undefined" &&
  (window.location.protocol === "https:" || "__TAURI__" in window || "__TAURI_INTERNALS__" in window || window.location.hostname === "tauri.localhost")
    ? "https://nexeapi.decatron.net"
    : "http://161.132.53.175:8090";

export default function App() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);
  const authLoading = useAuthStore((s) => s.authLoading);
  const [splashDone, setSplashDone] = useState(false);
  const [statusText, setStatusText] = useState("Starting...");
  const [progress, setProgress] = useState(15);

  const handleUpdateStatus = useCallback((status: UpdateStatus) => {
    switch (status.stage) {
      case "checking":
        setStatusText("Checking for updates...");
        setProgress(30);
        break;
      case "downloading":
        setStatusText(`Downloading update... ${Math.round(status.progress * 100)}%`);
        setProgress(30 + status.progress * 50);
        break;
      case "installing":
        setStatusText("Installing update...");
        setProgress(85);
        break;
      case "restarting":
        setStatusText("Restarting...");
        setProgress(100);
        break;
      case "no-update":
        setStatusText("Connecting...");
        setProgress(90);
        break;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      // Warm up the network — Tauri webview needs a moment on cold start
      setStatusText("Starting...");
      for (let i = 0; i < 5; i++) {
        try {
          await fetch(API_URL + "/health", { method: "GET", signal: AbortSignal.timeout(3000) });
          break; // network ready
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      // Start auth load (reads from localStorage, then calls getMe in background)
      loadFromStorage();

      // Check for updates
      const updated = await checkAndInstallUpdate(handleUpdateStatus);

      // If update installed, app will relaunch — don't continue
      if (updated) return;

      // Small delay to show "Connecting..." before dismissing splash
      if (mounted) {
        setProgress(100);
        await new Promise((r) => setTimeout(r, 400));
        setSplashDone(true);
      }
    }

    init();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show splash while updating or loading
  if (!splashDone || authLoading) {
    return <SplashScreen status={statusText} progress={progress} />;
  }

  return (
    <BrowserRouter>
      <ToastContainer />
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
