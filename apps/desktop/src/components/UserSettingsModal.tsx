import { useEffect, useState, type FormEvent } from "react";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";

interface Props { onClose: () => void }
type Tab = "account" | "profile" | "appearance";

const tabs: { id: Tab; label: string }[] = [
  { id: "account", label: "My Account" },
  { id: "profile", label: "Profiles" },
  { id: "appearance", label: "Appearance" },
];

export default function UserSettingsModal({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("account");
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      {/*
        FIXED size — never changes between tabs.
        Large centered modal: ~90% viewport minus some margin.
      */}
      <div
        className="flex overflow-hidden rounded-xl border border-dark-700 bg-dark-900 shadow-2xl"
        style={{ width: "calc(100vw - 120px)", maxWidth: "1100px", height: "calc(100vh - 100px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar — fixed width, fixed height, never changes */}
        <div className="flex w-52 shrink-0 flex-col border-r border-dark-800 bg-dark-950">
          <div className="flex-1 overflow-y-auto px-3 pt-6">
            <p className="mb-2 px-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Settings
            </p>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`mb-0.5 w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                  activeTab === tab.id
                    ? "bg-nexe-600/15 text-white font-medium"
                    : "text-slate-400 hover:bg-dark-800 hover:text-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="border-t border-dark-800 px-3 py-3">
            <button
              onClick={() => { logout(); onClose(); }}
              className="w-full rounded-md px-3 py-1.5 text-left text-sm text-red-400 transition-colors hover:bg-dark-800"
            >
              Log Out
            </button>
          </div>
        </div>

        {/* Content — fills remaining space, scrolls internally */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Header — fixed */}
          <div className="flex shrink-0 items-center justify-between border-b border-dark-800 px-6 py-3">
            <h2 className="text-base font-semibold text-white">
              {tabs.find((t) => t.id === activeTab)?.label}
            </h2>
            <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-dark-800 hover:text-white">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Scrollable content — always same container size */}
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {activeTab === "account" && <AccountTab />}
            {activeTab === "profile" && <ProfileTab />}
            {activeTab === "appearance" && <AppearanceTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════
// My Account
// ═══════════════════════════

function AccountTab() {
  const user = useAuthStore((s) => s.user);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [showPwReset, setShowPwReset] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [unlinkLoading, setUnlinkLoading] = useState(false);

  async function handleResetPw() {
    setPwLoading(true);
    try {
      await api.forgotPassword(user?.email ?? "");
      setFeedback({ type: "success", msg: "Password reset email sent." });
      setShowPwReset(false);
    } catch (err) {
      setFeedback({ type: "error", msg: err instanceof Error ? err.message : "Failed" });
    } finally { setPwLoading(false); }
  }

  return (
    <div className="space-y-5">
      {feedback && (
        <div className={`rounded-lg border px-4 py-2.5 text-sm ${
          feedback.type === "success" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-red-500/20 bg-red-500/10 text-red-400"
        }`}>{feedback.msg}</div>
      )}

      {/* Profile card */}
      <div className="overflow-hidden rounded-lg border border-dark-700 bg-dark-800">
        <div className="h-24 bg-gradient-to-r from-nexe-600 to-nexe-500" />
        <div className="px-5 pb-5">
          <div className="-mt-9 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-nexe-600 text-2xl font-bold text-white" style={{ border: "5px solid var(--color-dark-800)" }}>
            {(user?.displayName || user?.username || "U").charAt(0).toUpperCase()}
          </div>
          <p className="mt-2 text-lg font-semibold text-white">{user?.displayName || user?.username}</p>
          <p className="text-sm text-slate-400">@{user?.username}</p>
        </div>
      </div>

      {/* Info rows */}
      <div className="divide-y divide-dark-700 rounded-lg border border-dark-700 bg-dark-800">
        <InfoRow label="Username" value={user?.username || "—"} />
        <InfoRow label="Email" value={user?.email || "—"} />
      </div>

      {/* Password */}
      <div className="rounded-lg border border-dark-700 bg-dark-800 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase text-slate-500">Password</p>
            <p className="text-sm text-slate-400">••••••••</p>
          </div>
          {!showPwReset ? (
            <button onClick={() => setShowPwReset(true)} className="rounded-md bg-nexe-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-nexe-500">
              Change
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => setShowPwReset(false)} className="text-xs text-slate-400 hover:text-white">Cancel</button>
              <button onClick={handleResetPw} disabled={pwLoading} className="rounded-md bg-nexe-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-nexe-500 disabled:opacity-50">
                {pwLoading ? "Sending..." : "Send Reset Email"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Connections */}
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Connections</p>
        <div className="rounded-lg border border-dark-700 bg-dark-800 px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#9146FF]/15">
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#9146FF]">
                  <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-white">Twitch</p>
                <p className="text-xs text-slate-400">
                  {user?.twitchId
                    ? `Connected as ${user.twitchLogin || user.twitchId}`
                    : "Not connected"}
                </p>
              </div>
            </div>
            {user?.twitchId ? (
              <button
                onClick={async () => {
                  setUnlinkLoading(true);
                  try {
                    await api.unlinkTwitch();
                    // Update local user state
                    useAuthStore.setState((s) => ({
                      user: s.user ? { ...s.user, twitchId: undefined, twitchLogin: undefined } : null,
                    }));
                    setFeedback({ type: "success", msg: "Twitch account disconnected." });
                  } catch (err) {
                    setFeedback({ type: "error", msg: err instanceof Error ? err.message : "Failed to disconnect" });
                  } finally {
                    setUnlinkLoading(false);
                  }
                }}
                disabled={unlinkLoading}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
              >
                {unlinkLoading ? "..." : "Disconnect"}
              </button>
            ) : (
              <a
                href={`https://nexeapi.decatron.net/auth/twitch?action=link&token=${localStorage.getItem("token") || ""}`}
                className="rounded-md bg-[#9146FF] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#7c3aed]"
              >
                Connect
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-3">
      <p className="text-[11px] font-bold uppercase text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-200">{value}</p>
    </div>
  );
}

// ═══════════════════════════
// Profiles
// ═══════════════════════════

function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    api.getProfile(user.id).then((p) => {
      if (cancel) return;
      setDisplayName(p.displayName ?? "");
      setBio(p.bio ?? "");
      setLoaded(true);
    }).catch(() => { if (!cancel) setLoaded(true); });
    return () => { cancel = true; };
  }, [user?.id]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setLoading(true); setFeedback(null);
    try {
      await api.updateProfile({ displayName: displayName.trim() || undefined, bio: bio.trim() || undefined });
      setFeedback({ type: "success", msg: "Profile saved!" });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err) {
      setFeedback({ type: "error", msg: err instanceof Error ? err.message : "Failed" });
    } finally { setLoading(false); }
  }

  const previewName = displayName.trim() || user?.username || "User";

  return (
    <div className="space-y-5">
      {feedback && (
        <div className={`rounded-lg border px-4 py-2.5 text-sm ${
          feedback.type === "success" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-red-500/20 bg-red-500/10 text-red-400"
        }`}>{feedback.msg}</div>
      )}

      <div className="flex gap-8">
        {/* Form */}
        <form onSubmit={handleSave} className="w-[340px] shrink-0 space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase text-slate-400">Display Name</label>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={user?.username ?? ""}
              className="w-full rounded-md border border-dark-700 bg-dark-800 px-3 py-2 text-sm text-slate-200 outline-none focus:border-nexe-500" />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase text-slate-400">About Me</label>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={5} maxLength={190} placeholder="Tell people about yourself..."
              className="w-full resize-none rounded-md border border-dark-700 bg-dark-800 px-3 py-2 text-sm text-slate-200 outline-none focus:border-nexe-500" />
            <p className="mt-1 text-right text-[11px] text-slate-600">{bio.length}/190</p>
          </div>
          <button type="submit" disabled={loading || !loaded}
            className="rounded-md bg-nexe-600 px-4 py-2 text-sm font-medium text-white hover:bg-nexe-500 disabled:opacity-50">
            {loading ? "Saving..." : "Save Changes"}
          </button>
        </form>

        {/* Preview — larger, matches MiniProfilePopover style */}
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-[11px] font-bold uppercase text-slate-500">Preview</p>
          <div className="overflow-hidden rounded-lg border border-dark-700" style={{ backgroundColor: "#111827" }}>
            {/* Banner */}
            <div className="h-24 bg-gradient-to-r from-nexe-600 to-nexe-500" />
            {/* Avatar */}
            <div className="px-5">
              <div className="-mt-10 flex h-[76px] w-[76px] items-center justify-center rounded-full bg-nexe-600 text-2xl font-bold text-white" style={{ border: "6px solid #111827" }}>
                {previewName.charAt(0).toUpperCase()}
              </div>
            </div>
            {/* Info */}
            <div className="px-5 pb-5 pt-2">
              <p className="text-lg font-bold text-white">{previewName}</p>
              <p className="text-sm text-slate-400">@{user?.username}</p>

              {bio.trim() && (
                <>
                  <div className="my-3 h-px bg-dark-700" />
                  <p className="text-[11px] font-bold uppercase text-slate-500">About Me</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-300 break-words">{bio}</p>
                </>
              )}

              <div className="mt-3 h-px bg-dark-700" />
              <div className="mt-3 flex items-center gap-2">
                <div className="flex h-6 items-center gap-1 rounded-full bg-nexe-600/15 px-2.5 text-[11px] font-semibold text-nexe-400">
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 1l2.39 6.26H19l-5.3 3.98L15.69 18 10 14.27 4.31 18l1.99-6.76L1 7.26h6.61z" />
                  </svg>
                  Level 1
                </div>
                <span className="text-[11px] text-slate-600">Member since May 2026</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════
// Appearance
// ═══════════════════════════

function AppearanceTab() {
  return (
    <div className="py-12 text-center">
      <p className="text-sm text-slate-500">Theme customization coming soon.</p>
    </div>
  );
}
