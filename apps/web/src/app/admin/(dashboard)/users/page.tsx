import { query } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface User {
  id: string;
  username: string;
  email: string;
  email_verified: boolean;
  disabled: boolean;
  twitch_login: string | null;
  created_at: string;
  guild_count: string;
}

async function getUsers(search?: string, page = 1) {
  const limit = 20;
  const offset = (page - 1) * limit;

  let whereClause = "";
  const params: (string | number)[] = [];

  if (search) {
    whereClause = "WHERE u.username ILIKE $1 OR u.email ILIKE $1";
    params.push(`%${search}%`);
  }

  const countQuery = `SELECT COUNT(*) as count FROM users u ${whereClause}`;
  const [countResult] = await query<{ count: string }>(countQuery, params);
  const total = parseInt(countResult?.count || "0");

  const dataParams = [...params, limit, offset];
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  const users = await query<User>(
    `SELECT u.id, u.username, u.email, u.email_verified, u.disabled, u.twitch_login, u.created_at,
            (SELECT COUNT(*) FROM guild_members gm WHERE gm.user_id = u.id)::text as guild_count
     FROM users u
     ${whereClause}
     ORDER BY u.created_at DESC
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    dataParams
  );

  return { users, total, page, totalPages: Math.ceil(total / limit) };
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const search = params.q || "";
  const page = parseInt(params.page || "1");
  const { users, total, totalPages } = await getUsers(search || undefined, page);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">User Management</h1>
          <p className="text-sm text-slate-500">{total} total users</p>
        </div>
      </div>

      {/* Search */}
      <form method="GET" className="mb-6">
        <div className="flex gap-3">
          <input
            type="text"
            name="q"
            defaultValue={search}
            placeholder="Search by username or email..."
            className="flex-1 rounded-lg border border-slate-700 bg-dark-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-nexe-500"
          />
          <button
            type="submit"
            className="rounded-lg bg-nexe-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-nexe-700"
          >
            Search
          </button>
          {search && (
            <Link
              href="/admin/users"
              className="flex items-center rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-400 transition-colors hover:bg-dark-800 hover:text-white"
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      {/* Users Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-dark-800">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                User
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Email
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Twitch
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Servers
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Joined
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                className="border-b border-slate-800/50 last:border-0"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      {user.username}
                    </span>
                    {user.disabled && (
                      <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-red-400">
                        Banned
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-400">
                  <div className="flex items-center gap-2">
                    {user.email}
                    {user.email_verified ? (
                      <span className="text-green-400" title="Verified">
                        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </span>
                    ) : (
                      <span className="text-slate-600" title="Not verified">
                        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      user.disabled
                        ? "bg-red-500/10 text-red-400"
                        : "bg-green-500/10 text-green-400"
                    }`}
                  >
                    {user.disabled ? "Disabled" : "Active"}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-400">
                  {user.twitch_login ? (
                    <span className="inline-flex items-center gap-1 text-purple-400">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
                      </svg>
                      {user.twitch_login}
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-slate-400">
                  {user.guild_count}
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">
                  {new Date(user.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/users/${user.id}`}
                    className="rounded-md bg-slate-700/50 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
                  >
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/admin/users?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(page - 1) })}`}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-400 transition-colors hover:bg-dark-800 hover:text-white"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/admin/users?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(page + 1) })}`}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-400 transition-colors hover:bg-dark-800 hover:text-white"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
