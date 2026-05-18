import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getStats() {
  const [users] = await query<{ count: string }>("SELECT COUNT(*) as count FROM users");
  const [guilds] = await query<{ count: string }>("SELECT COUNT(*) as count FROM guilds");
  const [messages] = await query<{ count: string }>("SELECT COUNT(*) as count FROM messages WHERE deleted = false");
  const [channels] = await query<{ count: string }>("SELECT COUNT(*) as count FROM channels");
  const [onlineToday] = await query<{ count: string }>(
    "SELECT COUNT(DISTINCT user_id) as count FROM sessions WHERE created_at > NOW() - INTERVAL '24 hours'"
  );
  const [dmMessages] = await query<{ count: string }>("SELECT COUNT(*) as count FROM dm_messages WHERE deleted = false");

  return {
    users: parseInt(users?.count || "0"),
    guilds: parseInt(guilds?.count || "0"),
    messages: parseInt(messages?.count || "0"),
    channels: parseInt(channels?.count || "0"),
    activeToday: parseInt(onlineToday?.count || "0"),
    dmMessages: parseInt(dmMessages?.count || "0"),
  };
}

async function getRecentUsers() {
  return query<{ id: string; username: string; email: string; created_at: string; email_verified: boolean }>(
    "SELECT id, username, email, created_at, email_verified FROM users ORDER BY created_at DESC LIMIT 10"
  );
}

async function checkServices() {
  const services = [
    { name: "Gateway", port: 8090, url: "http://localhost:8090/health" },
    { name: "Guilds", port: 8082, url: "http://localhost:8082/health" },
    { name: "Messaging", port: 8083, url: "http://localhost:8083/health" },
    { name: "Presence", port: 8084, url: "http://localhost:8084/health" },
    { name: "Voice", port: 8085, url: "http://localhost:8085/health" },
    { name: "Notifications", port: 8086, url: "http://localhost:8086/health" },
    { name: "LiveKit", port: 7880, url: "http://localhost:7880" },
  ];

  const results = await Promise.all(
    services.map(async (svc) => {
      try {
        const res = await fetch(svc.url, { signal: AbortSignal.timeout(3000) });
        return { ...svc, status: res.ok ? ("online" as const) : ("error" as const), code: res.status };
      } catch {
        return { ...svc, status: "offline" as const, code: 0 };
      }
    })
  );
  return results;
}

function StatCard({ label, value, icon, accent }: { label: string; value: number; icon: React.ReactNode; accent: string }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-[#12141a] p-5 transition-colors hover:border-white/[0.1]">
      <div className={`absolute -right-3 -top-3 h-16 w-16 rounded-full opacity-[0.04] ${accent}`} />
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${accent} bg-opacity-10`}>
        {icon}
      </div>
      <p className="text-2xl font-bold tracking-tight text-white">{value.toLocaleString()}</p>
      <p className="mt-0.5 text-xs font-medium text-slate-500">{label}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const [stats, recentUsers, services] = await Promise.all([
    getStats(),
    getRecentUsers(),
    checkServices(),
  ]);

  const onlineCount = services.filter((s) => s.status === "online").length;

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Platform overview and service health</p>
      </div>

      {/* Stats Grid */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Total Users" value={stats.users} accent="bg-nexe-500 text-nexe-400" icon={
          <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
        } />
        <StatCard label="Servers" value={stats.guilds} accent="bg-violet-500 text-violet-400" icon={
          <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0h.008v.008h-.008V7.5z" />
          </svg>
        } />
        <StatCard label="Guild Messages" value={stats.messages} accent="bg-sky-500 text-sky-400" icon={
          <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
        } />
        <StatCard label="DM Messages" value={stats.dmMessages} accent="bg-pink-500 text-pink-400" icon={
          <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        } />
        <StatCard label="Channels" value={stats.channels} accent="bg-amber-500 text-amber-400" icon={
          <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5l-3.9 19.5m-2.1-19.5l-3.9 19.5" />
          </svg>
        } />
        <StatCard label="Active Today" value={stats.activeToday} accent="bg-emerald-500 text-emerald-400" icon={
          <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
        } />
      </div>

      {/* Services Status */}
      <div className="mb-8">
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-base font-semibold text-white">Services</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            onlineCount === services.length
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
          }`}>
            {onlineCount}/{services.length} online
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((svc) => (
            <div
              key={svc.name}
              className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-[#12141a] px-4 py-3.5 transition-colors hover:border-white/[0.1]"
            >
              <div className="relative">
                <div
                  className={`h-2.5 w-2.5 rounded-full ${
                    svc.status === "online"
                      ? "bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/40"
                      : svc.status === "error"
                      ? "bg-amber-500 shadow-[0_0_8px] shadow-amber-500/40"
                      : "bg-red-500 shadow-[0_0_8px] shadow-red-500/40"
                  }`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">{svc.name}</p>
                <p className="text-[11px] text-slate-500">
                  :{svc.port} &middot; {svc.status === "online" ? "Running" : svc.status === "error" ? `Error ${svc.code}` : "Offline"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Users */}
      <div>
        <h2 className="mb-4 text-base font-semibold text-white">Recent Users</h2>
        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#12141a]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Username</th>
                <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Email</th>
                <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Verified</th>
                <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Joined</th>
              </tr>
            </thead>
            <tbody>
              {recentUsers.map((user, i) => (
                <tr
                  key={user.id}
                  className={i < recentUsers.length - 1 ? "border-b border-white/[0.04]" : ""}
                >
                  <td className="px-5 py-3 text-sm font-medium text-white">{user.username}</td>
                  <td className="px-5 py-3 text-sm text-slate-400">{user.email}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      user.email_verified
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-red-500/10 text-red-400"
                    }`}>
                      <span className={`h-1 w-1 rounded-full ${user.email_verified ? "bg-emerald-400" : "bg-red-400"}`} />
                      {user.email_verified ? "Verified" : "Pending"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm text-slate-500">
                    {new Date(user.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
