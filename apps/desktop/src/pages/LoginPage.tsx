import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";

const API_URL =
  typeof window !== "undefined" &&
  (window.location.protocol === "https:" || "__TAURI__" in window || "__TAURI_INTERNALS__" in window || window.location.hostname === "tauri.localhost")
    ? "https://nexeapi.decatron.net"
    : "http://161.132.53.175:8090";

type Step = "login" | "verify" | "totp" | "twitch-auth";

async function openInBrowser(url: string) {
  try {
    if ("__TAURI__" in window || "__TAURI_INTERNALS__" in window) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    }
  } catch {
    // Fallback to window.open
  }
  window.open(url, "_blank");
}

export default function LoginPage() {
  const [step, setStep] = useState<Step>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  // Device code state
  const [deviceSession, setDeviceSession] = useState<{ sessionId: string; code: string; verifyUrl: string } | null>(null);
  const [showDeviceCode, setShowDeviceCode] = useState(false);
  const [deviceCountdown, setDeviceCountdown] = useState(300);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const login = useAuthStore((s) => s.login);
  const verifyEmail = useAuthStore((s) => s.verifyEmail);
  const navigate = useNavigate();

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const handleDeviceAuthorized = useCallback(async (data: {
    isNew?: boolean;
    accessToken?: string;
    refreshToken?: string;
    twitchId?: string;
    twitchLogin?: string;
    twitchDisplayName?: string;
    twitchEmail?: string;
    twitchAvatar?: string;
  }) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    if (data.isNew) {
      // New user — navigate to Twitch callback page with registration data
      const params = new URLSearchParams({
        isNew: "true",
        twitchId: data.twitchId || "",
        twitchLogin: data.twitchLogin || "",
        twitchDisplayName: data.twitchDisplayName || "",
        twitchEmail: data.twitchEmail || "",
        twitchAvatar: data.twitchAvatar || "",
      });
      navigate(`/auth/twitch/callback?${params.toString()}`, { replace: true });
      return;
    }

    // Existing user — auto-login
    if (data.accessToken) {
      api.setToken(data.accessToken);
      if (data.refreshToken) api.setRefreshToken(data.refreshToken);
      localStorage.setItem("token", data.accessToken);
      if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);

      try {
        const user = await api.getMe();
        localStorage.setItem("user", JSON.stringify(user));
        useAuthStore.setState({
          user,
          token: data.accessToken,
          refreshToken: data.refreshToken,
          isAuthenticated: true,
          authLoading: false,
        });
        navigate("/", { replace: true });
      } catch {
        setError("Failed to fetch user info. Please try again.");
        setStep("login");
      }
    }
  }, [navigate]);

  const startPolling = useCallback((sessionId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      try {
        const res = await api.checkDeviceCodeStatus(sessionId);
        if (res.status === "authorized") {
          handleDeviceAuthorized(res);
        } else if (res.status === "expired" || res.status === "error") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          if (countdownRef.current) clearInterval(countdownRef.current);
          setError(res.status === "error" ? (res.error || "Authorization failed") : "Code expired. Please try again.");
          setStep("login");
          setDeviceSession(null);
          setShowDeviceCode(false);
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);
  }, [handleDeviceAuthorized]);

  const startCountdown = useCallback(() => {
    setDeviceCountdown(300);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setDeviceCountdown((c) => {
        if (c <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          if (pollingRef.current) clearInterval(pollingRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }, []);

  async function handleTwitchLogin() {
    setError("");
    setLoading(true);
    try {
      const res = await api.generateDeviceCode();
      setDeviceSession(res);
      setStep("twitch-auth");
      setShowDeviceCode(false);
      startPolling(res.sessionId);
      startCountdown();

      // Open browser with the device session for automatic auth
      await openInBrowser(`${API_URL}/auth/twitch?device_session=${res.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Twitch login");
    } finally {
      setLoading(false);
    }
  }

  async function handleShowDeviceCode() {
    setError("");
    if (!deviceSession) {
      setLoading(true);
      try {
        const res = await api.generateDeviceCode();
        setDeviceSession(res);
        setStep("twitch-auth");
        setShowDeviceCode(true);
        startPolling(res.sessionId);
        startCountdown();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate code");
      } finally {
        setLoading(false);
      }
    } else {
      setShowDeviceCode(true);
    }
  }

  function handleCancelTwitch() {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setStep("login");
    setDeviceSession(null);
    setShowDeviceCode(false);
    setError("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await login(email, password);
        navigate("/");
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Login failed";
        if (msg.includes("Network error") || msg.includes("timed out")) {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          setError("Unable to connect to server. Please try again.");
        } else if (msg === "requires_totp") {
          setStep("totp");
          setTotpCode("");
          setError("");
        } else if (msg.includes("email_not_verified") || msg.includes("verify your email") || msg.includes("not verified")) {
          setStep("verify");
          setError("");
          setFeedback("Your email is not verified. Enter the code sent to your email, or resend it.");
        } else {
          setError(msg);
        }
        break;
      }
    }
    setLoading(false);
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await verifyEmail(email, code);
      setFeedback("");
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setError("");
    setFeedback("");
    setLoading(true);
    try {
      await api.resendVerification(email);
      setFeedback("Verification code resent to " + email);
      setResendCooldown(60);
      const interval = setInterval(() => {
        setResendCooldown((c) => {
          if (c <= 1) { clearInterval(interval); return 0; }
          return c - 1;
        });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend code");
    } finally {
      setLoading(false);
    }
  }

  async function handleTOTPSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = useRecovery
        ? await api.recover2FA(email, password, totpCode)
        : await api.login2FA(email, password, totpCode);
      api.setToken(res.accessToken);
      api.setRefreshToken(res.refreshToken);
      localStorage.setItem("token", res.accessToken);
      localStorage.setItem("refreshToken", res.refreshToken);
      localStorage.setItem("user", JSON.stringify(res.user));
      useAuthStore.setState({
        user: res.user,
        token: res.accessToken,
        refreshToken: res.refreshToken,
        isAuthenticated: true,
      });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  }

  const formatCountdown = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-dark-900">
      <div className="w-full max-w-md rounded-2xl bg-dark-850 p-8 shadow-2xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-slate-100">
            <span className="text-nexe-500">Nexe</span>
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            {step === "login"
              ? "Welcome back! Log in to continue."
              : step === "totp"
              ? "Enter the code from your authenticator app."
              : step === "twitch-auth"
              ? "Logging in with Twitch"
              : "Verify your email to continue."}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
            {error}
          </div>
        )}
        {feedback && (
          <div className="mb-4 rounded-lg bg-nexe-500/10 px-4 py-3 text-sm text-nexe-400 border border-nexe-500/20">
            {feedback}
          </div>
        )}

        {step === "twitch-auth" && deviceSession ? (
          <div className="space-y-5">
            {/* Browser opened message */}
            {!showDeviceCode && (
              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#9146FF] text-white">
                    <svg viewBox="0 0 24 24" className="h-7 w-7 fill-current">
                      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
                    </svg>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-slate-300">A browser window should have opened.</p>
                  <p className="text-xs text-slate-500 mt-1">Complete the Twitch login there to continue.</p>
                </div>

                {/* Waiting indicator */}
                <div className="flex items-center justify-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-nexe-500 animate-pulse" />
                  <span className="text-xs text-slate-400">Waiting for authorization... {formatCountdown(deviceCountdown)}</span>
                </div>
              </div>
            )}

            {/* Divider to code option */}
            {!showDeviceCode && (
              <>
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-dark-700" />
                  <span className="text-xs text-slate-500">OR USE A CODE</span>
                  <div className="h-px flex-1 bg-dark-700" />
                </div>
                <button
                  type="button"
                  onClick={() => setShowDeviceCode(true)}
                  className="w-full text-center text-sm text-nexe-400 hover:text-nexe-300 transition-colors"
                >
                  Show device code
                </button>
              </>
            )}

            {/* Device code + QR display */}
            {showDeviceCode && (
              <div className="space-y-5">
                <p className="text-center text-xs text-slate-400">
                  Open the link below on any device and enter this code:
                </p>

                {/* Code display */}
                <div
                  className="cursor-pointer select-all rounded-xl border border-dark-600 bg-dark-900 px-6 py-4 text-center"
                  onClick={() => navigator.clipboard.writeText(deviceSession.code)}
                  title="Click to copy"
                >
                  <p className="font-mono text-3xl font-bold tracking-[0.3em] text-white">
                    {deviceSession.code}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Click to copy</p>
                </div>

                {/* QR Code */}
                <div className="flex justify-center">
                  <div className="rounded-xl bg-white p-3">
                    <QRCodeSVG
                      value={`${deviceSession.verifyUrl}?code=${deviceSession.code}`}
                      size={160}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#0f1117"
                    />
                  </div>
                </div>

                {/* URL */}
                <div className="text-center">
                  <p className="text-xs text-slate-500 mb-1">Or visit:</p>
                  <button
                    type="button"
                    onClick={() => openInBrowser(`${deviceSession.verifyUrl}?code=${deviceSession.code}`)}
                    className="text-sm font-medium text-nexe-400 hover:text-nexe-300 hover:underline"
                  >
                    {deviceSession.verifyUrl}
                  </button>
                </div>

                {/* Waiting indicator */}
                <div className="flex items-center justify-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-nexe-500 animate-pulse" />
                  <span className="text-xs text-slate-400">Waiting for authorization... {formatCountdown(deviceCountdown)}</span>
                </div>
              </div>
            )}

            {/* Cancel button */}
            <button
              type="button"
              onClick={handleCancelTwitch}
              className="w-full text-center text-sm text-slate-500 transition-colors hover:text-slate-300"
            >
              Cancel
            </button>
          </div>
        ) : step === "totp" ? (
          <form onSubmit={handleTOTPSubmit} className="space-y-4">
            <div className="flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-nexe-600/20 text-nexe-400">
                <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
                {useRecovery ? "Recovery Code" : "Authentication Code"}
              </label>
              <input
                type="text"
                maxLength={useRecovery ? 20 : 6}
                value={totpCode}
                onChange={(e) => setTotpCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ""))}
                placeholder={useRecovery ? "Enter recovery code" : "000000"}
                className={`w-full rounded-lg border border-dark-700 bg-dark-900 px-4 py-3 text-slate-200 outline-none transition-colors placeholder:text-slate-500 focus:border-nexe-500 ${useRecovery ? "text-sm" : "text-center text-2xl font-mono tracking-[0.5em]"}`}
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={loading || (useRecovery ? !totpCode.trim() : totpCode.length !== 6)}
              className="w-full rounded-lg bg-nexe-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-nexe-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Verifying..." : "Verify"}
            </button>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => { setUseRecovery(!useRecovery); setTotpCode(""); setError(""); }}
                className="text-xs text-nexe-400 hover:text-nexe-300"
              >
                {useRecovery ? "Use authenticator app" : "Use a recovery code"}
              </button>
              <button
                type="button"
                onClick={() => { setStep("login"); setTotpCode(""); setError(""); }}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Back to login
              </button>
            </div>
          </form>
        ) : step === "login" ? (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-dark-700 bg-dark-900 px-4 py-2.5 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-500 focus:border-nexe-500"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-lg border border-dark-700 bg-dark-900 px-4 py-2.5 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-500 focus:border-nexe-500"
                  placeholder="Your password"
                />
              </div>

              <div className="flex justify-end">
                <Link to="/forgot-password" className="text-xs text-nexe-400 hover:text-nexe-300">
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-nexe-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-nexe-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Logging in..." : "Log In"}
              </button>
            </form>

            {/* Divider */}
            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-dark-700" />
              <span className="text-xs text-slate-500">OR</span>
              <div className="h-px flex-1 bg-dark-700" />
            </div>

            {/* Twitch Login — opens browser */}
            <button
              type="button"
              onClick={handleTwitchLogin}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#9146FF] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#7c3aed] disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
              </svg>
              Login with Twitch
            </button>

            {/* Use code instead */}
            <button
              type="button"
              onClick={handleShowDeviceCode}
              disabled={loading}
              className="mt-2 w-full text-center text-xs text-slate-500 transition-colors hover:text-slate-300 disabled:opacity-50"
            >
              Use a code instead
            </button>
          </>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
                Verification Code
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                maxLength={6}
                className="w-full rounded-lg border border-dark-700 bg-dark-900 px-4 py-2.5 text-center text-lg tracking-[0.5em] text-slate-200 outline-none transition-colors placeholder:text-slate-500 placeholder:tracking-normal focus:border-nexe-500"
                placeholder="Enter code"
                autoFocus
              />
              <p className="mt-2 text-xs text-slate-500">
                Check your email ({email}) for the code
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !code}
              className="w-full rounded-lg bg-nexe-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-nexe-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Verifying..." : "Verify & Log In"}
            </button>

            <button
              type="button"
              onClick={handleResend}
              disabled={loading || resendCooldown > 0}
              className="w-full text-center text-sm text-nexe-400 transition-colors hover:text-nexe-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend verification code"}
            </button>

            <button
              type="button"
              onClick={() => { setStep("login"); setError(""); setFeedback(""); }}
              className="w-full text-center text-sm text-slate-500 transition-colors hover:text-slate-300"
            >
              Back to login
            </button>
          </form>
        )}

        {/* Register link */}
        {step !== "twitch-auth" && (
          <p className="mt-6 text-center text-sm text-slate-400">
            Don&apos;t have an account?{" "}
            <Link
              to="/register"
              className="font-medium text-nexe-400 transition-colors hover:text-nexe-300"
            >
              Register
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
