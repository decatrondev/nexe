import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuthStore } from "../stores/auth";
import { api, type SocialLink, type TierLimits } from "../lib/api";
import ImageCropModal from "./ImageCropModal";
import { listNativeDevices, needsNativeVoice } from "../lib/nativeRoom";
import { useMicTest } from "../lib/micTest";
import { applyNativeProcessing, setNoiseMode, getNoiseMode, type NoiseMode } from "../lib/voicePrefs";
import { invoke } from "@tauri-apps/api/core";
import { Tabs, TabList, TabPanel, Select, ColorPicker, Toggle, type TabItem } from "@nexe/ui";

interface Props { onClose: () => void }

const settingsTabs: TabItem[] = [
  { id: "account", label: "My Account" },
  { id: "profile", label: "Profiles" },
  { id: "security", label: "Security" },
  { id: "privacy", label: "Privacy" },
  { id: "data", label: "Data & Privacy", color: "text-slate-400 hover:text-slate-200" },
  { id: "notifications", label: "Notifications" },
  { id: "voice", label: "Voice & Video" },
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
              <TabPanel id="privacy"><PrivacyTab /></TabPanel>
              <TabPanel id="data"><DataPrivacyTab onClose={onClose} /></TabPanel>
              <TabPanel id="notifications"><NotificationsTab /></TabPanel>
              <TabPanel id="voice"><VoiceVideoTab /></TabPanel>
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
        {user?.bannerUrl ? (
          <img src={user.bannerUrl} alt="Banner" className="h-24 w-full object-cover" />
        ) : (
          <div className="h-24 bg-gradient-to-r from-nexe-600 to-nexe-500" />
        )}
        <div className="px-5 pb-5">
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="Avatar" className="-mt-9 h-[72px] w-[72px] rounded-full object-cover" style={{ border: "5px solid var(--color-dark-800)" }} />
          ) : (
            <div className="-mt-9 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-nexe-600 text-2xl font-bold text-white" style={{ border: "5px solid var(--color-dark-800)" }}>
              {(user?.displayName || user?.username || "U").charAt(0).toUpperCase()}
            </div>
          )}
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

const SOCIAL_PLATFORMS = ["Twitch", "YouTube", "Twitter", "Instagram", "TikTok", "Kick", "GitHub", "Website"] as const;
const DEFAULT_LIMITS: TierLimits = {
  tier: "free", maxOwnedGuilds: 10, maxEmojisPerGuild: 50, maxStickersPerGuild: 20,
  maxUploadBytes: 26214400, voiceBitrate: 128000, screenShareQuality: "720p30",
  animatedAvatar: false, animatedBanner: false, videoBanner: false,
  chatBridgeChannels: 1, analyticsDays: 7, serverBoosts: 0, prioritySupport: false,
  maxMessageLength: 2000, maxBioLength: 300, maxSocialLinks: 5, maxBadgesVisible: 5,
  maxClipsShowcase: 4, profileEffects: false, profileMusic: false, customCss: false,
  dragDropLayout: false, customBackground: false, featuredServers: 0, vanitySlug: false,
  visitorCounter: false, uploadStorageBytes: 52428800,
};

const BACKGROUND_PATTERNS = [
  { id: "none", label: "Default", value: "" },
  { id: "dots", label: "Dots", value: "radial-gradient(circle, rgba(99,102,241,0.08) 1px, transparent 1px)" },
  { id: "grid", label: "Grid", value: "linear-gradient(rgba(99,102,241,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.06) 1px, transparent 1px)" },
  { id: "diagonal", label: "Diagonal", value: "repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(99,102,241,0.04) 10px, rgba(99,102,241,0.04) 11px)" },
  { id: "gradient1", label: "Aurora", value: "linear-gradient(135deg, rgba(99,102,241,0.1), rgba(52,211,153,0.05), transparent)" },
  { id: "gradient2", label: "Sunset", value: "linear-gradient(135deg, rgba(244,114,182,0.08), rgba(251,191,36,0.04), transparent)" },
];

function TierBadge({ tier, feature }: { tier: string; feature?: string }) {
  if (tier === "pro") return <span className="ml-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold text-blue-400" title={feature ? `Requires Pro for ${feature}` : undefined}>PRO</span>;
  if (tier === "ultra") return <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-400" title={feature ? `Requires Ultra for ${feature}` : undefined}>ULTRA</span>;
  return null;
}

function xpForLevel(n: number): number {
  if (n < 1) return 0;
  return Math.floor(100 * Math.pow(n, 1.8));
}

function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [accentColor, setAccentColor] = useState("#6366f1");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);
  const [featuredClips, setFeaturedClips] = useState<{ title: string; url: string; thumbnail_url: string }[]>([]);
  const [level, setLevel] = useState(1);
  const [totalXp, setTotalXp] = useState(0);
  const [createdAt, setCreatedAt] = useState("");
  const [tier, setTier] = useState("free");
  const [limits, setLimits] = useState<TierLimits>(DEFAULT_LIMITS);
  const [backgroundPattern, setBackgroundPattern] = useState("");
  const [showAddLink, setShowAddLink] = useState(false);
  const [showAddClip, setShowAddClip] = useState(false);
  const [newPlatform, setNewPlatform] = useState<string>(SOCIAL_PLATFORMS[0]);
  const [newUrl, setNewUrl] = useState("");
  const [newClipTitle, setNewClipTitle] = useState("");
  const [newClipUrl, setNewClipUrl] = useState("");
  const [newClipThumb, setNewClipThumb] = useState("");
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
      setLevel(p.level ?? 1);
      setTotalXp(p.totalXp ?? 0);
      setCreatedAt(p.createdAt ?? "");
      if (p.tier) setTier(p.tier);
      if (p.tierLimits) setLimits(p.tierLimits);
      try {
        const raw = p as unknown as Record<string, unknown>;
        if (Array.isArray(raw.featuredClips)) setFeaturedClips(raw.featuredClips as typeof featuredClips);
        if (typeof raw.backgroundUrl === "string" && raw.backgroundUrl) setBackgroundPattern(raw.backgroundUrl);
      } catch { /* */ }
      setLoaded(true);
    }).catch(() => { if (!cancel) setLoaded(true); });
    return () => { cancel = true; };
  }, [user?.id]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>, type: "avatar" | "banner") {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const isGif = file.type === "image/gif";
    const isVideo = file.type.startsWith("video/");

    // Videos upload direct (no crop possible)
    if (isVideo && limits.videoBanner && type === "banner") {
      uploadFileDirect(file, type);
      return;
    }

    // GIFs skip crop modal — cropping destroys animation frames
    if (isGif && limits.animatedBanner && type === "banner") {
      uploadFileDirect(file, type);
      return;
    }
    if (isGif && limits.animatedAvatar && type === "avatar") {
      uploadFileDirect(file, type);
      return;
    }

    // Non-GIF/video → crop as usual
    const reader = new FileReader();
    reader.onload = () => setCropModal({ src: reader.result as string, type });
    reader.readAsDataURL(file);
  }

  async function uploadFileDirect(file: File, type: "avatar" | "banner") {
    setUploading(type);
    try {
      const { url } = type === "avatar" ? await api.uploadAvatar(file) : await api.uploadBanner(file);
      if (type === "avatar") setAvatarUrl(url);
      else setBannerUrl(url);
      flash("success", `${type === "avatar" ? "Avatar" : "Banner"} updated!`);
    } catch {
      flash("error", `Failed to upload ${type}`);
    } finally { setUploading(null); }
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
      flash("success", `${type === "avatar" ? "Avatar" : "Banner"} updated!`);
    } catch {
      flash("error", `Failed to upload ${type}`);
    } finally { setUploading(null); }
  }

  async function handleRemoveAvatar() {
    try { await api.deleteAvatar(); setAvatarUrl(null); flash("success", "Avatar removed"); }
    catch { flash("error", "Failed"); }
  }

  async function handleRemoveBanner() {
    try { await api.deleteBanner(); setBannerUrl(null); flash("success", "Banner removed"); }
    catch { flash("error", "Failed"); }
  }

  function flash(type: "success" | "error", msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 3000);
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
        featuredClips: featuredClips.length > 0 ? featuredClips : undefined,
        backgroundUrl: backgroundPattern || undefined,
      });
      flash("success", "Profile saved!");
    } catch (err) {
      flash("error", err instanceof Error ? err.message : "Failed");
    } finally { setLoading(false); }
  }

  function handleAddLink() {
    if (!newUrl.trim() || (limits.maxSocialLinks !== -1 && socialLinks.length >= limits.maxSocialLinks)) return;
    setSocialLinks((prev) => [...prev, { platform: newPlatform.toLowerCase(), url: newUrl.trim() }]);
    setNewUrl(""); setNewPlatform(SOCIAL_PLATFORMS[0]); setShowAddLink(false);
  }

  function handleAddClip() {
    if (!newClipUrl.trim() || !newClipTitle.trim()) return;
    setFeaturedClips((prev) => [...prev, { title: newClipTitle.trim(), url: newClipUrl.trim(), thumbnail_url: newClipThumb.trim() || "" }]);
    setNewClipTitle(""); setNewClipUrl(""); setNewClipThumb(""); setShowAddClip(false);
  }

  const previewName = displayName.trim() || user?.username || "User";

  // XP progress calc
  let accumulated = 0;
  for (let i = 1; i < level; i++) accumulated += xpForLevel(i);
  const xpIntoLevel = totalXp - accumulated;
  const xpNeeded = xpForLevel(level);
  const xpPercent = xpNeeded > 0 ? Math.min(Math.round((xpIntoLevel / xpNeeded) * 100), 100) : 0;

  return (
    <div className="space-y-5">
      {feedback && (
        <div className={`rounded-lg border px-4 py-2.5 text-sm ${feedback.type === "success" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-red-500/20 bg-red-500/10 text-red-400"}`}>{feedback.msg}</div>
      )}

      <div className="flex gap-6">
        {/* ── Left: Form ── */}
        <form onSubmit={handleSave} className="w-[360px] shrink-0 space-y-5">

          {/* Tier indicator */}
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
              tier === "ultra" ? "bg-amber-500/15 text-amber-400" :
              tier === "pro" ? "bg-blue-500/15 text-blue-400" :
              "bg-slate-500/10 text-slate-500"
            }`}>
              {tier.toUpperCase()}
            </span>
            <span className="text-[10px] text-slate-700">Your current tier</span>
          </div>

          {/* Avatar & Banner */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Visuals</p>
            <div className="flex gap-4">
              <div>
                <label className="mb-1 block text-[10px] font-medium text-slate-600">Avatar</label>
                <div className="group relative h-[72px] w-[72px]">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="h-[72px] w-[72px] rounded-2xl object-cover" />
                  ) : (
                    <div className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-nexe-600 text-xl font-bold text-white">
                      {previewName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-2xl bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                    <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={uploading === "avatar"} className="rounded-lg bg-white/20 p-1.5 text-white hover:bg-white/30">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </button>
                    {avatarUrl && (
                      <button type="button" onClick={handleRemoveAvatar} className="rounded-lg bg-red-500/30 p-1.5 text-white hover:bg-red-500/50">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                  {uploading === "avatar" && <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/60"><div className="h-4 w-4 animate-spin rounded-full border-2 border-nexe-500 border-t-transparent" /></div>}
                </div>
                <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => handleFileSelect(e, "avatar")} />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-[10px] font-medium text-slate-600">Banner</label>
                <div className="group relative h-[72px] overflow-hidden rounded-xl">
                  {bannerUrl && (bannerUrl.endsWith(".mp4") || bannerUrl.includes("video")) ? (
                    <video src={bannerUrl} className="h-[72px] w-full object-cover" autoPlay loop muted playsInline />
                  ) : bannerUrl ? (
                    <img src={bannerUrl} alt="" className="h-[72px] w-full object-cover" />
                  ) : (
                    <div className="h-[72px] w-full" style={{ background: `linear-gradient(135deg, ${accentColor}44, ${accentColor}11)` }} />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                    <button type="button" onClick={() => bannerInputRef.current?.click()} disabled={uploading === "banner"} className="rounded-lg bg-white/20 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-white/30">
                      {uploading === "banner" ? "..." : "Change"}
                    </button>
                    {bannerUrl && <button type="button" onClick={handleRemoveBanner} className="rounded-lg bg-red-500/30 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-500/50">Remove</button>}
                  </div>
                </div>
                <input ref={bannerInputRef} type="file" accept={limits.videoBanner ? "image/png,image/jpeg,image/gif,image/webp,video/mp4" : limits.animatedBanner ? "image/png,image/jpeg,image/gif,image/webp" : "image/png,image/jpeg,image/webp"} className="hidden" onChange={(e) => handleFileSelect(e, "banner")} />
                <p className="mt-1 text-[9px] text-slate-700">
                  {limits.videoBanner ? "Image, GIF, or MP4 video" : limits.animatedBanner ? "Image or GIF" : "Image only"} · 600×240
                </p>
              </div>
            </div>
          </div>

          {/* Display Name */}
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase text-slate-400">Display Name</label>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={user?.username ?? ""} className="w-full rounded-lg border border-dark-700 bg-dark-800 px-3 py-2 text-sm text-slate-200 outline-none focus:border-nexe-500" />
          </div>

          {/* Bio */}
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase text-slate-400">About Me</label>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} maxLength={limits.maxBioLength} placeholder="Tell people about yourself..."
              className="w-full resize-none rounded-lg border border-dark-700 bg-dark-800 px-3 py-2 text-sm text-slate-200 outline-none focus:border-nexe-500" />
            <p className="mt-0.5 text-right text-[10px] text-slate-700">{bio.length}/{limits.maxBioLength}</p>
          </div>

          {/* Accent Color */}
          <ColorPicker value={accentColor} onChange={setAccentColor} label="Profile Color" />

          {/* Background */}
          <div>
            <label className="mb-1.5 flex items-center text-[11px] font-bold uppercase text-slate-400">
              Background
              {!limits.customBackground && <TierBadge tier="pro" feature="custom background" />}
            </label>
            {/* Patterns (free) */}
            <div className="grid grid-cols-3 gap-1.5">
              {BACKGROUND_PATTERNS.map((pat) => (
                <button
                  key={pat.id}
                  type="button"
                  onClick={() => setBackgroundPattern(pat.value)}
                  className={`h-10 rounded-lg border text-[9px] font-medium transition-all ${
                    backgroundPattern === pat.value
                      ? "border-nexe-500 ring-1 ring-nexe-500/30 text-white"
                      : "border-dark-700 text-slate-500 hover:border-dark-600"
                  }`}
                  style={{ background: pat.value || "var(--color-dark-900)" }}
                >
                  {!pat.value && pat.label}
                </button>
              ))}
            </div>
            {/* Custom upload (Pro+) */}
            {limits.customBackground && (
              <div className="mt-2">
                {backgroundPattern.startsWith("http") ? (
                  <div className="flex items-center gap-2 rounded-lg border border-nexe-500/20 bg-nexe-500/5 px-3 py-2">
                    <span className="flex-1 truncate text-[10px] text-slate-400">{backgroundPattern.split("/").pop()}</span>
                    <button type="button" onClick={() => setBackgroundPattern("")} className="text-[10px] text-red-400 hover:text-red-300">Remove</button>
                  </div>
                ) : (
                  <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-dark-600 px-3 py-2 text-[10px] text-slate-500 transition-colors hover:border-nexe-500 hover:text-nexe-400">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    Upload custom image
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      e.target.value = "";
                      try {
                        const { url } = await api.uploadAttachment(file);
                        setBackgroundPattern(url);
                        flash("success", "Background uploaded!");
                      } catch {
                        flash("error", "Failed to upload background");
                      }
                    }} />
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Social Links */}
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase text-slate-400">Social Links <span className="font-normal normal-case text-slate-600">({socialLinks.length}/{limits.maxSocialLinks === -1 ? "∞" : limits.maxSocialLinks})</span></label>
            {socialLinks.length > 0 && (
              <div className="mb-2 space-y-1">
                {socialLinks.map((link, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-dark-700 bg-dark-800 px-3 py-1.5">
                    <span className="w-14 shrink-0 text-[10px] font-semibold capitalize text-slate-500">{link.platform}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">{link.url}</span>
                    <button type="button" onClick={() => setSocialLinks((p) => p.filter((_, j) => j !== i))} className="shrink-0 text-slate-600 hover:text-red-400">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            {showAddLink ? (
              <div className="space-y-2 rounded-lg border border-dark-700 bg-dark-800 p-3">
                <Select value={newPlatform} onChange={setNewPlatform} options={SOCIAL_PLATFORMS.map((p) => ({ value: p, label: p }))} />
                <input type="url" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://..." className="w-full rounded-md border border-dark-700 bg-dark-900 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-nexe-500" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddLink(); }}} autoFocus />
                <div className="flex gap-2">
                  <button type="button" onClick={handleAddLink} disabled={!newUrl.trim()} className="rounded-md bg-nexe-600 px-3 py-1 text-xs font-medium text-white hover:bg-nexe-500 disabled:opacity-50">Add</button>
                  <button type="button" onClick={() => { setShowAddLink(false); setNewUrl(""); }} className="text-xs text-slate-500 hover:text-white">Cancel</button>
                </div>
              </div>
            ) : (limits.maxSocialLinks === -1 || socialLinks.length < limits.maxSocialLinks) ? (
              <button type="button" onClick={() => setShowAddLink(true)} className="flex items-center gap-1.5 rounded-lg border border-dashed border-dark-600 px-3 py-1.5 text-xs text-slate-500 hover:border-nexe-500 hover:text-nexe-400">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M13 5a1 1 0 10-2 0v6H5a1 1 0 100 2h6v6a1 1 0 102 0v-6h6a1 1 0 100-2h-6z" /></svg>
                Add Link
              </button>
            ) : null}
          </div>

          {/* Featured Clips */}
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase text-slate-400">Featured Clips <span className="font-normal normal-case text-slate-600">({featuredClips.length}/{limits.maxClipsShowcase})</span></label>
            {featuredClips.length > 0 && (
              <div className="mb-2 space-y-1">
                {featuredClips.map((clip, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-dark-700 bg-dark-800 px-3 py-1.5">
                    {clip.thumbnail_url && <img src={clip.thumbnail_url} alt="" className="h-6 w-10 shrink-0 rounded object-cover" />}
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">{clip.title}</span>
                    <button type="button" onClick={() => setFeaturedClips((p) => p.filter((_, j) => j !== i))} className="shrink-0 text-slate-600 hover:text-red-400">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            {showAddClip ? (
              <div className="space-y-2 rounded-lg border border-dark-700 bg-dark-800 p-3">
                <input type="text" value={newClipTitle} onChange={(e) => setNewClipTitle(e.target.value)} placeholder="Clip title" className="w-full rounded-md border border-dark-700 bg-dark-900 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-nexe-500" autoFocus />
                <input type="url" value={newClipUrl} onChange={(e) => setNewClipUrl(e.target.value)} placeholder="Clip URL (Twitch/YouTube)" className="w-full rounded-md border border-dark-700 bg-dark-900 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-nexe-500" />
                <input type="url" value={newClipThumb} onChange={(e) => setNewClipThumb(e.target.value)} placeholder="Thumbnail URL (optional)" className="w-full rounded-md border border-dark-700 bg-dark-900 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-nexe-500" />
                <div className="flex gap-2">
                  <button type="button" onClick={handleAddClip} disabled={!newClipTitle.trim() || !newClipUrl.trim()} className="rounded-md bg-nexe-600 px-3 py-1 text-xs font-medium text-white hover:bg-nexe-500 disabled:opacity-50">Add</button>
                  <button type="button" onClick={() => { setShowAddClip(false); setNewClipTitle(""); setNewClipUrl(""); setNewClipThumb(""); }} className="text-xs text-slate-500 hover:text-white">Cancel</button>
                </div>
              </div>
            ) : featuredClips.length < limits.maxClipsShowcase ? (
              <button type="button" onClick={() => setShowAddClip(true)} className="flex items-center gap-1.5 rounded-lg border border-dashed border-dark-600 px-3 py-1.5 text-xs text-slate-500 hover:border-nexe-500 hover:text-nexe-400">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M13 5a1 1 0 10-2 0v6H5a1 1 0 100 2h6v6a1 1 0 102 0v-6h6a1 1 0 100-2h-6z" /></svg>
                Add Clip
              </button>
            ) : null}
          </div>

          {/* Save */}
          <button type="submit" disabled={loading || !loaded} className="w-full rounded-lg bg-nexe-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-nexe-500 disabled:opacity-50 transition-colors">
            {loading ? "Saving..." : "Save Changes"}
          </button>
        </form>

        {/* ── Right: Live Preview ── */}
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-[11px] font-bold uppercase text-slate-500">Preview</p>
          <div className="overflow-hidden rounded-xl border border-white/[0.06]" style={{ backgroundColor: "#0c1220" }}>
            {/* Banner */}
            <div className="relative">
              {bannerUrl ? (
                <img src={bannerUrl} alt="" className="h-28 w-full object-cover" />
              ) : (
                <div className="h-28" style={{ background: `linear-gradient(135deg, ${accentColor}33, ${accentColor}08)` }} />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0c1220] via-[#0c1220]/40 to-transparent" />
              {/* Avatar overlapping */}
              <div className="absolute -bottom-8 left-4">
                <div className="rounded-xl p-[2px]" style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}44)` }}>
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="h-16 w-16 rounded-xl object-cover" style={{ border: "2px solid #0c1220" }} />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ backgroundColor: accentColor, border: "2px solid #0c1220" }}>
                      {previewName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Info */}
            <div className="px-4 pb-4 pt-10">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-base font-bold text-white truncate">{previewName}</p>
                <span className="shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums" style={{ backgroundColor: accentColor + "20", color: accentColor }}>
                  <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 1l2.39 6.26H19l-5.3 3.98L15.69 18 10 14.27 4.31 18l1.99-6.76L1 7.26h6.61z" /></svg>
                  {level}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mb-3">@{user?.username}</p>

              {/* XP bar */}
              <div className="mb-3 rounded-lg bg-white/[0.03] p-2.5 border border-white/[0.04]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium text-slate-400">Level {level}</span>
                  <span className="text-[10px] font-semibold tabular-nums" style={{ color: accentColor }}>{xpPercent}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full" style={{ width: `${xpPercent}%`, backgroundColor: accentColor }} />
                </div>
                <div className="mt-1 flex justify-between text-[9px] text-slate-700">
                  <span className="tabular-nums">{Math.max(xpIntoLevel, 0).toLocaleString()} / {xpNeeded.toLocaleString()} XP</span>
                  <span>Level {level + 1}</span>
                </div>
              </div>

              {/* Bio */}
              {bio.trim() && (
                <div className="mb-3">
                  <p className="text-[10px] font-bold uppercase text-slate-600 mb-1">About</p>
                  <p className="text-[12px] leading-relaxed text-slate-300 break-words whitespace-pre-wrap">{bio}</p>
                </div>
              )}

              {/* Social links */}
              {socialLinks.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] font-bold uppercase text-slate-600 mb-1">Links</p>
                  <div className="flex flex-wrap gap-1">
                    {socialLinks.map((link, i) => (
                      <span key={i} className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[10px] capitalize text-slate-400 border border-white/[0.04]">{link.platform}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Clips */}
              {featuredClips.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] font-bold uppercase text-slate-600 mb-1">Clips</p>
                  <div className="grid grid-cols-2 gap-1">
                    {featuredClips.map((clip, i) => (
                      <div key={i} className="relative overflow-hidden rounded-md bg-dark-900 aspect-video">
                        {clip.thumbnail_url ? (
                          <img src={clip.thumbnail_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[9px] text-slate-600">{clip.title}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Member since */}
              {createdAt && (
                <p className="text-[9px] text-slate-700">
                  Nexe member since {new Date(createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {cropModal && (
        <ImageCropModal imageSrc={cropModal.src} type={cropModal.type} onConfirm={handleCropConfirm} onClose={() => setCropModal(null)} />
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

function PrivacyTab() {
  const [whoCanDm, setWhoCanDm] = useState("everyone");
  const [whoCanFriend, setWhoCanFriend] = useState("everyone");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getPrivacySettings().then((s) => {
      setWhoCanDm(s.whoCanDm);
      setWhoCanFriend(s.whoCanFriend);
    }).finally(() => setLoading(false));
  }, []);

  async function save(field: string, value: string) {
    setSaving(true);
    try {
      const updated = await api.updatePrivacySettings({ [field]: value });
      setWhoCanDm(updated.whoCanDm);
      setWhoCanFriend(updated.whoCanFriend);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading...</p>;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-100">Privacy & Safety</h2>

      {/* Who can DM */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
          Who can send you direct messages
        </label>
        <p className="mb-3 text-xs text-slate-500">
          Control who is allowed to send you DMs. Messages from blocked users are always hidden.
        </p>
        <div className="space-y-2">
          {([
            { value: "everyone", label: "Everyone", desc: "Anyone can DM you (strangers go to Message Requests)" },
            { value: "server_members", label: "Server Members", desc: "Only people you share a server with or are friends with" },
            { value: "friends", label: "Friends Only", desc: "Only people on your friends list" },
          ] as const).map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
                whoCanDm === opt.value
                  ? "border-nexe-500/50 bg-nexe-500/5"
                  : "border-dark-700 hover:border-dark-600"
              }`}
            >
              <input
                type="radio"
                name="whoCanDm"
                value={opt.value}
                checked={whoCanDm === opt.value}
                onChange={() => { setWhoCanDm(opt.value); save("whoCanDm", opt.value); }}
                disabled={saving}
                className="mt-0.5 accent-nexe-500"
              />
              <div>
                <span className="block text-sm font-medium text-slate-200">{opt.label}</span>
                <span className="text-xs text-slate-500">{opt.desc}</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Who can friend request */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
          Who can send you friend requests
        </label>
        <p className="mb-3 text-xs text-slate-500">
          Control who can add you as a friend.
        </p>
        <div className="space-y-2">
          {([
            { value: "everyone", label: "Everyone", desc: "Anyone can send you a friend request" },
            { value: "friends_of_friends", label: "Friends of Friends", desc: "Only people who share a mutual friend with you" },
            { value: "nobody", label: "Nobody", desc: "No one can send you friend requests" },
          ] as const).map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
                whoCanFriend === opt.value
                  ? "border-nexe-500/50 bg-nexe-500/5"
                  : "border-dark-700 hover:border-dark-600"
              }`}
            >
              <input
                type="radio"
                name="whoCanFriend"
                value={opt.value}
                checked={whoCanFriend === opt.value}
                onChange={() => { setWhoCanFriend(opt.value); save("whoCanFriend", opt.value); }}
                disabled={saving}
                className="mt-0.5 accent-nexe-500"
              />
              <div>
                <span className="block text-sm font-medium text-slate-200">{opt.label}</span>
                <span className="text-xs text-slate-500">{opt.desc}</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Block info */}
      <div className="rounded-lg border border-dark-700 bg-dark-800/50 p-4">
        <h3 className="text-sm font-semibold text-slate-300">Blocked Users</h3>
        <p className="mt-1 text-xs text-slate-500">
          Blocked users cannot send you DMs, friend requests, or see your online status.
          Manage your block list from the Friends page → Blocked tab.
        </p>
      </div>
    </div>
  );
}

function AppearanceTab() {
  const [autoStart, setAutoStart] = useState(false);
  const [autoStartLoaded, setAutoStartLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { isEnabled } = await import("@tauri-apps/plugin-autostart");
        setAutoStart(await isEnabled());
      } catch { /* not in Tauri */ }
      setAutoStartLoaded(true);
    })();
  }, []);

  async function toggleAutoStart(enabled: boolean) {
    setAutoStart(enabled);
    try {
      const { enable, disable } = await import("@tauri-apps/plugin-autostart");
      if (enabled) await enable();
      else await disable();
    } catch { setAutoStart(!enabled); }
  }

  const [chatFontSize, setChatFontSize] = useState(() =>
    Number(localStorage.getItem("nexe:chatFontSize") || "14")
  );
  const [compactMode, setCompactMode] = useState(() =>
    localStorage.getItem("nexe:compactMode") === "true"
  );
  const [showAvatars, setShowAvatars] = useState(() =>
    localStorage.getItem("nexe:showAvatars") !== "false"
  );
  const [animateEmotes, setAnimateEmotes] = useState(() =>
    localStorage.getItem("nexe:animateEmotes") !== "false"
  );
  const [showLinkPreviews, setShowLinkPreviews] = useState(() =>
    localStorage.getItem("nexe:showLinkPreviews") !== "false"
  );

  const updateSetting = (key: string, value: string) => {
    localStorage.setItem(`nexe:${key}`, value);
    // Dispatch event so other components can react
    window.dispatchEvent(new CustomEvent("nexe:appearance-change", { detail: { key, value } }));
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-100">Appearance</h2>

      {/* Auto-start */}
      {autoStartLoaded && (
        <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-200">Open Nexe on startup</p>
            <p className="text-xs text-slate-500">Automatically start Nexe when you log in to your computer</p>
          </div>
          <Toggle checked={autoStart} onChange={toggleAutoStart} />
        </div>
      )}

      {/* Chat Font Size */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
          Chat Font Size — {chatFontSize}px
        </label>
        <p className="mb-3 text-xs text-slate-500">Adjust the size of text in chat messages.</p>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-500">12px</span>
          <input
            type="range"
            min={12}
            max={20}
            value={chatFontSize}
            onChange={(e) => {
              const v = Number(e.target.value);
              setChatFontSize(v);
              updateSetting("chatFontSize", String(v));
            }}
            className="flex-1 accent-nexe-500"
          />
          <span className="text-xs text-slate-500">20px</span>
        </div>
        <div className="mt-3 rounded-lg border border-dark-700 bg-dark-900 p-3">
          <p className="text-slate-400" style={{ fontSize: `${chatFontSize}px` }}>
            This is a preview of your chat font size.
          </p>
        </div>
      </div>

      {/* Compact Mode */}
      <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800 p-4">
        <div>
          <p className="text-sm font-medium text-slate-200">Compact Mode</p>
          <p className="text-xs text-slate-500">Reduce spacing between messages for a denser layout.</p>
        </div>
        <Toggle
          checked={compactMode}
          onChange={(v) => {
            setCompactMode(v);
            updateSetting("compactMode", String(v));
          }}
        />
      </div>

      {/* Show Avatars */}
      <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800 p-4">
        <div>
          <p className="text-sm font-medium text-slate-200">Show Avatars</p>
          <p className="text-xs text-slate-500">Display user avatars next to messages.</p>
        </div>
        <Toggle
          checked={showAvatars}
          onChange={(v) => {
            setShowAvatars(v);
            updateSetting("showAvatars", String(v));
          }}
        />
      </div>

      {/* Animate Emotes */}
      <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800 p-4">
        <div>
          <p className="text-sm font-medium text-slate-200">Animate Emotes</p>
          <p className="text-xs text-slate-500">Play animated emotes (GIF). Disable to save performance.</p>
        </div>
        <Toggle
          checked={animateEmotes}
          onChange={(v) => {
            setAnimateEmotes(v);
            updateSetting("animateEmotes", String(v));
          }}
        />
      </div>

      {/* Show Link Previews */}
      <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800 p-4">
        <div>
          <p className="text-sm font-medium text-slate-200">Show Link Previews</p>
          <p className="text-xs text-slate-500">Display embedded previews for links shared in chat.</p>
        </div>
        <Toggle
          checked={showLinkPreviews}
          onChange={(v) => {
            setShowLinkPreviews(v);
            updateSetting("showLinkPreviews", String(v));
          }}
        />
      </div>
    </div>
  );
}

/* ─── Notifications Tab ─── */
function NotificationsTab() {
  const [mentions, setMentions] = useState(() => localStorage.getItem("nexe:notif:mentions") === "true");
  const [replies, setReplies] = useState(() => localStorage.getItem("nexe:notif:replies") === "true");
  const [streamLive, setStreamLive] = useState(() => localStorage.getItem("nexe:notif:streamLive") === "true");
  const [sound, setSound] = useState(() => localStorage.getItem("nexe:notif:sound") === "true");
  const [desktop, setDesktop] = useState(() => localStorage.getItem("nexe:notif:desktop") === "true");

  function toggle(key: string, value: boolean, setter: (v: boolean) => void) {
    setter(value);
    localStorage.setItem(`nexe:notif:${key}`, String(value));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 text-xl font-semibold text-white">Notifications</h2>
        <p className="text-sm text-slate-500">Choose what notifications you want to receive.</p>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Categories</p>

        <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800 p-4">
          <div>
            <p className="text-sm font-medium text-slate-200">Mentions</p>
            <p className="text-xs text-slate-500">When someone @mentions you or @everyone.</p>
          </div>
          <Toggle checked={mentions} onChange={(v) => toggle("mentions", v, setMentions)} />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800 p-4">
          <div>
            <p className="text-sm font-medium text-slate-200">Replies</p>
            <p className="text-xs text-slate-500">When someone replies to your message.</p>
          </div>
          <Toggle checked={replies} onChange={(v) => toggle("replies", v, setReplies)} />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800 p-4">
          <div>
            <p className="text-sm font-medium text-slate-200">Stream Live</p>
            <p className="text-xs text-slate-500">When a streamer in your servers goes live.</p>
          </div>
          <Toggle checked={streamLive} onChange={(v) => toggle("streamLive", v, setStreamLive)} />
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Delivery</p>

        <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800 p-4">
          <div>
            <p className="text-sm font-medium text-slate-200">Notification Sound</p>
            <p className="text-xs text-slate-500">Play a sound when you receive a notification.</p>
          </div>
          <Toggle checked={sound} onChange={(v) => toggle("sound", v, setSound)} />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800 p-4">
          <div>
            <p className="text-sm font-medium text-slate-200">Desktop Notifications</p>
            <p className="text-xs text-slate-500">Show system notifications for new messages.</p>
          </div>
          <Toggle checked={desktop} onChange={(v) => toggle("desktop", v, setDesktop)} />
        </div>
      </div>
    </div>
  );
}

/* ─── Voice & Video Tab ─── */
function VoiceVideoTab() {
  const [inputDevice, setInputDevice] = useState(() => localStorage.getItem("nexe:voice:inputDevice") ?? "");
  const [outputDevice, setOutputDevice] = useState(() => localStorage.getItem("nexe:voice:outputDevice") ?? "");
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [noiseMode, setNoiseModeState] = useState<NoiseMode>(() => getNoiseMode());
  const [echoCancellation, setEchoCancellation] = useState(() => localStorage.getItem("nexe:voice:echoCancellation") !== "false");
  const [autoGain, setAutoGain] = useState(() => localStorage.getItem("nexe:voice:autoGain") !== "false");
  const [tierLimits, setTierLimits] = useState<import("../lib/api").TierLimits | null>(null);

  const micTest = useMicTest({ input: inputDevice, output: outputDevice, echoCancellation, noiseMode, autoGain });

  useEffect(() => {
    (async () => {
      if (needsNativeVoice()) {
        // The Linux webview has no WebRTC, so the devices come from the native voice engine.
        const { inputs, outputs } = await listNativeDevices();
        // The list starts with a "Default" entry, which the select below already provides.
        setAudioDevices(inputs.filter((d) => d.deviceId) as MediaDeviceInfo[]);
        setOutputDevices(outputs.filter((d) => d.deviceId) as MediaDeviceInfo[]);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch { /* ignore */ }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioDevices(devices.filter((d) => d.kind === "audioinput"));
      setOutputDevices(devices.filter((d) => d.kind === "audiooutput"));
    })();
    // Fetch tier limits
    (async () => {
      try {
        const userJson = localStorage.getItem("user");
        if (!userJson) return;
        const user = JSON.parse(userJson);
        const profile = await api.getProfile(user.id);
        if (profile?.tierLimits) setTierLimits(profile.tierLimits);
      } catch { /* ignore */ }
    })();
  }, []);

  function saveVoiceSetting(key: string, value: string) {
    localStorage.setItem(`nexe:voice:${key}`, value);
  }

  const userTier = tierLimits?.tier || "free";
  const screenQuality = tierLimits?.screenShareQuality || "720p30";
  const voiceBitrate = tierLimits?.voiceBitrate || 128000;

  // Quality options with tier gating
  const qualityOptions = [
    { value: "720p30", label: "720p 30fps", desc: "Standard quality", tier: "free", minTier: "free" },
    { value: "1080p30", label: "1080p 30fps", desc: "Full HD", tier: "pro", minTier: "pro" },
    { value: "1080p60", label: "1080p 60fps", desc: "Full HD smooth", tier: "ultra", minTier: "ultra" },
  ];

  // DeepFilterNet runs in the native voice engine, so it is only offered where that engine is used.
  const noiseOptions: { value: NoiseMode; label: string; desc: string }[] = [
    { value: "off", label: "Off", desc: "No filtering" },
    { value: "standard", label: "Standard", desc: "Light, low CPU" },
    ...(needsNativeVoice() ? [{ value: "dfn" as NoiseMode, label: "DeepFilterNet", desc: "Strongest, AI based" }] : []),
  ];

  const tierOrder = ["free", "pro", "ultra"];
  const userTierIndex = tierOrder.indexOf(userTier);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 text-xl font-semibold text-white">Voice & Video</h2>
        <p className="text-sm text-slate-500">Configure your audio and video settings.</p>
      </div>

      {/* Tier badge */}
      <div className="flex items-center gap-2 rounded-lg border border-dark-700 bg-dark-800/50 px-4 py-3">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
          userTier === "ultra" ? "bg-amber-500/20 text-amber-400" : userTier === "pro" ? "bg-purple-500/20 text-purple-400" : "bg-slate-500/20 text-slate-400"
        }`}>{userTier}</span>
        <span className="text-xs text-slate-400">
          Voice: {Math.round(voiceBitrate / 1000)} kbps &middot; Screen: {screenQuality}
        </span>
      </div>

      <div className="space-y-4">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Audio Devices</p>
        <div className="rounded-lg border border-dark-700 bg-dark-800 p-4">
          <label className="mb-2 block text-sm font-medium text-slate-200">Input Device</label>
          <select
            value={inputDevice}
            onChange={(e) => { setInputDevice(e.target.value); saveVoiceSetting("inputDevice", e.target.value); if (needsNativeVoice()) invoke("voice_set_input", { deviceId: e.target.value, label: null }).catch(() => {}); }}
            className="w-full rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-sm text-white outline-none focus:border-nexe-500"
          >
            <option value="">Default</option>
            {audioDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 8)}`}</option>
            ))}
          </select>
        </div>
        <div className="rounded-lg border border-dark-700 bg-dark-800 p-4">
          <label className="mb-2 block text-sm font-medium text-slate-200">Output Device</label>
          <select
            value={outputDevice}
            onChange={(e) => { setOutputDevice(e.target.value); saveVoiceSetting("outputDevice", e.target.value); if (needsNativeVoice()) invoke("voice_set_output", { deviceId: e.target.value, label: null }).catch(() => {}); }}
            className="w-full rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-sm text-white outline-none focus:border-nexe-500"
          >
            <option value="">Default</option>
            {outputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 8)}`}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Microphone Test</p>
        <div className="rounded-lg border border-dark-700 bg-dark-800 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-200">Check your microphone</p>
              <p className="text-xs text-slate-500">
                Speak and you will hear yourself with the settings below. Use headphones to avoid echo.
              </p>
            </div>
            <button
              onClick={() => (micTest.running ? micTest.stop() : void micTest.start())}
              className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
                micTest.running ? "bg-red-600 hover:bg-red-500" : "bg-nexe-600 hover:bg-nexe-500"
              }`}
            >
              {micTest.running ? "Stop test" : "Test microphone"}
            </button>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-dark-900" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(micTest.level * 100)}>
            <div
              className={`h-full rounded-full transition-[width] duration-75 ${
                micTest.level > 0.9 ? "bg-red-500" : micTest.level > 0.75 ? "bg-amber-400" : "bg-green-500"
              }`}
              style={{ width: `${Math.round(micTest.level * 100)}%` }}
            />
          </div>
          {micTest.error && <p className="mt-2 text-xs text-red-400">{micTest.error}</p>}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Audio Processing</p>
        <div className="rounded-lg border border-dark-700 bg-dark-800 p-4">
          <p className="text-sm font-medium text-slate-200">Noise Suppression</p>
          <p className="mb-3 text-xs text-slate-500">Reduce background noise from your microphone. Use "Test microphone" above to compare.</p>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${noiseOptions.length}, minmax(0, 1fr))` }}>
            {noiseOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { setNoiseModeState(opt.value); setNoiseMode(opt.value); applyNativeProcessing(); }}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  noiseMode === opt.value ? "border-nexe-500 bg-nexe-500/10" : "border-dark-600 hover:border-dark-500"
                }`}
              >
                <span className="block text-sm font-medium text-slate-200">{opt.label}</span>
                <span className="block text-[11px] text-slate-500">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800 p-4">
          <div>
            <p className="text-sm font-medium text-slate-200">Echo Cancellation</p>
            <p className="text-xs text-slate-500">Prevent echo from your speakers being captured.</p>
          </div>
          <Toggle checked={echoCancellation} onChange={(v) => { setEchoCancellation(v); saveVoiceSetting("echoCancellation", String(v)); applyNativeProcessing(); }} />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800 p-4">
          <div>
            <p className="text-sm font-medium text-slate-200">Auto Gain Control</p>
            <p className="text-xs text-slate-500">Automatically adjust microphone volume.</p>
          </div>
          <Toggle checked={autoGain} onChange={(v) => { setAutoGain(v); saveVoiceSetting("autoGain", String(v)); applyNativeProcessing(); }} />
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Stream Quality</p>
        <div className="rounded-lg border border-dark-700 bg-dark-800 p-4">
          <label className="mb-2 block text-sm font-medium text-slate-200">Screen Share Quality</label>
          <p className="mb-3 text-xs text-slate-500">Your tier determines the maximum quality. Change your tier in the admin panel.</p>
          <div className="space-y-2">
            {qualityOptions.map((opt) => {
              const optIndex = tierOrder.indexOf(opt.minTier);
              const locked = optIndex > userTierIndex;
              const isActive = screenQuality === opt.value;
              return (
                <div
                  key={opt.value}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors ${
                    locked ? "border-dark-700 opacity-50 cursor-not-allowed" :
                    isActive ? "border-nexe-500 bg-nexe-500/5" : "border-dark-600"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                      isActive ? "border-nexe-500 bg-nexe-500" : "border-dark-500"
                    }`}>
                      {isActive && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </div>
                    <div>
                      <span className="text-sm text-white">{opt.label}</span>
                      <span className="ml-2 text-xs text-slate-500">{opt.desc}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {locked && (
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current text-slate-600">
                        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                      </svg>
                    )}
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                      opt.minTier === "ultra" ? "bg-amber-500/15 text-amber-400" :
                      opt.minTier === "pro" ? "bg-purple-500/15 text-purple-400" : "bg-slate-500/15 text-slate-400"
                    }`}>{opt.minTier}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Voice Bitrate */}
        <div className="rounded-lg border border-dark-700 bg-dark-800 p-4">
          <label className="mb-2 block text-sm font-medium text-slate-200">Voice Bitrate</label>
          <p className="mb-3 text-xs text-slate-500">Higher bitrate = clearer voice quality. Determined by your tier.</p>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="relative h-2 rounded-full bg-dark-600">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-nexe-500 to-nexe-400"
                  style={{ width: `${Math.min(100, (voiceBitrate / 320000) * 100)}%` }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] text-slate-600">
                <span>64 kbps</span>
                <span>128 kbps</span>
                <span>256 kbps</span>
                <span>320 kbps</span>
              </div>
            </div>
            <span className="text-lg font-bold text-white">{Math.round(voiceBitrate / 1000)}<span className="text-xs font-normal text-slate-500"> kbps</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Data & Privacy (GDPR) ──

function DataPrivacyTab({ onClose }: { onClose: () => void }) {
  const [exporting, setExporting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const logout = useAuthStore((s) => s.logout);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("https://nexeapi.decatron.net/users/@me/export", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nexe-data-export.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to export data. Try again later.");
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError("");
    try {
      await api.deleteAccount();
      logout();
      onClose();
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete account");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-8">
      <div>
        <h2 className="text-xl font-bold text-white">Data & Privacy</h2>
        <p className="mt-1 text-sm text-slate-500">Manage your personal data and account</p>
      </div>

      {/* Data Export */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-nexe-500/10 text-nexe-400">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-white">Request Your Data</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Download a copy of your Nexe data including your profile, messages, servers, friends, and DMs. The export is a JSON file.
            </p>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="mt-3 rounded-lg bg-white/[0.06] px-4 py-2 text-xs font-semibold text-slate-200 ring-1 ring-white/[0.08] transition-all hover:bg-white/[0.1] hover:text-white disabled:opacity-50"
            >
              {exporting ? "Preparing export..." : "Download My Data"}
            </button>
          </div>
        </div>
      </div>

      {/* Account Deletion */}
      <div className="rounded-xl border border-red-500/20 bg-red-500/[0.03] p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-red-400">Delete Account</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Permanently delete your account and all associated data. Your messages will be anonymized (shown as "Deleted User"). You have <span className="font-semibold text-slate-300">14 days</span> to restore your account after requesting deletion.
            </p>

            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="mt-3 rounded-lg bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 ring-1 ring-red-500/20 transition-all hover:bg-red-500/20"
              >
                Delete My Account
              </button>
            ) : (
              <div className="mt-4 space-y-3 rounded-lg border border-red-500/20 bg-dark-900 p-4">
                <p className="text-xs font-medium text-red-400">
                  Are you sure? This action is irreversible after 14 days.
                </p>
                <ul className="space-y-1 text-[11px] text-slate-500">
                  <li>- Your account will be disabled immediately</li>
                  <li>- All sessions will be terminated</li>
                  <li>- Your messages will be anonymized</li>
                  <li>- You must transfer server ownership before deleting</li>
                  <li>- You have 14 days to restore by logging in</li>
                </ul>

                {deleteError && (
                  <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{deleteError}</p>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="rounded-lg bg-red-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-red-500/20 transition-all hover:bg-red-600 disabled:opacity-50"
                  >
                    {deleting ? "Deleting..." : "Yes, Delete My Account"}
                  </button>
                  <button
                    onClick={() => { setShowDeleteConfirm(false); setDeleteError(""); }}
                    className="rounded-lg bg-white/[0.06] px-4 py-2 text-xs font-medium text-slate-400 transition-colors hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4">
        <p className="text-[11px] leading-relaxed text-slate-600">
          Nexe complies with GDPR and data protection regulations. Your data belongs to you. If you have questions about your data, contact us at <span className="text-slate-400">privacy@nexe.gg</span>
        </p>
      </div>
    </div>
  );
}
