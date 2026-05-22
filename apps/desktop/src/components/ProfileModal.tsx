import { useEffect, useState } from "react";
import { api, type UserProfile, type UserBadge, type StreamStatus } from "../lib/api";
import { useGuildStore } from "../stores/guild";
import { useAuthStore } from "../stores/auth";
import { userColor } from "../lib/utils";
import { Tooltip } from "@nexe/ui";

/* ── Helpers ── */

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }
  catch { return ""; }
}


function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function formatUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function activityLabel(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case "level_up": return `Reached level ${data.level ?? "?"}`;
    case "badge_earned": return `Earned "${data.name ?? "?"}"`;
    case "server_joined": return `Joined ${data.guildName ?? "a server"}`;
    case "message_milestone": return `${(data.count as number)?.toLocaleString() ?? "?"} messages sent`;
    default: return type.replace(/_/g, " ");
  }
}

const ACTIVITY_ICONS: Record<string, { path: string; color: string }> = {
  level_up: { path: "M5 10l7-7m0 0l7 7m-7-7v18", color: "#34d399" },
  badge_earned: { path: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z", color: "#fbbf24" },
  server_joined: { path: "M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z", color: "#60a5fa" },
  message_milestone: { path: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z", color: "#a78bfa" },
};

/* ── XP / Level calculation — must match backend model/profile.go ── */

function xpForLevel(n: number): number {
  if (n < 1) return 0;
  return Math.floor(100 * Math.pow(n, 1.8));
}

function getLevelProgress(level: number, totalXp: number): { current: number; needed: number; percent: number } {
  let accumulated = 0;
  for (let i = 1; i < level; i++) accumulated += xpForLevel(i);
  const xpIntoLevel = totalXp - accumulated;
  const needed = xpForLevel(level);
  const percent = needed > 0 ? Math.min(Math.round((xpIntoLevel / needed) * 100), 100) : 0;
  return { current: Math.max(xpIntoLevel, 0), needed, percent };
}

/* ── Types ── */

type Tab = "about" | "activity" | "connections";

interface Props {
  userId: string;
  streamStatus?: StreamStatus;
  onClose: () => void;
}

/* ── Badge icon ── */

const BADGE_ICONS: Record<string, string> = {
  early_adopter: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  streamer: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z",
  developer: "M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z",
};

function BadgeIcon({ iconUrl, size = "h-4 w-4" }: { iconUrl: string; size?: string }) {
  const path = BADGE_ICONS[iconUrl];
  if (path) return <svg className={`${size} shrink-0`} viewBox="0 0 24 24" fill="currentColor"><path d={path} /></svg>;
  if (iconUrl.startsWith("http")) return <img src={iconUrl} alt="" className={`${size} shrink-0 rounded-sm`} />;
  return <svg className={`${size} shrink-0`} viewBox="0 0 20 20" fill="currentColor"><path d="M10 1l2.39 6.26H19l-5.3 3.98L15.69 18 10 14.27 4.31 18l1.99-6.76L1 7.26h6.61z" /></svg>;
}

/* ── Presence dot ── */

const PRESENCE_COLOR: Record<string, string> = { online: "bg-emerald-500", idle: "bg-yellow-500", dnd: "bg-red-500", offline: "bg-slate-600" };
const PRESENCE_RING: Record<string, string> = { online: "ring-emerald-500/30", idle: "ring-yellow-500/30", dnd: "ring-red-500/30", offline: "ring-slate-600/30" };
const PRESENCE_LABEL: Record<string, string> = { online: "Online", idle: "Idle", dnd: "Do Not Disturb", offline: "Offline" };

/* ── Component ── */

export default function ProfileModal({ userId, streamStatus, onClose }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [mutualFriendIds, setMutualFriendIds] = useState<string[]>([]);
  const [activity, setActivity] = useState<{ id: string; type: string; data: Record<string, unknown>; createdAt: string }[]>([]);
  const [clips, setClips] = useState<{ title: string; thumbnail_url: string; url: string; view_count: number; creator_name: string; video_url?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("about");

  const color = userColor(userId);
  const presenceMap = useGuildStore((s) => s.presenceMap);
  const presenceStatus = presenceMap[userId] || "offline";
  const myGuilds = useGuildStore((s) => s.guilds);
  const allMembers = useGuildStore((s) => s.members);
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const allRoles = useGuildStore((s) => s.roles);
  const memberRolesMap = useGuildStore((s) => s.memberRoles);
  const currentUser = useAuthStore((s) => s.user);

  const guildRoles = (activeGuildId ? allRoles[activeGuildId] : undefined) ?? [];
  const userRoleIds = memberRolesMap[userId] || [];
  const userRoles = guildRoles.filter((r) => userRoleIds.includes(r.id) && !r.isDefault).sort((a, b) => b.position - a.position);

  const sharedServers = myGuilds.filter((g) => allMembers[g.id]?.some((m) => m.userId === userId));

  useEffect(() => {
    let cancel = false;
    api.getProfile(userId).then((p) => {
      if (cancel) return;
      setProfile(p);
      setLoading(false);
      if (p?.twitchId) {
        api.getTwitchClips(p.twitchId).then((c) => { if (!cancel) setClips(Array.isArray(c) ? c : []); }).catch(() => {});
      }
    }).catch(() => { if (!cancel) setLoading(false); });
    api.getBadges(userId).then((b) => { if (!cancel) setBadges(b ?? []); }).catch(() => {});
    api.getActivity(userId, 10).then((a) => { if (!cancel) setActivity(a ?? []); }).catch(() => {});
    if (currentUser?.id !== userId) {
      api.getMutualFriends(userId).then((ids) => { if (!cancel) setMutualFriendIds(ids ?? []); }).catch(() => {});
    }
    return () => { cancel = true; };
  }, [userId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const accent = profile?.accentColor || color;
  const displayName = profile?.displayName || profile?.username || "User";
  const backgroundUrl = (profile as unknown as Record<string, unknown>)?.backgroundUrl as string | undefined;
  const username = profile?.username || "unknown";
  const level = profile?.level ?? 1;
  const totalXp = profile?.totalXp ?? 0;
  const isLive = streamStatus?.live;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 p-4 animate-modal-backdrop" onClick={onClose}>
      <div
        className="relative flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl shadow-modal animate-modal-content"
        style={{
          backgroundColor: "#0c1220",
          backgroundImage: backgroundUrl?.startsWith("http") ? `url(${backgroundUrl})` : backgroundUrl || undefined,
          backgroundSize: backgroundUrl?.startsWith("http") ? "cover" : undefined,
          backgroundPosition: backgroundUrl?.startsWith("http") ? "center" : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white/50 backdrop-blur-sm transition-all hover:bg-black/60 hover:text-white"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-nexe-500" />
          </div>
        ) : profile ? (
          <>
            {/* ═══ Hero Banner ═══ */}
            <div className="relative shrink-0">
              {profile.bannerUrl && (profile.bannerUrl.endsWith(".mp4") || profile.bannerUrl.includes("video")) ? (
                <video src={profile.bannerUrl} className="h-36 w-full object-cover" autoPlay loop muted playsInline />
              ) : profile.bannerUrl ? (
                <img src={profile.bannerUrl} alt="" className="h-36 w-full object-cover" />
              ) : (
                <div className="h-36" style={{ background: `linear-gradient(135deg, ${accent}44, ${accent}11)` }} />
              )}
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0c1220] via-[#0c1220]/60 to-transparent" />

              {/* LIVE strip */}
              {isLive && (
                <div className="absolute left-0 right-0 bottom-0 z-10 flex items-center gap-2 bg-red-600/90 px-4 py-1.5 backdrop-blur-sm">
                  <span className="h-2 w-2 rounded-full bg-white animate-pulse-subtle" />
                  <span className="text-[11px] font-bold uppercase tracking-wide text-white">Live</span>
                  {streamStatus?.game && <span className="text-[11px] text-red-100/80">· {streamStatus.game}</span>}
                  {streamStatus?.viewers !== undefined && (
                    <span className="ml-auto text-[11px] tabular-nums text-red-100/70">{streamStatus.viewers.toLocaleString()} watching</span>
                  )}
                </div>
              )}

              {/* Avatar — overlapping banner */}
              <div className="absolute -bottom-10 left-5 z-10">
                <div className={`rounded-full p-[3px] ring-2 ${PRESENCE_RING[presenceStatus] || PRESENCE_RING.offline}`} style={{ backgroundColor: "#0c1220" }}>
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt={displayName} className="h-[72px] w-[72px] rounded-full object-cover" />
                  ) : (
                    <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full text-2xl font-bold text-white" style={{ backgroundColor: accent }}>
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className={`absolute bottom-0 right-0 h-5 w-5 rounded-full border-[3px] ${PRESENCE_COLOR[presenceStatus] || PRESENCE_COLOR.offline}`} style={{ borderColor: "#0c1220" }} />
                </div>
              </div>
            </div>

            {/* ═══ Identity ═══ */}
            <div className="shrink-0 px-5 pb-3 pt-12">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-lg font-bold text-white leading-tight">{displayName}</h2>
                    {isLive && (
                      <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none text-white">Live</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <p className="text-[13px] text-slate-500">@{username}</p>
                    <span className="text-[10px] text-slate-700">·</span>
                    <span className={`text-[10px] ${presenceStatus === "online" ? "text-emerald-400" : presenceStatus === "idle" ? "text-yellow-400" : presenceStatus === "dnd" ? "text-red-400" : "text-slate-600"}`}>
                      {PRESENCE_LABEL[presenceStatus] || "Offline"}
                    </span>
                  </div>
                </div>
                {/* Level badge */}
                <div
                  className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold tabular-nums"
                  style={{ backgroundColor: accent + "18", color: accent, border: `1px solid ${accent}25` }}
                >
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path d="M10 1l2.39 6.26H19l-5.3 3.98L15.69 18 10 14.27 4.31 18l1.99-6.76L1 7.26h6.61z" /></svg>
                  {level}
                </div>
              </div>

              {/* Roles */}
              {userRoles.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {userRoles.map((role) => (
                    <span
                      key={role.id}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium leading-tight"
                      style={{ backgroundColor: (role.color || "#99AAB5") + "15", color: role.color || "#99AAB5", border: `1px solid ${(role.color || "#99AAB5")}20` }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: role.color || "#99AAB5" }} />
                      {role.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* ═══ Tabs ═══ */}
            <div className="shrink-0 flex border-b border-white/[0.06] px-5">
              {(["about", "activity", "connections"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`relative px-3 py-2 text-[12px] font-semibold capitalize tracking-wide transition-colors ${
                    tab === t ? "text-white" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {t}
                  {tab === t && (
                    <div className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full" style={{ backgroundColor: accent }} />
                  )}
                </button>
              ))}
            </div>

            {/* ═══ Tab Content — Scrollable ═══ */}
            <div className="flex-1 overflow-y-auto accent-scrollbar">
              <div className="p-5 space-y-5">

                {/* ── About Tab ── */}
                {tab === "about" && (
                  <>
                    {/* Stream preview */}
                    {isLive && streamStatus && (
                      <a
                        href={profile.twitchLogin ? `https://twitch.tv/${profile.twitchLogin}` : "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block overflow-hidden rounded-xl border border-red-500/20 bg-red-500/[0.04] transition-all hover:border-red-500/40 hover:shadow-lg hover:shadow-red-500/5"
                      >
                        {streamStatus.thumbnail && (
                          <div className="relative">
                            <img
                              src={streamStatus.thumbnail.replace("{width}", "560").replace("{height}", "315")}
                              alt=""
                              className="w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                            />
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600/90 shadow-lg backdrop-blur-sm">
                                <svg className="ml-0.5 h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                              </div>
                            </div>
                            {streamStatus.startedAt && (
                              <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white backdrop-blur-sm">
                                {formatUptime(streamStatus.startedAt)}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="px-3.5 py-2.5">
                          <p className="truncate text-[13px] font-medium text-slate-200">{streamStatus.title}</p>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                            {streamStatus.game && <span>{streamStatus.game}</span>}
                            {streamStatus.viewers !== undefined && (
                              <>
                                <span className="text-slate-700">·</span>
                                <span className="tabular-nums">{streamStatus.viewers.toLocaleString()} viewers</span>
                              </>
                            )}
                          </div>
                        </div>
                      </a>
                    )}

                    {/* Bio */}
                    {profile.bio && (
                      <div>
                        <SectionLabel>About Me</SectionLabel>
                        <p className="text-[13px] leading-relaxed text-slate-300 whitespace-pre-wrap">{profile.bio}</p>
                      </div>
                    )}

                    {/* Level + XP progress */}
                    <div>
                      <SectionLabel>Progression</SectionLabel>
                      {(() => {
                        const prog = getLevelProgress(level, totalXp);
                        return (
                          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: accent + "20", color: accent }}>
                                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M10 1l2.39 6.26H19l-5.3 3.98L15.69 18 10 14.27 4.31 18l1.99-6.76L1 7.26h6.61z" /></svg>
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-white leading-tight">Level {level}</p>
                                  <p className="text-[10px] text-slate-600">{totalXp.toLocaleString()} total XP</p>
                                </div>
                              </div>
                              <span className="text-[11px] font-semibold tabular-nums" style={{ color: accent }}>
                                {prog.percent}%
                              </span>
                            </div>
                            {/* Progress bar */}
                            <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                              <div
                                className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                                style={{ width: `${prog.percent}%`, backgroundColor: accent }}
                              />
                            </div>
                            <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-600">
                              <span>{prog.current.toLocaleString()} / {prog.needed.toLocaleString()} XP</span>
                              <span>→ Level {level + 1}</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Stats grid */}
                    <div>
                      <div className="grid grid-cols-3 gap-2">
                        <MiniStat
                          icon={<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>}
                          label="Servers"
                          value={String(currentUser?.id === userId ? myGuilds.length : sharedServers.length)}
                          sub={currentUser?.id !== userId ? "mutual" : undefined}
                        />
                        <MiniStat
                          icon={<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
                          label="Friends"
                          value={String(mutualFriendIds.length)}
                          sub={currentUser?.id !== userId ? "mutual" : undefined}
                        />
                        <MiniStat
                          icon={<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
                          label="Member"
                          value={formatDate(profile.createdAt).split(",")[0]}
                          sub={new Date(profile.createdAt).getFullYear().toString()}
                        />
                      </div>
                    </div>

                    {/* Badges */}
                    <div>
                      <SectionLabel>Badges</SectionLabel>
                      {badges.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {badges.map((badge) => (
                            <Tooltip key={badge.id} content={<div className="text-center"><p className="font-semibold text-sm">{badge.name}</p>{badge.description && <p className="text-[11px] text-slate-400 mt-0.5">{badge.description}</p>}</div>} side="top">
                              <span
                                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium text-slate-200 transition-all hover:scale-[1.03] hover:brightness-125"
                                style={{ backgroundColor: accent + "12", border: `1px solid ${accent}20` }}
                              >
                                <BadgeIcon iconUrl={badge.iconUrl} />
                                {badge.name}
                              </span>
                            </Tooltip>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[12px] text-slate-700">No badges yet</p>
                      )}
                    </div>

                    {/* Joined */}
                    <p className="text-[11px] text-slate-700">Nexe member since {formatDate(profile.createdAt)}</p>
                  </>
                )}

                {/* ── Activity Tab ── */}
                {tab === "activity" && (
                  <>
                    {/* Timeline */}
                    {activity.length > 0 ? (
                      <div>
                        <SectionLabel>Recent Activity</SectionLabel>
                        <div className="relative space-y-0">
                          {/* Vertical line */}
                          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-white/[0.06]" />
                          {activity.map((a, i) => {
                            const icon = ACTIVITY_ICONS[a.type] || { path: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z", color: "#64748b" };
                            return (
                              <div key={a.id} className="relative flex gap-3 py-1.5" style={{ animationDelay: `${i * 30}ms` }}>
                                <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: icon.color + "18" }}>
                                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke={icon.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                    <path d={icon.path} />
                                  </svg>
                                </div>
                                <div className="flex-1 min-w-0 pt-0.5">
                                  <p className="text-[12px] text-slate-300 leading-tight">{activityLabel(a.type, a.data)}</p>
                                  <p className="text-[10px] text-slate-600 mt-0.5">{timeAgo(a.createdAt)}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <p className="py-6 text-center text-[12px] text-slate-700">No recent activity</p>
                    )}

                    {/* Clips */}
                    {clips.length > 0 && (
                      <div>
                        <SectionLabel>Clips</SectionLabel>
                        <div className="grid grid-cols-2 gap-2">
                          {clips.slice(0, 6).map((clip, i) => (
                            <a
                              key={i}
                              href={clip.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group relative overflow-hidden rounded-lg bg-dark-900"
                            >
                              <img src={clip.thumbnail_url} alt={clip.title} className="aspect-video w-full object-cover transition-all duration-300 group-hover:scale-105 group-hover:brightness-110" loading="lazy" />
                              {/* Play overlay */}
                              <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
                                  <svg className="ml-0.5 h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                                </div>
                              </div>
                              {/* Info */}
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6">
                                <p className="truncate text-[10px] font-medium text-white">{clip.title}</p>
                              </div>
                              <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1 py-0.5 text-[9px] tabular-nums text-white/80 backdrop-blur-sm">
                                {clip.view_count.toLocaleString()}
                              </span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ── Connections Tab ── */}
                {tab === "connections" && (
                  <>
                    {/* Social links */}
                    {profile.socialLinks && profile.socialLinks.length > 0 && (
                      <div>
                        <SectionLabel>Links</SectionLabel>
                        <div className="space-y-1.5">
                          {profile.socialLinks.map((link, i) => (
                            <a
                              key={i}
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2.5 rounded-lg bg-white/[0.03] px-3 py-2 text-[12px] text-slate-300 transition-all hover:bg-white/[0.06] hover:text-white"
                            >
                              <PlatformIcon platform={link.platform} />
                              <span className="flex-1 capitalize">{link.platform}</span>
                              {link.verified && (
                                <svg className="h-3.5 w-3.5 text-nexe-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                              )}
                              <svg className="h-3 w-3 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Linked platforms */}
                    {profile.twitchLogin && (
                      <div>
                        <SectionLabel>Platforms</SectionLabel>
                        <a
                          href={`https://twitch.tv/${profile.twitchLogin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2.5 rounded-lg bg-[#9146ff]/[0.08] px-3 py-2 text-[12px] text-[#bf94ff] transition-all hover:bg-[#9146ff]/[0.15] border border-[#9146ff]/10"
                        >
                          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" /></svg>
                          <span className="flex-1">twitch.tv/{profile.twitchLogin}</span>
                          <svg className="h-3 w-3 text-[#9146ff]/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        </a>
                      </div>
                    )}

                    {/* Mutual Servers */}
                    {currentUser?.id !== userId && sharedServers.length > 0 && (
                      <div>
                        <SectionLabel>Mutual Servers — {sharedServers.length}</SectionLabel>
                        <div className="flex items-center gap-1">
                          {sharedServers.slice(0, 8).map((g) => (
                            <Tooltip key={g.id} content={g.name} side="top">
                              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04] text-xs font-semibold text-slate-300 transition-all hover:bg-white/[0.08] hover:scale-105">
                                {g.iconUrl ? (
                                  <img src={g.iconUrl} alt={g.name} className="h-9 w-9 rounded-xl object-cover" />
                                ) : (
                                  g.name.charAt(0).toUpperCase()
                                )}
                              </span>
                            </Tooltip>
                          ))}
                          {sharedServers.length > 8 && (
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04] text-[10px] font-semibold text-slate-500">
                              +{sharedServers.length - 8}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Mutual Friends */}
                    {currentUser?.id !== userId && mutualFriendIds.length > 0 && (
                      <div>
                        <SectionLabel>Mutual Friends — {mutualFriendIds.length}</SectionLabel>
                        <div className="flex items-center gap-1">
                          {mutualFriendIds.slice(0, 8).map((fid) => {
                            const fname = useGuildStore.getState().usernames[fid] || "User";
                            const favatar = useGuildStore.getState().avatarMap[fid];
                            return (
                              <Tooltip key={fid} content={fname} side="top">
                                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] text-xs font-semibold text-slate-300 transition-all hover:bg-white/[0.08] hover:scale-105">
                                  {favatar ? (
                                    <img src={favatar} alt={fname} className="h-9 w-9 rounded-full object-cover" />
                                  ) : (
                                    fname.charAt(0).toUpperCase()
                                  )}
                                </span>
                              </Tooltip>
                            );
                          })}
                          {mutualFriendIds.length > 8 && (
                            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] text-[10px] font-semibold text-slate-500">
                              +{mutualFriendIds.length - 8}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Empty state */}
                    {(!profile.socialLinks || profile.socialLinks.length === 0) && !profile.twitchLogin && sharedServers.length === 0 && mutualFriendIds.length === 0 && (
                      <p className="py-6 text-center text-[12px] text-slate-700">No connections to show</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-60 items-center justify-center text-sm text-red-400">Failed to load profile</div>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-600">{children}</h4>;
}

function MiniStat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2.5 text-center">
      <div className="mx-auto mb-1 flex h-6 w-6 items-center justify-center text-slate-500">{icon}</div>
      <p className="text-[13px] font-bold tabular-nums text-white leading-tight">{value}</p>
      {sub && <p className="text-[9px] text-slate-600">{sub}</p>}
      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-600">{label}</p>
    </div>
  );
}

function PlatformIcon({ platform }: { platform: string }) {
  const p = platform.toLowerCase();
  if (p.includes("twitch")) return <svg className="h-4 w-4 text-[#9146ff]" viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" /></svg>;
  if (p.includes("youtube")) return <svg className="h-4 w-4 text-red-500" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>;
  if (p.includes("github")) return <svg className="h-4 w-4 text-slate-300" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>;
  if (p.includes("twitter") || p.includes("x")) return <svg className="h-4 w-4 text-slate-300" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>;
  return <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>;
}
