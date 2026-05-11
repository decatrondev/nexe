import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";

type Step = "login" | "verify";

export default function LoginPage() {
  const [step, setStep] = useState<Step>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
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
      if (msg.includes("email_not_verified") || msg.includes("verify your email") || msg.includes("not verified")) {
        setStep("verify");
        setError("");
        setFeedback("Your email is not verified. Enter the code sent to your email, or resend it.");
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

        {step === "login" ? (
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
