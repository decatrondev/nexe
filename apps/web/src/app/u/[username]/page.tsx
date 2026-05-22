import type { Metadata } from "next";
import Link from "next/link";
import { query } from "@/lib/db";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface UserProfile {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  accent_color: string | null;
  background_url: string | null;
  level: number;
  total_xp: number;
  social_links: { platform: string; url: string; verified?: boolean }[] | null;
  featured_clips: { title: string; url: string; thumbnail_url: string; view_count?: number }[] | null;
  stream_schedule: Record<string, unknown> | null;
  created_at: string;
  twitch_id: string | null;
  twitch_login: string | null;
}

interface Badge {
  id: string;
  name: string;
  description: string | null;
  icon_url: string;
  type: string;
  displayed: boolean;
  display_order: number;
}

interface Activity {
  id: string;
  type: string;
  data: Record<string, unknown>;
  created_at: string;
}

/* ═══════════════════════════════════════════════════════════════
   Data fetching
   ═══════════════════════════════════════════════════════════════ */

async function getProfile(username: string): Promise<UserProfile | null> {
  const rows = await query<UserProfile>(
    `SELECT u.id, u.username, u.created_at, u.twitch_id, u.twitch_login,
            p.display_name, p.bio, p.avatar_url, p.banner_url,
            p.accent_color, p.background_url, p.level, p.total_xp, p.social_links,
            p.featured_clips, p.stream_schedule
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE LOWER(u.username) = LOWER($1)
       AND u.disabled = false`,
    [username]
  );
  return rows[0] ?? null;
}

async function getBadges(userId: string): Promise<Badge[]> {
  return query<Badge>(
    `SELECT b.id, b.name, b.description, b.icon_url, b.type,
            ub.displayed, ub.display_order
     FROM user_badges ub
     JOIN badges b ON b.id = ub.badge_id
     WHERE ub.user_id = $1 AND ub.displayed = true
     ORDER BY ub.display_order`,
    [userId]
  );
}

async function getActivity(userId: string): Promise<Activity[]> {
  return query<Activity>(
    `SELECT id, type, data, created_at
     FROM profile_activity
     WHERE user_id = $1 AND public = true
     ORDER BY created_at DESC LIMIT 8`,
    [userId]
  );
}

async function getServerCount(userId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM guild_members WHERE user_id = $1`,
    [userId]
  );
  return parseInt(rows[0]?.count ?? "0", 10);
}

/* ═══════════════════════════════════════════════════════════════
   XP formula — must match backend: 100 * n^1.8
   ═══════════════════════════════════════════════════════════════ */

function xpForLevel(n: number): number {
  if (n < 1) return 0;
  return Math.floor(100 * Math.pow(n, 1.8));
}

function getLevelProgress(level: number, totalXp: number) {
  let accumulated = 0;
  for (let i = 1; i < level; i++) accumulated += xpForLevel(i);
  const xpIntoLevel = totalXp - accumulated;
  const needed = xpForLevel(level);
  const percent = needed > 0 ? Math.min(Math.round((xpIntoLevel / needed) * 100), 100) : 0;
  return { current: Math.max(xpIntoLevel, 0), needed, percent };
}

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

function activityLabel(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case "level_up": return `Reached level ${data.level ?? "?"}`;
    case "badge_earned": return `Earned "${data.name ?? "?"}"`;
    case "server_joined": return `Joined ${data.guildName ?? "a server"}`;
    case "message_milestone": return `${(data.count as number)?.toLocaleString() ?? "?"} messages sent`;
    default: return type.replace(/_/g, " ");
  }
}

const ACTIVITY_COLORS: Record<string, string> = {
  level_up: "#34d399",
  badge_earned: "#fbbf24",
  server_joined: "#60a5fa",
  message_milestone: "#a78bfa",
};

/* ═══════════════════════════════════════════════════════════════
   Platform icons
   ═══════════════════════════════════════════════════════════════ */

function PlatformIcon({ platform, className = "h-4 w-4" }: { platform: string; className?: string }) {
  const p = platform.toLowerCase();
  if (p.includes("twitch")) return <svg className={`${className} text-[#9146ff]`} viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" /></svg>;
  if (p.includes("youtube")) return <svg className={`${className} text-[#ff0000]`} viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>;
  if (p.includes("github")) return <svg className={`${className} text-white`} viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>;
  if (p.includes("twitter") || p.includes("x")) return <svg className={`${className} text-white`} viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>;
  if (p.includes("kick")) return <svg className={`${className} text-[#53fc18]`} viewBox="0 0 24 24" fill="currentColor"><path d="M1.333 0v24h5.334v-8l2.666 2.667L14.667 24h6.666L14 16l7.333-8H14.5L9.333 13.5V0z" /></svg>;
  if (p.includes("instagram")) return <svg className={`${className} text-[#e4405f]`} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" /></svg>;
  return <svg className={`${className} text-slate-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>;
}

/* Badge icon */
const BADGE_PATHS: Record<string, string> = {
  early_adopter: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  streamer: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z",
  developer: "M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z",
};

function BadgeIconSvg({ iconUrl }: { iconUrl: string }) {
  const path = BADGE_PATHS[iconUrl];
  if (path) return <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d={path} /></svg>;
  if (iconUrl.startsWith("http")) return <img src={iconUrl} alt="" className="h-5 w-5 shrink-0 rounded" />;
  return <svg className="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path d="M10 1l2.39 6.26H19l-5.3 3.98L15.69 18 10 14.27 4.31 18l1.99-6.76L1 7.26h6.61z" /></svg>;
}

/* ═══════════════════════════════════════════════════════════════
   SEO Metadata
   ═══════════════════════════════════════════════════════════════ */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const profile = await getProfile(username);

  if (!profile) return { title: "Profile Not Found — Nexe" };

  const name = profile.display_name || profile.username;
  const description = profile.bio
    ? `${profile.bio.slice(0, 150)}${profile.bio.length > 150 ? "..." : ""}`
    : `Level ${profile.level ?? 1} · ${name}'s profile on Nexe`;
  const profileUrl = `https://nexe.decatron.net/u/${profile.username}`;

  return {
    title: `${name} (@${profile.username}) — Nexe`,
    description,
    openGraph: {
      title: `${name} (@${profile.username})`,
      description,
      url: profileUrl,
      siteName: "Nexe",
      type: "profile",
      ...(profile.avatar_url && {
        images: [{ url: profile.avatar_url, width: 256, height: 256, alt: `${name}'s avatar` }],
      }),
    },
    twitter: {
      card: "summary",
      title: `${name} — Nexe`,
      description,
      ...(profile.avatar_url && { images: [profile.avatar_url] }),
    },
  };
}

/* ═══════════════════════════════════════════════════════════════
   Page Component
   ═══════════════════════════════════════════════════════════════ */

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await getProfile(username);

  if (!profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-dark-950 px-6">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.02]">
            <svg className="h-8 w-8 text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <h1 className="mb-2 text-2xl font-bold text-white">Profile Not Found</h1>
          <p className="mb-8 text-slate-500">
            <span className="font-medium text-slate-300">@{username}</span> doesn&apos;t exist or is private.
          </p>
          <Link href="/" className="inline-flex h-10 items-center rounded-xl bg-nexe-600 px-6 text-sm font-semibold text-white transition-all hover:bg-nexe-700">
            Back to Nexe
          </Link>
        </div>
      </div>
    );
  }

  // Parallel data fetching
  const [badges, activity, serverCount] = await Promise.all([
    getBadges(profile.id),
    getActivity(profile.id),
    getServerCount(profile.id),
  ]);

  const displayName = profile.display_name || profile.username;
  const accent = profile.accent_color || "#6366f1";
  const level = profile.level ?? 1;
  const totalXp = profile.total_xp ?? 0;
  const prog = getLevelProgress(level, totalXp);
  const socialLinks = Array.isArray(profile.social_links) ? profile.social_links : [];
  const featuredClips = Array.isArray(profile.featured_clips) ? profile.featured_clips : [];

  return (
    <div className="min-h-screen bg-dark-950" style={profile.background_url ? {
      backgroundImage: profile.background_url.startsWith("http") ? `url(${profile.background_url})` : profile.background_url,
      backgroundSize: profile.background_url.startsWith("http") ? "cover" : undefined,
      backgroundPosition: profile.background_url.startsWith("http") ? "center" : undefined,
      backgroundAttachment: profile.background_url.startsWith("http") ? "fixed" : undefined,
    } : undefined}>
      {/* ═══ Cinematic Banner ═══ */}
      <div className="relative">
        {profile.banner_url && (profile.banner_url.endsWith(".mp4") || profile.banner_url.includes("video")) ? (
          <div className="h-52 sm:h-64 lg:h-72">
            <video src={profile.banner_url} className="h-full w-full object-cover" autoPlay loop muted playsInline />
          </div>
        ) : profile.banner_url ? (
          <div className="h-52 sm:h-64 lg:h-72">
            <img src={profile.banner_url} alt="" className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="h-52 sm:h-64 lg:h-72" style={{ background: `linear-gradient(160deg, ${accent}22 0%, ${accent}08 40%, transparent 70%), linear-gradient(220deg, ${accent}15 0%, transparent 50%)` }} />
        )}
        {/* Multi-layer fade */}
        <div className="absolute inset-0 bg-gradient-to-t from-dark-950 via-dark-950/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-dark-950 to-transparent" />

        {/* Ambient glow */}
        <div className="pointer-events-none absolute inset-x-0 -bottom-20 h-40 opacity-30" style={{ background: `radial-gradient(ellipse at center, ${accent}20, transparent 70%)` }} />
      </div>

      {/* ═══ Profile Content ═══ */}
      <div className="relative mx-auto max-w-3xl px-5 sm:px-8">
        {/* ── Identity Section ── */}
        <div className="-mt-20 sm:-mt-24 mb-10">
          <div className="flex flex-col sm:flex-row sm:items-end sm:gap-6">
            {/* Avatar */}
            <div className="relative shrink-0 mb-4 sm:mb-0">
              <div className="rounded-2xl p-[3px]" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}44)` }}>
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt={displayName} className="h-28 w-28 sm:h-32 sm:w-32 rounded-2xl object-cover" style={{ border: "3px solid var(--color-dark-950)" }} />
                ) : (
                  <div className="flex h-28 w-28 sm:h-32 sm:w-32 items-center justify-center rounded-2xl text-4xl font-bold text-white" style={{ backgroundColor: accent, border: "3px solid var(--color-dark-950)" }}>
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
            </div>

            {/* Name + meta */}
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex flex-wrap items-center gap-3 mb-1">
                <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{displayName}</h1>
                <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold tabular-nums" style={{ backgroundColor: accent + "20", color: accent, border: `1px solid ${accent}30` }}>
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path d="M10 1l2.39 6.26H19l-5.3 3.98L15.69 18 10 14.27 4.31 18l1.99-6.76L1 7.26h6.61z" /></svg>
                  Level {level}
                </span>
              </div>
              <p className="text-sm text-slate-500 mb-3">@{profile.username}</p>

              {/* Platform links inline */}
              <div className="flex flex-wrap items-center gap-2">
                {profile.twitch_login && (
                  <a href={`https://twitch.tv/${profile.twitch_login}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[#9146ff]/10 px-2.5 py-1 text-[11px] font-semibold text-[#bf94ff] border border-[#9146ff]/15 transition-all hover:bg-[#9146ff]/20 hover:border-[#9146ff]/30">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" /></svg>
                    {profile.twitch_login}
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Main Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-10">

          {/* Left column (2/3) */}
          <div className="lg:col-span-2 space-y-5">

            {/* Bio */}
            {profile.bio && (
              <section className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-5">
                <SectionTitle>About</SectionTitle>
                <p className="text-[14px] leading-relaxed text-slate-300 whitespace-pre-wrap">{profile.bio}</p>
              </section>
            )}

            {/* Progression */}
            <section className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-5">
              <SectionTitle>Progression</SectionTitle>
              <div className="flex items-center gap-4 mb-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: accent + "18", color: accent }}>
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 1l2.39 6.26H19l-5.3 3.98L15.69 18 10 14.27 4.31 18l1.99-6.76L1 7.26h6.61z" /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-bold text-white">Level {level}</p>
                    <span className="text-xs font-semibold tabular-nums" style={{ color: accent }}>{prog.percent}%</span>
                  </div>
                  <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${prog.percent}%`, backgroundColor: accent }} />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
                    <span className="tabular-nums">{prog.current.toLocaleString()} / {prog.needed.toLocaleString()} XP</span>
                    <span>Level {level + 1}</span>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-700 tabular-nums">{totalXp.toLocaleString()} total XP earned</p>
            </section>

            {/* Featured Clips */}
            {featuredClips.length > 0 && (
              <section className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-5">
                <SectionTitle>Clips</SectionTitle>
                <div className="grid grid-cols-2 gap-2">
                  {featuredClips.slice(0, 6).map((clip, i) => (
                    <a key={i} href={clip.url} target="_blank" rel="noopener noreferrer" className="group relative overflow-hidden rounded-xl bg-dark-900">
                      <img src={clip.thumbnail_url} alt={clip.title} className="aspect-video w-full object-cover transition-all duration-300 group-hover:scale-105 group-hover:brightness-110" loading="lazy" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm">
                          <svg className="ml-0.5 h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                        </div>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-8">
                        <p className="truncate text-[11px] font-medium text-white">{clip.title}</p>
                      </div>
                      {clip.view_count !== undefined && (
                        <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] tabular-nums text-white/80 backdrop-blur-sm">
                          {clip.view_count.toLocaleString()}
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* Activity */}
            {activity.length > 0 && (
              <section className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-5">
                <SectionTitle>Recent Activity</SectionTitle>
                <div className="relative space-y-0">
                  <div className="absolute left-[11px] top-2 bottom-2 w-px bg-white/[0.05]" />
                  {activity.map((a) => {
                    const dotColor = ACTIVITY_COLORS[a.type] || "#64748b";
                    return (
                      <div key={a.id} className="relative flex gap-3 py-2">
                        <div className="relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: dotColor + "18" }}>
                          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: dotColor }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] text-slate-300">{activityLabel(a.type, a.data)}</p>
                          <p className="text-[11px] text-slate-600">{timeAgo(a.created_at)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          {/* Right column (1/3) — sidebar */}
          <div className="space-y-5">

            {/* Stats */}
            <section className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-5">
              <SectionTitle>Stats</SectionTitle>
              <div className="space-y-3">
                <StatRow icon={<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>} label="Servers" value={String(serverCount)} />
                <StatRow icon={<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>} label="Member since" value={formatDate(profile.created_at)} />
                <StatRow icon={<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>} label="Total XP" value={totalXp.toLocaleString()} />
              </div>
            </section>

            {/* Badges */}
            {badges.length > 0 && (
              <section className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-5">
                <SectionTitle>Badges</SectionTitle>
                <div className="grid grid-cols-2 gap-2">
                  {badges.map((badge) => (
                    <div key={badge.id} className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.06]" title={badge.description || badge.name} style={{ border: `1px solid ${accent}15` }}>
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: accent + "15", color: accent }}>
                        <BadgeIconSvg iconUrl={badge.icon_url} />
                      </div>
                      <span className="truncate text-[11px] font-medium text-slate-300">{badge.name}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Social Links */}
            {socialLinks.length > 0 && (
              <section className="rounded-2xl border border-white/[0.05] bg-white/[0.015] p-5">
                <SectionTitle>Links</SectionTitle>
                <div className="space-y-1.5">
                  {socialLinks.map((link, i) => (
                    <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 rounded-xl bg-white/[0.02] px-3 py-2.5 text-[12px] text-slate-300 transition-all hover:bg-white/[0.06] hover:text-white border border-white/[0.03]">
                      <PlatformIcon platform={link.platform} className="h-4 w-4 shrink-0" />
                      <span className="flex-1 capitalize truncate">{link.platform}</span>
                      {link.verified && (
                        <svg className="h-3.5 w-3.5 shrink-0 text-nexe-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      )}
                      <svg className="h-3 w-3 shrink-0 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* Open in Nexe */}
            <a href={`nexe://user/${profile.username}`} className="flex items-center justify-center gap-2.5 rounded-2xl border border-nexe-600/20 bg-nexe-600/8 px-5 py-3.5 text-sm font-semibold text-nexe-400 transition-all hover:bg-nexe-600/15 hover:border-nexe-600/30 hover:text-white">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M14 10l6.1-6.1M9 21H3v-6M10 14l-6.1 6.1" /></svg>
              Open in Nexe
            </a>
          </div>
        </div>
      </div>

      {/* ═══ Footer ═══ */}
      <footer className="border-t border-white/[0.04] py-10">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-4 px-5 sm:flex-row sm:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-nexe-600 text-[10px] font-bold text-white">N</div>
            <span className="text-sm font-medium text-slate-500">Nexe</span>
          </div>
          <p className="text-[12px] text-slate-700">&copy; {new Date().getFullYear()} Nexe. Communication for streamers.</p>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════════════ */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-600">{children}</h2>;
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-slate-500">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-white tabular-nums">{value}</p>
        <p className="text-[10px] text-slate-600">{label}</p>
      </div>
    </div>
  );
}
