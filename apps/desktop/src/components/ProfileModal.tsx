import { useEffect, useState } from "react";
import { api, type UserProfile, type UserBadge } from "../lib/api";

function userColor(userId: string): string {
  const colors = ["#a78bfa","#34d399","#f472b6","#60a5fa","#fbbf24","#fb923c","#c084fc","#2dd4bf","#f87171","#a3e635"];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }
  catch { return ""; }
}

function timeSince(iso: string): string {
  try {
    const months = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 30));
    if (months < 1) return "< 1 month";
    if (months < 12) return `${months} month${months > 1 ? "s" : ""}`;
    const y = Math.floor(months / 12);
    return `${y} year${y > 1 ? "s" : ""}`;
  } catch { return ""; }
}

interface Props {
  userId: string;
  onClose: () => void;
}

export default function ProfileModal({ userId, onClose }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const color = userColor(userId);

  useEffect(() => {
    let cancel = false;
    api.getProfile(userId).then((p) => { if (!cancel) { setProfile(p); setLoading(false); } }).catch(() => { if (!cancel) setLoading(false); });
    api.getBadges(userId).then((b) => { if (!cancel) setBadges(b ?? []); }).catch(() => {});
    return () => { cancel = true; };
  }, [userId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const accent = profile?.accentColor || color;
  const displayName = profile?.displayName || profile?.username || "User";
  const username = profile?.username || "unknown";
  const level = profile?.level ?? 1;
  const totalXp = profile?.totalXp ?? 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-lg shadow-2xl"
        style={{ backgroundColor: "#111827" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white/70 hover:text-white"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-nexe-500" />
          </div>
        ) : profile ? (
          <>
            {/* Banner */}
            <div className="h-28" style={{ backgroundColor: accent }} />

            {/* Header */}
            <div className="relative border-b border-slate-700/50 px-6 pb-4">
              <div className="relative -mt-10 mb-2 inline-block">
                <div
                  className="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold text-white"
                  style={{ backgroundColor: accent, border: "5px solid #111827" }}
                >
                  {displayName.charAt(0).toUpperCase()}
                </div>
                <div className="absolute bottom-1 right-1 h-5 w-5 rounded-full border-[3px] bg-green-500" style={{ borderColor: "#111827" }} />
              </div>

              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">{displayName}</h2>
                  <p className="text-sm text-slate-400">@{username}</p>
                </div>
                <div
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                  style={{ backgroundColor: accent + "22", color: accent }}
                >
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 1l2.39 6.26H19l-5.3 3.98L15.69 18 10 14.27 4.31 18l1.99-6.76L1 7.26h6.61z" />
                  </svg>
                  Level {level}
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="space-y-4 p-5">
              {/* About Me */}
              {profile.bio && (
                <div>
                  <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">About Me</h4>
                  <p className="text-[13px] leading-relaxed text-slate-300">{profile.bio}</p>
                </div>
              )}

              {/* Social Links */}
              {profile.socialLinks && profile.socialLinks.length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Connections</h4>
                  <div className="flex flex-wrap gap-2">
                    {profile.socialLinks.map((link, i) => (
                      <a
                        key={i}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-[12px] text-slate-300 hover:bg-slate-700 hover:text-white"
                      >
                        <span className="capitalize">{link.platform}</span>
                        {link.verified && (
                          <svg className="h-3 w-3 text-nexe-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div>
                <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Stats</h4>
                <div className="grid grid-cols-3 gap-2">
                  <StatCard label="Level" value={String(level)} />
                  <StatCard label="Total XP" value={totalXp.toLocaleString()} />
                  <StatCard label="Member" value={timeSince(profile.createdAt)} />
                </div>
              </div>

              {/* Badges */}
              <div>
                <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Badges</h4>
                {badges.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {badges.map((badge) => (
                      <span
                        key={badge.id}
                        title={badge.description || badge.name}
                        className="flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-300"
                      >
                        <ProfileBadgeIcon iconUrl={badge.iconUrl} />
                        {badge.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-slate-600">No badges earned yet</p>
                )}
              </div>

              {/* Member since */}
              <p className="text-[11px] text-slate-600">Joined {formatDate(profile.createdAt)}</p>
            </div>
          </>
        ) : (
          <div className="flex h-60 items-center justify-center text-sm text-red-400">
            Failed to load profile
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-800/80 px-3 py-3 text-center">
      <p className="text-sm font-bold text-white">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase text-slate-500">{label}</p>
    </div>
  );
}

// Badge icon — uses known icon slugs or falls back to a star
const BADGE_ICONS: Record<string, string> = {
  early_adopter: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  streamer: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z",
  developer: "M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z",
};

function ProfileBadgeIcon({ iconUrl }: { iconUrl: string }) {
  const path = BADGE_ICONS[iconUrl];
  if (path) {
    return (
      <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
        <path d={path} />
      </svg>
    );
  }
  if (iconUrl.startsWith("http")) {
    return <img src={iconUrl} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" />;
  }
  return (
    <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 1l2.39 6.26H19l-5.3 3.98L15.69 18 10 14.27 4.31 18l1.99-6.76L1 7.26h6.61z" />
    </svg>
  );
}
