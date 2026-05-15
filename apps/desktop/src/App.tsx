import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import TwitchCallbackPage from "./pages/TwitchCallbackPage";
import HomePage from "./pages/HomePage";
import { useAuthStore } from "./stores/auth";
import { runUpdateFlow, type UpdateStatus } from "./lib/updater";
import { ToastContainer } from "@nexe/ui";

const APP_VERSION = "0.0.21";
const API_URL =
  typeof window !== "undefined" &&
  (window.location.protocol === "https:" || "__TAURI__" in window || "__TAURI_INTERNALS__" in window || window.location.hostname === "tauri.localhost")
    ? "https://nexeapi.decatron.net"
    : "http://161.132.53.175:8090";

// Detect which Tauri window we're in
function getWindowLabel(): string {
  try {
    if ("__TAURI_INTERNALS__" in window) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).__TAURI_INTERNALS__?.metadata?.currentWindow?.label || "main";
    }
  } catch { /* not in Tauri */ }
  return "main";
}

// ── Splash Window (small 300x170, no decorations) ──

function SplashWindow() {
  const [statusText, setStatusText] = useState("Starting...");
  const [progress, setProgress] = useState(15);

  const handleUpdateStatus = useCallback((status: UpdateStatus) => {
    switch (status.stage) {
      case "checking":
        setStatusText("Checking for updates...");
        setProgress(30);
        break;
      case "downloading":
        setStatusText(`Downloading update... ${Math.round(status.progress)}%`);
        setProgress(30 + (status.progress / 100) * 50);
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
        setStatusText("Starting...");
        setProgress(90);
        break;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      // Run update check
      const updated = await runUpdateFlow(handleUpdateStatus);

      // If update downloaded, app will relaunch — don't continue
      if (updated || !mounted) return;

      // No update — show main window, close splash
      setProgress(100);
      await new Promise((r) => setTimeout(r, 300));

      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        // Show main window
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const mainWindow = await WebviewWindow.getByLabel("main");
        if (mainWindow) {
          await mainWindow.show();
          await mainWindow.setFocus();
        }
        // Close splash
        await getCurrentWindow().close();
      } catch {
        // Not in Tauri (web fallback) — just continue
      }
    }

    init();
    return () => { mounted = false; };
  }, [handleUpdateStatus]);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-dark-950 select-none" data-tauri-drag-region>
      <div className="relative mb-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-nexe-500 to-nexe-700 text-lg font-bold text-white shadow-modal animate-pulse-subtle">
          N
        </div>
        <div className="absolute -inset-1.5 rounded-2xl bg-nexe-500/10 animate-pulse-subtle" />
      </div>

      <p className="mb-3 text-xs text-slate-400 animate-fade-in">
        {statusText}
      </p>

      <div className="h-[2px] w-36 overflow-hidden rounded-full bg-dark-800">
        <div
          className="h-full rounded-full bg-nexe-500 transition-all duration-300 ease-out"
          style={{ width: `${progress ?? 0}%` }}
        />
      </div>

      <p className="mt-4 text-[10px] text-slate-700">
        Nexe v{APP_VERSION}
      </p>
    </div>
  );
}

// ── Route Guards ──

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

// ── Main App (full window, shown after splash closes) ──

function MainApp() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);
  const authLoading = useAuthStore((s) => s.authLoading);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function init() {
      // Warm up the network
      for (let i = 0; i < 5; i++) {
        try {
          await fetch(API_URL + "/health", { method: "GET", signal: AbortSignal.timeout(3000) });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      loadFromStorage();

      if (mounted) {
        await new Promise((r) => setTimeout(r, 200));
        setReady(true);
      }
    }

    init();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready || authLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-dark-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-dark-600 border-t-nexe-500" />
      </div>
    );
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

// ── Entry Point ──

export default function App() {
  const windowLabel = getWindowLabel();

  // Splash window: small updater window
  if (windowLabel === "splash") {
    return <SplashWindow />;
  }

  // Main window: full app
  return <MainApp />;
}
