import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuthStore } from "../stores/auth";
import { api, type SocialLink } from "../lib/api";
import ImageCropModal from "./ImageCropModal";
import { Tabs, TabList, TabPanel, Select, ColorPicker, type TabItem } from "@nexe/ui";

interface Props { onClose: () => void }

const settingsTabs: TabItem[] = [
  { id: "account", label: "My Account" },
  { id: "profile", label: "Profiles" },
  { id: "security", label: "Security" },
  { id: "appearance", label: "Appearance" },
];

export default function UserSettingsModal({ onClose }: Props) {
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 animate-modal-backdrop" onClick={onClose}>
      <div
        className="flex overflow-hidden rounded-xl border border-dark-700 bg-dark-900 shadow-2xl"
        style={{ width: "calc(100vw - 120px)", maxWidth: "1100px", height: "calc(100vh - 100px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <Tabs defaultTab="account" className="flex w-full">
          {/* Sidebar */}
          <div className="flex w-52 shrink-0 flex-col border-r border-dark-800 bg-dark-950">
            <div className="flex-1 overflow-y-auto px-3 pt-6">
              <TabList tabs={settingsTabs} label="Settings" />
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

          {/* Content */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-end border-b border-dark-800 px-6 py-3">
              <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-dark-800 hover:text-white">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <TabPanel id="account"><AccountTab /></TabPanel>
              <TabPanel id="profile"><ProfileTab /></TabPanel>
              <TabPanel id="security"><SecurityTab /></TabPanel>
              <TabPanel id="appearance"><AppearanceTab /></TabPanel>
            </div>
          </div>
        </Tabs>
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

const SOCIAL_PLATFORMS = ["Twitch", "YouTube", "Twitter", "Instagram", "TikTok", "Website"] as const;
const MAX_SOCIAL_LINKS = 8;

function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [accentColor, setAccentColor] = useState("#6366f1");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);
  const [showAddLink, setShowAddLink] = useState(false);
  const [newPlatform, setNewPlatform] = useState<string>(SOCIAL_PLATFORMS[0]);
  const [newUrl, setNewUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState<"avatar" | "banner" | null>(null);
  const [cropModal, setCropModal] = useState<{ src: string; type: "avatar" | "banner" } | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    api.getProfile(user.id).then((p) => {
      if (cancel) return;
      setDisplayName(p.displayName ?? "");
      setBio(p.bio ?? "");
      setAccentColor(p.accentColor ?? "#6366f1");
      setAvatarUrl(p.avatarUrl ?? null);
      setBannerUrl(p.bannerUrl ?? null);
      setSocialLinks(p.socialLinks ?? []);
      setLoaded(true);
    }).catch(() => { if (!cancel) setLoaded(true); });
    return () => { cancel = true; };
  }, [user?.id]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>, type: "avatar" | "banner") {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCropModal({ src: reader.result as string, type });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function handleCropConfirm(blob: Blob) {
    const type = cropModal?.type;
    if (!type) return;
    setCropModal(null);
    setUploading(type);
    try {
      const file = new File([blob], `${type}.webp`, { type: "image/webp" });
      const { url } = type === "avatar" ? await api.uploadAvatar(file) : await api.uploadBanner(file);
      if (type === "avatar") setAvatarUrl(url);
      else setBannerUrl(url);
      setFeedback({ type: "success", msg: `${type === "avatar" ? "Avatar" : "Banner"} updated!` });
      setTimeout(() => setFeedback(null), 3000);
    } catch {
      setFeedback({ type: "error", msg: `Failed to upload ${type}` });
    } finally {
      setUploading(null);
    }
  }

  async function handleRemoveAvatar() {
    try {
      await api.deleteAvatar();
      setAvatarUrl(null);
      setFeedback({ type: "success", msg: "Avatar removed" });
      setTimeout(() => setFeedback(null), 3000);
    } catch {
      setFeedback({ type: "error", msg: "Failed to remove avatar" });
    }
  }

  async function handleRemoveBanner() {
    try {
      await api.deleteBanner();
      setBannerUrl(null);
      setFeedback({ type: "success", msg: "Banner removed" });
      setTimeout(() => setFeedback(null), 3000);
    } catch {
      setFeedback({ type: "error", msg: "Failed to remove banner" });
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setLoading(true); setFeedback(null);
    try {
      await api.updateProfile({
        displayName: displayName.trim() || undefined,
        bio: bio.trim() || undefined,
        accentColor,
        socialLinks,
      });
      setFeedback({ type: "success", msg: "Profile saved!" });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err) {
      setFeedback({ type: "error", msg: err instanceof Error ? err.message : "Failed" });
    } finally { setLoading(false); }
  }

  function handleAddLink() {
    if (!newUrl.trim() || socialLinks.length >= MAX_SOCIAL_LINKS) return;
    setSocialLinks((prev) => [...prev, { platform: newPlatform.toLowerCase(), url: newUrl.trim() }]);
    setNewUrl("");
    setNewPlatform(SOCIAL_PLATFORMS[0]);
    setShowAddLink(false);
  }

  function handleRemoveLink(index: number) {
    setSocialLinks((prev) => prev.filter((_, i) => i !== index));
  }

  const previewName = displayName.trim() || user?.username || "User";

  return (
    <div className="space-y-5">
      {feedback && (
        <div className={`rounded-lg border px-4 py-2.5 text-sm ${
          feedback.type === "success" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-red-500/20 bg-red-500/10 text-red-400"
        }`}>{feedback.msg}</div>
      )}

      {/* Avatar & Banner uploads */}
      <div className="flex gap-6">
        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase text-slate-400">Avatar</label>
          <div className="group relative h-20 w-20">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="h-20 w-20 rounded-full object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-nexe-600 text-2xl font-bold text-white">
                {(displayName || user?.username || "U").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-full bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
              <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={uploading === "avatar"}
                className="rounded-full bg-nexe-600 p-1.5 text-white hover:bg-nexe-500">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              {avatarUrl && (
                <button type="button" onClick={handleRemoveAvatar}
                  className="rounded-full bg-red-600 p-1.5 text-white hover:bg-red-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
            {uploading === "avatar" && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-nexe-500 border-t-transparent" />
              </div>
            )}
          </div>
          <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => handleFileSelect(e, "avatar")} />
        </div>

        <div className="flex-1">
          <label className="mb-1.5 block text-[11px] font-bold uppercase text-slate-400">Banner</label>
          <div className="group relative h-20 overflow-hidden rounded-lg">
            {bannerUrl ? (
              <img src={bannerUrl} alt="Banner" className="h-20 w-full object-cover" />
            ) : (
              <div className="h-20 w-full bg-gradient-to-r from-nexe-600 to-nexe-500" />
            )}
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
              <button type="button" onClick={() => bannerInputRef.current?.click()} disabled={uploading === "banner"}
                className="rounded-md bg-nexe-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-nexe-500">
                {uploading === "banner" ? "Uploading..." : "Change Banner"}
              </button>
              {bannerUrl && (
                <button type="button" onClick={handleRemoveBanner}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500">
                  Remove
                </button>
              )}
            </div>
          </div>
          <input ref={bannerInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => handleFileSelect(e, "banner")} />
          <p className="mt-1 text-[10px] text-slate-600">Recommended: 600×240. Max 8MB.</p>
        </div>
      </div>

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

          {/* Accent Color */}
          <ColorPicker value={accentColor} onChange={setAccentColor} label="Profile Color" />

          {/* Social Links */}
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase text-slate-400">
              Social Links ({socialLinks.length}/{MAX_SOCIAL_LINKS})
            </label>

            {socialLinks.length > 0 && (
              <div className="mb-2 space-y-1.5">
                {socialLinks.map((link, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-md border border-dark-700 bg-dark-800 px-3 py-1.5">
                    <span className="text-xs font-medium capitalize text-slate-400 w-16 shrink-0">{link.platform}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{link.url}</span>
                    {link.verified && (
                      <svg className="h-3 w-3 shrink-0 text-nexe-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveLink(i)}
                      className="shrink-0 text-slate-500 hover:text-red-400 transition-colors"
                      title="Remove link"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showAddLink ? (
              <div className="space-y-2 rounded-md border border-dark-700 bg-dark-800 p-3">
                <Select
                  value={newPlatform}
                  onChange={setNewPlatform}
                  options={SOCIAL_PLATFORMS.map((p) => ({ value: p, label: p }))}
                />
                <input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-md border border-dark-700 bg-dark-900 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-nexe-500"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddLink(); } }}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAddLink}
                    disabled={!newUrl.trim()}
                    className="rounded-md bg-nexe-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-nexe-500 disabled:opacity-50"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAddLink(false); setNewUrl(""); }}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : socialLinks.length < MAX_SOCIAL_LINKS ? (
              <button
                type="button"
                onClick={() => setShowAddLink(true)}
                className="flex items-center gap-1.5 rounded-md border border-dashed border-dark-600 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-nexe-500 hover:text-nexe-400"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6z" />
                </svg>
                Add Link
              </button>
            ) : null}
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
            {bannerUrl ? (
              <img src={bannerUrl} alt="Banner" className="h-24 w-full object-cover" />
            ) : (
              <div className="h-24 bg-gradient-to-r from-nexe-600 to-nexe-500" />
            )}
            {/* Avatar */}
            <div className="px-5">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="-mt-10 h-[76px] w-[76px] rounded-full object-cover" style={{ border: "6px solid #111827" }} />
              ) : (
                <div className="-mt-10 flex h-[76px] w-[76px] items-center justify-center rounded-full bg-nexe-600 text-2xl font-bold text-white" style={{ border: "6px solid #111827" }}>
                  {previewName.charAt(0).toUpperCase()}
                </div>
              )}
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

              {socialLinks.length > 0 && (
                <>
                  <div className="my-3 h-px bg-dark-700" />
                  <p className="text-[11px] font-bold uppercase text-slate-500">Connections</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {socialLinks.map((link, i) => (
                      <span key={i} className="rounded-md bg-slate-800 px-2.5 py-1 text-[11px] capitalize text-slate-300">
                        {link.platform}
                      </span>
                    ))}
                  </div>
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

      {/* Crop modal */}
      {cropModal && (
        <ImageCropModal
          imageSrc={cropModal.src}
          type={cropModal.type}
          onConfirm={handleCropConfirm}
          onClose={() => setCropModal(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════
// Security (2FA)
// ═══════════════════════════

function SecurityTab() {
  const user = useAuthStore((s) => s.user);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [step, setStep] = useState<"idle" | "setup" | "verify" | "codes" | "disable">("idle");
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    api.getMe().then((me) => {
      if (me) setTotpEnabled(!!me.totpEnabled);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [user?.id]);

  async function handleEnable() {
    setLoading(true); setError("");
    try {
      const data = await api.enable2FA();
      setSecret(data.secret);
      setUri(data.uri);
      setStep("setup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable 2FA");
    } finally { setLoading(false); }
  }

  async function handleVerify() {
    if (code.length !== 6) return;
    setLoading(true); setError("");
    try {
      const data = await api.verify2FA(code);
      setRecoveryCodes(data.recoveryCodes);
      setTotpEnabled(true);
      setStep("codes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally { setLoading(false); setCode(""); }
  }

  async function handleDisable() {
    if (code.length !== 6) return;
    setLoading(true); setError("");
    try {
      await api.disable2FA(code);
      setTotpEnabled(false);
      setStep("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally { setLoading(false); setCode(""); }
  }

  if (!loaded) {
    return <div className="flex justify-center py-8"><div className="h-5 w-5 animate-spin rounded-full border-2 border-nexe-500 border-t-transparent" /></div>;
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-slate-100">Two-Factor Authentication</h3>
        <p className="mt-1 text-sm text-slate-400">
          Add an extra layer of security to your account using an authenticator app like Google Authenticator or Authy.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{error}</div>
      )}

      {/* Idle state — show enable/disable button */}
      {step === "idle" && (
        <div className="rounded-lg border border-dark-700 bg-dark-800 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-full ${totpEnabled ? "bg-green-600/20 text-green-400" : "bg-dark-700 text-slate-500"}`}>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">{totpEnabled ? "2FA is enabled" : "2FA is not enabled"}</p>
                <p className="text-xs text-slate-500">{totpEnabled ? "Your account is protected with an authenticator app" : "Protect your account with an authenticator app"}</p>
              </div>
            </div>
            {totpEnabled ? (
              <button onClick={() => { setStep("disable"); setCode(""); setError(""); }}
                className="rounded-lg bg-red-600/20 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-600/30">
                Disable
              </button>
            ) : (
              <button onClick={handleEnable} disabled={loading}
                className="rounded-lg bg-nexe-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-nexe-500 disabled:opacity-50">
                {loading ? "Loading..." : "Enable 2FA"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Setup — show QR code + secret */}
      {step === "setup" && (
        <div className="space-y-4 rounded-lg border border-dark-700 bg-dark-800 p-5">
          <p className="text-sm font-medium text-slate-200">Step 1: Scan the QR code</p>
          <p className="text-xs text-slate-400">Open your authenticator app and scan this QR code, or enter the secret manually.</p>

          <div className="flex justify-center rounded-lg bg-white p-4">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(uri)}`}
              alt="QR Code"
              className="h-48 w-48"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase text-slate-400">Manual Entry Key</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-dark-900 px-3 py-2 text-sm font-mono text-nexe-300 select-text">{secret}</code>
              <button onClick={() => navigator.clipboard?.writeText(secret)}
                className="rounded-md bg-dark-700 px-3 py-2 text-xs text-slate-300 hover:bg-dark-600">Copy</button>
            </div>
          </div>

          <div className="h-px bg-dark-700" />
          <p className="text-sm font-medium text-slate-200">Step 2: Enter the 6-digit code</p>
          <input
            type="text"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="w-full rounded-lg border border-dark-700 bg-dark-900 px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] text-slate-200 outline-none focus:border-nexe-500"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleVerify(); }}
          />
          <div className="flex gap-3">
            <button onClick={() => { setStep("idle"); setCode(""); setError(""); }}
              className="flex-1 rounded-lg bg-dark-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-dark-600">Cancel</button>
            <button onClick={handleVerify} disabled={loading || code.length !== 6}
              className="flex-1 rounded-lg bg-nexe-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-nexe-500 disabled:opacity-50">
              {loading ? "Verifying..." : "Verify & Enable"}
            </button>
          </div>
        </div>
      )}

      {/* Recovery codes */}
      {step === "codes" && (
        <div className="space-y-4 rounded-lg border border-green-500/20 bg-green-500/5 p-5">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-semibold text-green-400">2FA Enabled Successfully!</p>
          </div>
          <p className="text-xs text-slate-400">Save these recovery codes in a safe place. You can use them to login if you lose your authenticator device. Each code can only be used once.</p>
          <div className="grid grid-cols-2 gap-2">
            {recoveryCodes.map((c) => (
              <code key={c} className="rounded-md bg-dark-900 px-3 py-1.5 text-center text-sm font-mono text-slate-200 select-text">{c}</code>
            ))}
          </div>
          <button onClick={() => { navigator.clipboard?.writeText(recoveryCodes.join("\n")); }}
            className="w-full rounded-lg bg-dark-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-dark-600">
            Copy All Codes
          </button>
          <button onClick={() => { setStep("idle"); setRecoveryCodes([]); }}
            className="w-full rounded-lg bg-nexe-600 px-4 py-2 text-sm font-medium text-white hover:bg-nexe-500">
            Done
          </button>
        </div>
      )}

      {/* Disable confirmation */}
      {step === "disable" && (
        <div className="space-y-4 rounded-lg border border-red-500/20 bg-red-500/5 p-5">
          <p className="text-sm font-medium text-red-400">Disable Two-Factor Authentication</p>
          <p className="text-xs text-slate-400">Enter your current authenticator code to disable 2FA.</p>
          <input
            type="text"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="w-full rounded-lg border border-dark-700 bg-dark-900 px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] text-slate-200 outline-none focus:border-red-500"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleDisable(); }}
          />
          <div className="flex gap-3">
            <button onClick={() => { setStep("idle"); setCode(""); setError(""); }}
              className="flex-1 rounded-lg bg-dark-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-dark-600">Cancel</button>
            <button onClick={handleDisable} disabled={loading || code.length !== 6}
              className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {loading ? "Disabling..." : "Disable 2FA"}
            </button>
          </div>
        </div>
      )}
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
