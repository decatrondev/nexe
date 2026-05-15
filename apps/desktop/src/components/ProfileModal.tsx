import { useEffect, useState } from "react";
import { api, type UserProfile, type UserBadge, type StreamStatus } from "../lib/api";
import { useGuildStore } from "../stores/guild";
import { useAuthStore } from "../stores/auth";
import { userColor } from "../lib/utils";
import { Tooltip } from "@nexe/ui";

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

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function activityIcon(type: string): string {
  switch (type) {
    case "level_up": return "⬆";
    case "badge_earned": return "🏅";
    case "server_joined": return "📥";
    case "message_milestone": return "💬";
    default: return "•";
  }
}

function activityLabel(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case "level_up": return `Reached level ${data.level ?? "?"}`;
    case "badge_earned": return `Earned badge "${data.name ?? "?"}"`;
    case "server_joined": return `Joined ${data.guildName ?? "a server"}`;
    case "message_milestone": return `Sent ${(data.count as number)?.toLocaleString() ?? "?"} messages`;
    default: return type.replace(/_/g, " ");
  }
}

interface Props {
  userId: string;
  streamStatus?: StreamStatus;
  onClose: () => void;
}

function formatUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export default function ProfileModal({ userId, streamStatus, onClose }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [activity, setActivity] = useState<{ id: string; type: string; data: Record<string, unknown>; createdAt: string }[]>([]);
  const [clips, setClips] = useState<{ title: string; thumbnail_url: string; url: string; view_count: number; creator_name: string; video_url?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const color = userColor(userId);
  const myGuilds = useGuildStore((s) => s.guilds);
  const allMembers = useGuildStore((s) => s.members);
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const allRoles = useGuildStore((s) => s.roles);
  const memberRolesMap = useGuildStore((s) => s.memberRoles);
  const currentUser = useAuthStore((s) => s.user);

  // Roles in current server
  const guildRoles = (activeGuildId ? allRoles[activeGuildId] : undefined) ?? [];
  const userRoleIds = memberRolesMap[userId] || [];
  const userRoles = guildRoles
    .filter((r) => userRoleIds.includes(r.id) && !r.isDefault)
    .sort((a, b) => b.position - a.position);

  // Shared servers = guilds where both users are members
  const sharedServers = myGuilds.filter((g) => {
    const members = allMembers[g.id];
    return members?.some((m) => m.userId === userId);
  });

  useEffect(() => {
    let cancel = false;
    api.getProfile(userId).then((p) => {
      if (cancel) return;
      setProfile(p);
      setLoading(false);
      // Fetch clips if user has Twitch linked
      if (p?.twitchId) {
        api.getTwitchClips(p.twitchId).then((c) => { if (!cancel) setClips(Array.isArray(c) ? c : []); }).catch(() => {});
      }
    }).catch(() => { if (!cancel) setLoading(false); });
    api.getBadges(userId).then((b) => { if (!cancel) setBadges(b ?? []); }).catch(() => {});
    api.getActivity(userId, 10).then((a) => { if (!cancel) setActivity(a ?? []); }).catch(() => {});
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
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 p-6 animate-modal-backdrop" onClick={onClose}>
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-lg shadow-2xl animate-modal-content"
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
            {profile.bannerUrl ? (
              <img src={profile.bannerUrl} alt="Banner" className="h-28 w-full object-cover" />
            ) : (
              <div className="h-28" style={{ backgroundColor: accent }} />
            )}

            {/* Header */}
            <div className="relative border-b border-slate-700/50 px-6 pb-4">
              <div className="relative -mt-10 mb-2 inline-block">
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={displayName}
                    className="h-20 w-20 rounded-full object-cover"
                    style={{ border: "5px solid #111827" }}
                  />
                ) : (
                  <div
                    className="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold text-white"
                    style={{ backgroundColor: accent, border: "5px solid #111827" }}
                  >
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                )}
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

              {/* Server Roles */}
              {userRoles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {userRoles.map((role) => (
                    <span
                      key={role.id}
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        backgroundColor: (role.color || "#99AAB5") + "20",
                        color: role.color || "#99AAB5",
                        border: `1px solid ${(role.color || "#99AAB5")}30`,
                      }}
                    >
                      {role.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Content */}
            <div className="space-y-4 p-5">
              {/* Stream Preview */}
              {streamStatus?.live && (
                <div>
                  <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-red-400">🔴 Live on Twitch</h4>
                  <a
                    href={`https://twitch.tv/${username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-lg border border-dark-700 transition-all hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10"
                  >
                    {streamStatus.thumbnail && (
                      <img
                        src={streamStatus.thumbnail.replace("{width}", "480").replace("{height}", "270")}
                        alt="Stream"
                        className="w-full object-cover"
                      />
                    )}
                    <div className="bg-dark-800 px-3 py-2">
                      <p className="truncate text-sm font-medium text-slate-200">{streamStatus.title}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                        <span>{streamStatus.game}</span>
                        {streamStatus.viewers !== undefined && (
                          <>
                            <span>·</span>
                            <span>{streamStatus.viewers.toLocaleString()} viewers</span>
                          </>
                        )}
                        {streamStatus.startedAt && (
                          <>
                            <span>·</span>
                            <span>{formatUptime(streamStatus.startedAt)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </a>
                </div>
              )}

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
                  <StatCard label="Level" value={String(level)} accent={accent} />
                  <StatCard label="Total XP" value={totalXp.toLocaleString()} accent={accent} />
                  <StatCard label="Member" value={timeSince(profile.createdAt)} accent={accent} />
                </div>
              </div>

              {/* Badges */}
              <div>
                <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Badges</h4>
                {badges.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {badges.map((badge) => (
                      <Tooltip key={badge.id} content={<div className="text-center"><p className="font-semibold">{badge.name}</p>{badge.description && <p className="text-xs text-slate-400">{badge.description}</p>}</div>} side="top">
                        <span
                          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-slate-200 transition-colors hover:brightness-110"
                          style={{ backgroundColor: accent + "20", border: `1px solid ${accent}30` }}
                        >
                          <ProfileBadgeIcon iconUrl={badge.iconUrl} />
                          {badge.name}
                        </span>
                      </Tooltip>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-slate-600">No badges earned yet</p>
                )}
              </div>

              {/* Shared Servers */}
              {currentUser?.id !== userId && sharedServers.length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Mutual Servers — {sharedServers.length}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {sharedServers.map((g) => (
                      <Tooltip key={g.id} content={g.name} side="top">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-dark-700 text-xs font-semibold text-slate-300">
                          {g.iconUrl ? (
                            <img src={g.iconUrl} alt={g.name} className="h-8 w-8 rounded-full object-cover" />
                          ) : (
                            g.name.charAt(0).toUpperCase()
                          )}
                        </span>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              )}

              {/* Activity Feed */}
              {activity.length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Recent Activity</h4>
                  <div className="space-y-1.5">
                    {activity.map((a) => (
                      <div key={a.id} className="flex items-center gap-2 rounded-md bg-slate-800/50 px-3 py-2 text-[12px]">
                        <span className="text-slate-500">{activityIcon(a.type)}</span>
                        <span className="flex-1 text-slate-300">{activityLabel(a.type, a.data)}</span>
                        <span className="shrink-0 text-[10px] text-slate-600">{timeAgo(a.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Twitch Clips */}
              {clips.length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Twitch Clips</h4>
                  <div className="grid grid-cols-3 gap-1.5">
                    {clips.slice(0, 6).map((clip, i) => (
                      <a
                        key={i}
                        href={clip.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative overflow-hidden rounded-md bg-dark-900"
                      >
                        <img
                          src={clip.thumbnail_url}
                          alt={clip.title}
                          className="aspect-video w-full object-cover group-hover:brightness-110 transition"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                          <p className="truncate px-1.5 pb-1 text-[10px] text-white">{clip.title}</p>
                        </div>
                        <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[9px] text-white">
                          {clip.view_count.toLocaleString()} views
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

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

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      className="rounded-lg px-3 py-3 text-center"
      style={accent ? { backgroundColor: accent + "10", border: `1px solid ${accent}20` } : { backgroundColor: "rgba(30,41,59,0.8)" }}
    >
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
