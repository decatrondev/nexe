import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";

type Step = "login" | "verify" | "totp";

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

  const login = useAuthStore((s) => s.login);
  const verifyEmail = useAuthStore((s) => s.verifyEmail);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      if (msg === "requires_totp") {
        setStep("totp");
        setTotpCode("");
        setError("");
      } else if (msg.includes("email_not_verified") || msg.includes("verify your email") || msg.includes("not verified")) {
        setStep("verify");
        setError("");
        setFeedback("Your email is not verified. Enter the code sent to your email, or resend it.");
      } else if (msg.includes("Network error") || msg.includes("timed out")) {
        setError("Server is updating, please try again in a moment");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await verifyEmail(email, code);
      setFeedback("");
      // Now try to login automatically
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
      // Start 60s cooldown
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

        {step === "totp" ? (
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

            {/* Twitch Login */}
            <a
              href="https://nexeapi.decatron.net/auth/twitch"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#9146FF] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#7c3aed]"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
              </svg>
              Login with Twitch
            </a>
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
        <p className="mt-6 text-center text-sm text-slate-400">
          Don&apos;t have an account?{" "}
          <Link
            to="/register"
            className="font-medium text-nexe-400 transition-colors hover:text-nexe-300"
          >
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
