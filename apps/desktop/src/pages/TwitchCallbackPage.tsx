import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuthStore } from "../stores/auth";

type Step = "loading" | "register" | "error";

export default function TwitchCallbackPage() {
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  // Pre-filled from Twitch for new users
  const params = new URLSearchParams(window.location.search);
  const isNew = params.get("isNew") === "true";
  const twitchId = params.get("twitchId") || "";
  const twitchLogin = params.get("twitchLogin") || "";
  const twitchDisplayName = params.get("twitchDisplayName") || "";
  const twitchEmail = params.get("twitchEmail") || "";
  const twitchAvatar = params.get("twitchAvatar") || "";

  // Registration form state
  const [username, setUsername] = useState(twitchLogin);
  const [email, setEmail] = useState(twitchEmail);
  const [password, setPassword] = useState("");
  const [regLoading, setRegLoading] = useState(false);

  // Handle existing user login or link completion
  useEffect(() => {
    // Handle link completion (user connected Twitch from Settings)
    const linked = params.get("linked");
    if (linked === "true") {
      // Update auth store with fresh user data (includes twitchId now)
      api.getMe().then((user) => {
        localStorage.setItem("user", JSON.stringify(user));
        useAuthStore.setState({ user });
        navigate("/", { replace: true });
      }).catch(() => {
        navigate("/", { replace: true });
      });
      return;
    }

    // Handle error from callback
    const errorMsg = params.get("error");
    if (errorMsg) {
      setError(errorMsg);
      setStep("error");
      return;
    }

    if (isNew) {
      setStep("register");
      return;
    }

    const accessToken = params.get("accessToken");
    const refreshToken = params.get("refreshToken");

    if (!accessToken) {
      setError("No access token received from Twitch login.");
      setStep("error");
      return;
    }

    // Set tokens and fetch user
    api.setToken(accessToken);
    if (refreshToken) api.setRefreshToken(refreshToken);
    localStorage.setItem("token", accessToken);
    if (refreshToken) localStorage.setItem("refreshToken", refreshToken);

    api
      .getMe()
      .then((user) => {
        localStorage.setItem("user", JSON.stringify(user));
        useAuthStore.setState({
          user,
          token: accessToken,
          refreshToken,
          isAuthenticated: true,
          authLoading: false,
        });
        navigate("/", { replace: true });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to fetch user info");
        setStep("error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError("");
    setRegLoading(true);
    try {
      // Register with Twitch data attached
      await api.registerWithTwitch(
        username.trim(),
        email.trim(),
        password,
        twitchId,
        twitchLogin,
        twitchDisplayName,
        twitchEmail,
        twitchAvatar,
      );
      // After registration, the user needs to verify email then log in
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setRegLoading(false);
    }
  }

  // Loading state
  if (step === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-dark-900">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#9146FF] text-xl font-bold text-white">
            <svg viewBox="0 0 24 24" className="h-7 w-7 fill-current">
              <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
            </svg>
          </div>
          <p className="text-sm text-slate-400">Logging in with Twitch...</p>
          <div className="h-1 w-32 overflow-hidden rounded-full bg-dark-800">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-[#9146FF]" />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (step === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-dark-900">
        <div className="w-full max-w-md rounded-2xl bg-dark-850 p-8 shadow-2xl">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-slate-100">Login Failed</h1>
          </div>
          <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
          <button
            onClick={() => navigate("/login", { replace: true })}
            className="w-full rounded-lg bg-nexe-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-nexe-600"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  // New user registration form
  return (
    <div className="flex min-h-screen items-center justify-center bg-dark-900">
      <div className="w-full max-w-md rounded-2xl bg-dark-850 p-8 shadow-2xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-100">
            Welcome to <span className="text-nexe-500">Nexe</span>
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Complete your account to continue with Twitch.
          </p>
        </div>

        {/* Twitch info */}
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-[#9146FF]/20 bg-[#9146FF]/10 px-4 py-3">
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-[#9146FF]">
            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-white">
              {twitchDisplayName || twitchLogin}
            </p>
            <p className="text-xs text-slate-400">Twitch account will be linked</p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full rounded-lg border border-dark-700 bg-dark-900 px-4 py-2.5 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-500 focus:border-nexe-500"
              placeholder="Choose a username"
            />
          </div>

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
              placeholder="Create a password"
            />
          </div>

          <button
            type="submit"
            disabled={regLoading}
            className="w-full rounded-lg bg-nexe-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-nexe-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {regLoading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Already have an account?{" "}
          <a
            href="/login"
            className="font-medium text-nexe-400 transition-colors hover:text-nexe-300"
          >
            Log In
          </a>
        </p>
      </div>
    </div>
  );
}
