import { query } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { UserActions } from "./actions-client";

export const dynamic = "force-dynamic";

interface UserDetail {
  id: string;
  username: string;
  email: string;
  email_verified: boolean;
  disabled: boolean;
  twitch_id: string | null;
  twitch_login: string | null;
  twitch_display_name: string | null;
  totp_enabled: boolean;
  status: string;
  locale: string;
  created_at: string;
  updated_at: string;
}

interface UserProfile {
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  level: number;
  total_xp: number;
}

interface UserGuild {
  guild_id: string;
  guild_name: string;
  is_owner: boolean;
  joined_at: string;
}

async function getUser(id: string) {
  const [user] = await query<UserDetail>(
    `SELECT id, username, email, email_verified, disabled, twitch_id, twitch_login,
            twitch_display_name, totp_enabled, status, locale, created_at, updated_at
     FROM users WHERE id = $1`,
    [id]
  );
  return user || null;
}

async function getUserProfile(userId: string) {
  const [profile] = await query<UserProfile>(
    `SELECT display_name, bio, avatar_url, banner_url, level, total_xp
     FROM profiles WHERE user_id = $1`,
    [userId]
  );
  return profile || null;
}

async function getUserGuilds(userId: string) {
  return query<UserGuild>(
    `SELECT g.id as guild_id, g.name as guild_name, g.owner_id = $1 as is_owner, gm.joined_at
     FROM guild_members gm
     JOIN guilds g ON g.id = gm.guild_id
     WHERE gm.user_id = $1
     ORDER BY gm.joined_at DESC`,
    [userId]
  );
}

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getUser(id);

  if (!user) {
    notFound();
  }

  const [profile, guilds] = await Promise.all([
    getUserProfile(id),
    getUserGuilds(id),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/admin/users"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-400 transition-colors hover:bg-dark-800 hover:text-white"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">{user.username}</h1>
          <p className="text-sm text-slate-500">{user.id}</p>
        </div>
        {user.disabled && (
          <span className="rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400">
            Globally Banned
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* User Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Account Details */}
          <div className="rounded-xl border border-slate-800 bg-dark-800 p-5">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-slate-500">Account</h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">Username</dt>
                <dd className="text-sm text-white">{user.username}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Email</dt>
                <dd className="flex items-center gap-2 text-sm text-white">
                  {user.email}
                  {user.email_verified && (
                    <span className="text-green-400">
                      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">2FA</dt>
                <dd className="text-sm text-white">{user.totp_enabled ? "Enabled" : "Disabled"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Status</dt>
                <dd className="text-sm text-white capitalize">{user.status}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Joined</dt>
                <dd className="text-sm text-white">
                  {new Date(user.created_at).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Last Updated</dt>
                <dd className="text-sm text-white">
                  {new Date(user.updated_at).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </dd>
              </div>
            </dl>
          </div>

          {/* Twitch */}
          {user.twitch_login && (
            <div className="rounded-xl border border-slate-800 bg-dark-800 p-5">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-purple-400">Twitch</h2>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-500">Login</dt>
                  <dd className="text-sm text-purple-300">{user.twitch_login}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Display Name</dt>
                  <dd className="text-sm text-white">{user.twitch_display_name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Twitch ID</dt>
                  <dd className="text-sm text-slate-400">{user.twitch_id}</dd>
                </div>
              </dl>
            </div>
          )}

          {/* Profile */}
          {profile && (
            <div className="rounded-xl border border-slate-800 bg-dark-800 p-5">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-slate-500">Profile</h2>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-500">Display Name</dt>
                  <dd className="text-sm text-white">{profile.display_name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Level</dt>
                  <dd className="text-sm text-white">{profile.level} ({profile.total_xp.toLocaleString()} XP)</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-500">Bio</dt>
                  <dd className="text-sm text-slate-300">{profile.bio || "—"}</dd>
                </div>
              </dl>
            </div>
          )}

          {/* Guilds */}
          <div className="rounded-xl border border-slate-800 bg-dark-800 p-5">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-slate-500">
              Servers ({guilds.length})
            </h2>
            {guilds.length > 0 ? (
              <div className="space-y-2">
                {guilds.map((g) => (
                  <div
                    key={g.guild_id}
                    className="flex items-center justify-between rounded-lg bg-dark-900 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{g.guild_name}</span>
                      {g.is_owner && (
                        <span className="rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400">
                          Owner
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">
                      {new Date(g.joined_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Not in any servers</p>
            )}
          </div>
        </div>

        {/* Actions Sidebar */}
        <div>
          <UserActions userId={user.id} username={user.username} disabled={user.disabled} />
        </div>
      </div>
    </div>
  );
}
