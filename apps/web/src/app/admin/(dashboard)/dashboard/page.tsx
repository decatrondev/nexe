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

  return {
    users: parseInt(users?.count || "0"),
    guilds: parseInt(guilds?.count || "0"),
    messages: parseInt(messages?.count || "0"),
    channels: parseInt(channels?.count || "0"),
    activeToday: parseInt(onlineToday?.count || "0"),
  };
}

async function getRecentUsers() {
  return query<{ id: string; username: string; email: string; created_at: string; email_verified: boolean }>(
    "SELECT id, username, email, created_at, email_verified FROM users ORDER BY created_at DESC LIMIT 10"
  );
}

async function checkServices() {
  const services = [
    { name: "Gateway", url: "http://localhost:8090/health" },
    { name: "Guilds", url: "http://localhost:8082/health" },
    { name: "Messaging", url: "http://localhost:8083/health" },
    { name: "Presence", url: "http://localhost:8084/health" },
    { name: "Voice", url: "http://localhost:8085/health" },
    { name: "Notifications", url: "http://localhost:8086/health" },
    { name: "LiveKit", url: "http://localhost:7880" },
  ];

  const results = await Promise.all(
    services.map(async (svc) => {
      try {
        const res = await fetch(svc.url, { signal: AbortSignal.timeout(3000) });
        return { ...svc, status: res.ok ? "online" : "error", code: res.status };
      } catch {
        return { ...svc, status: "offline" as const, code: 0 };
      }
    })
  );
  return results;
}

export default async function DashboardPage() {
  const [stats, recentUsers, services] = await Promise.all([
    getStats(),
    getRecentUsers(),
    checkServices(),
  ]);

  const statCards = [
    { label: "Users", value: stats.users, icon: "👤" },
    { label: "Servers", value: stats.guilds, icon: "🏠" },
    { label: "Messages", value: stats.messages, icon: "💬" },
    { label: "Channels", value: stats.channels, icon: "#" },
    { label: "Active (24h)", value: stats.activeToday, icon: "🟢" },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-6 text-2xl font-bold text-white">Dashboard</h1>

      {/* Stats Grid */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-slate-800 bg-dark-800 p-5"
          >
            <div className="mb-2 text-2xl">{card.icon}</div>
            <p className="text-2xl font-bold text-white">
              {card.value.toLocaleString()}
            </p>
            <p className="text-sm text-slate-500">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Services Status */}
      <div className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-white">Services</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((svc) => (
            <div
              key={svc.name}
              className="flex items-center gap-3 rounded-xl border border-slate-800 bg-dark-800 px-4 py-3"
            >
              <div
                className={`h-2.5 w-2.5 rounded-full ${
                  svc.status === "online"
                    ? "bg-green-500"
                    : svc.status === "error"
                    ? "bg-yellow-500"
                    : "bg-red-500"
                }`}
              />
              <div>
                <p className="text-sm font-medium text-white">{svc.name}</p>
                <p className="text-xs text-slate-500">
                  {svc.status === "online"
                    ? "Running"
                    : svc.status === "error"
                    ? `Error (${svc.code})`
                    : "Offline"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Users */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-white">
          Recent Users
        </h2>
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-dark-800">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Username
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Verified
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Joined
                </th>
              </tr>
            </thead>
            <tbody>
              {recentUsers.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-slate-800/50 last:border-0"
                >
                  <td className="px-4 py-3 text-sm font-medium text-white">
                    {user.username}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">
                    {user.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        user.email_verified
                          ? "bg-green-500/10 text-green-400"
                          : "bg-red-500/10 text-red-400"
                      }`}
                    >
                      {user.email_verified ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {new Date(user.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
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
