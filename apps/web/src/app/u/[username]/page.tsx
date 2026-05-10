import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import { query } from "@/lib/db";

interface UserProfile {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  accent_color: string | null;
  level: number;
  total_xp: number;
  social_links: { platform: string; url: string }[] | null;
  created_at: string;
}

async function getProfile(username: string): Promise<UserProfile | null> {
  const rows = await query<UserProfile>(
    `SELECT u.id, u.username, u.created_at,
            p.display_name, p.bio, p.avatar_url, p.banner_url,
            p.accent_color, p.level, p.total_xp, p.social_links
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE LOWER(u.username) = LOWER($1)
       AND u.disabled = false`,
    [username]
  );
  return rows[0] ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const profile = await getProfile(username);

  if (!profile) {
    return { title: "Profile Not Found — Nexe" };
  }

  const name = profile.display_name || profile.username;
  return {
    title: `${name} (@${profile.username}) — Nexe`,
    description: profile.bio || `${name}'s profile on Nexe`,
  };
}

function getInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function xpForNextLevel(level: number): number {
  return level * 1000;
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await getProfile(username);

  if (!profile) {
    return (
      <>
        <Navbar />
        <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-dark-950 via-dark-900 to-dark-950 px-6 pt-16">
          <div className="text-center">
            <div className="mb-6 flex h-20 w-20 mx-auto items-center justify-center rounded-full border-2 border-slate-700 bg-dark-800">
              <svg
                className="h-8 w-8 text-slate-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                />
              </svg>
            </div>
            <h1 className="mb-2 text-2xl font-bold text-white">
              Profile Not Found
            </h1>
            <p className="mb-8 text-slate-400">
              The user <span className="font-medium text-white">@{username}</span> doesn&apos;t exist or their profile is private.
            </p>
            <Link
              href="/"
              className="inline-flex h-10 items-center rounded-lg bg-nexe-600 px-6 text-sm font-medium text-white transition-all hover:bg-nexe-700"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </>
    );
  }

  const displayName = profile.display_name || profile.username;
  const accentColor = profile.accent_color || "#4f46e5";
  const level = profile.level ?? 1;
  const totalXp = profile.total_xp ?? 0;
  const xpNeeded = xpForNextLevel(level);
  const xpInLevel = totalXp % xpNeeded;
  const xpProgress = Math.min((xpInLevel / xpNeeded) * 100, 100);
  const socialLinks: { platform: string; url: string }[] =
    Array.isArray(profile.social_links) ? profile.social_links : [];

  return (
    <>
      <Navbar />

      <div className="min-h-screen bg-gradient-to-b from-dark-950 via-dark-900 to-dark-950 px-6 pt-24 pb-24">
        <div className="mx-auto max-w-2xl">
          {/* Profile card */}
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-dark-800">
            {/* Banner */}
            <div
              className="relative h-36 sm:h-44"
              style={{
                background: profile.banner_url
                  ? `url(${profile.banner_url}) center/cover`
                  : `linear-gradient(135deg, ${accentColor}33 0%, ${accentColor}11 50%, transparent 100%)`,
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-dark-800 via-transparent to-transparent" />
            </div>

            {/* Avatar + info */}
            <div className="relative px-6 pb-6">
              {/* Avatar */}
              <div className="-mt-14 mb-4 flex items-end gap-4">
                <div
                  className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-4 border-dark-800 text-3xl font-bold text-white"
                  style={{
                    backgroundColor: profile.avatar_url ? "transparent" : accentColor,
                    backgroundImage: profile.avatar_url
                      ? `url(${profile.avatar_url})`
                      : undefined,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                >
                  {!profile.avatar_url && getInitial(displayName)}
                </div>

                {/* Level badge */}
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-white"
                    style={{ backgroundColor: accentColor }}
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                      />
                    </svg>
                    Level {level}
                  </span>
                </div>
              </div>

              {/* Name */}
              <h1 className="text-2xl font-bold text-white">{displayName}</h1>
              <p className="mb-4 text-sm text-slate-400">@{profile.username}</p>

              {/* Bio */}
              {profile.bio && (
                <p className="mb-5 text-sm leading-relaxed text-slate-300">
                  {profile.bio}
                </p>
              )}

              {/* XP bar */}
              <div className="mb-5">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-slate-400">XP Progress</span>
                  <span className="text-slate-500">
                    {xpInLevel.toLocaleString()} / {xpNeeded.toLocaleString()} XP
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-dark-900">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${xpProgress}%`,
                      backgroundColor: accentColor,
                    }}
                  />
                </div>
              </div>

              {/* Meta info */}
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
                    />
                  </svg>
                  Member since {formatDate(profile.created_at)}
                </span>
                <span className="flex items-center gap-1.5">
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
                    />
                  </svg>
                  {totalXp.toLocaleString()} total XP
                </span>
              </div>

              {/* Social links */}
              {socialLinks.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {socialLinks.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-dark-900 px-3 py-1.5 text-xs text-slate-300 transition-all hover:border-slate-600 hover:text-white"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
                        />
                      </svg>
                      {link.platform}
                    </a>
                  ))}
                </div>
              )}

              {/* Open in Nexe */}
              <div className="mt-6 border-t border-slate-700/50 pt-5">
                <a
                  href={`nexe://user/${profile.username}`}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-nexe-600 px-5 text-sm font-medium text-white transition-all hover:bg-nexe-700 hover:shadow-lg hover:shadow-nexe-600/25"
                >
                  <div className="flex h-4 w-4 items-center justify-center rounded bg-white/20 text-[8px] font-bold">
                    N
                  </div>
                  Open in Nexe
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-dark-950 px-6 py-12">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-nexe-600 text-xs font-bold text-white">
              N
            </div>
            <span className="text-sm font-medium text-slate-400">Nexe</span>
          </div>
          <p className="text-sm text-slate-600">
            &copy; 2026 Nexe. All rights reserved.
          </p>
        </div>
      </footer>
    </>
  );
}
