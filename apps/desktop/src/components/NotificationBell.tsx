import { useEffect, useState } from "react";
import { api, type AppNotification } from "../lib/api";
import { useGuildStore } from "../stores/guild";

export default function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const usernames = useGuildStore((s) => s.usernames);
  const guilds = useGuildStore((s) => s.guilds);
  const setActiveGuild = useGuildStore((s) => s.setActiveGuild);
  const setActiveChannel = useGuildStore((s) => s.setActiveChannel);

  // Poll unread count every 30s
  useEffect(() => {
    const fetchCount = () => {
      api.getUnreadCount().then((res) => {
        if (res) setUnreadCount(res.count);
      }).catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  // Listen for real-time notifications via custom event
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const notif = e.detail as AppNotification;
      setUnreadCount((c) => c + 1);
      setNotifications((prev) => [notif, ...prev].slice(0, 50));

      // Resolve username if unknown
      if (notif.authorId && !usernames[notif.authorId]) {
        api.getProfile(notif.authorId).then((p) => {
          if (p) {
            useGuildStore.setState((s) => ({
              usernames: { ...s.usernames, [notif.authorId!]: p.displayName || p.username || "User" },
            }));
          }
        }).catch(() => {});
      }

      // Desktop notification
      if (Notification.permission === "granted") {
        const authorName = usernames[notif.authorId || ""] || "Someone";
        const guildName = guilds.find((g) => g.id === notif.guildId)?.name || "Server";
        new Notification(`${authorName} in ${guildName}`, {
          body: notif.content,
          tag: notif.id,
        });
      }
    };
    window.addEventListener("nexe:notification" as any, handler as any);
    return () => window.removeEventListener("nexe:notification" as any, handler as any);
  }, [usernames, guilds]);

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Close panel on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  async function togglePanel() {
    if (!open) {
      setLoading(true);
      try {
        const notifs = await api.getNotifications();
        setNotifications(notifs || []);
        // Resolve unknown usernames
        const unknown = (notifs || [])
          .map((n) => n.authorId)
          .filter((id): id is string => !!id && !usernames[id]);
        const unique = [...new Set(unknown)];
        for (const id of unique.slice(0, 20)) {
          api.getProfile(id).then((p) => {
            if (p) {
              useGuildStore.setState((s) => ({
                usernames: { ...s.usernames, [id]: p.displayName || p.username || "User" },
              }));
            }
          }).catch(() => {});
        }
      } catch { /* ignore */ }
      setLoading(false);
    }
    setOpen(!open);
  }

  async function markAllRead() {
    try {
      await api.markAllNotificationsRead();
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch { /* ignore */ }
  }

  async function handleClick(notif: AppNotification) {
    // Mark as read
    if (!notif.read) {
      api.markNotificationRead(notif.id).catch(() => {});
      setNotifications((prev) => prev.map((n) => n.id === notif.id ? { ...n, read: true } : n));
      setUnreadCount((c) => Math.max(0, c - 1));
    }

    // Navigate to the guild/channel
    await setActiveGuild(notif.guildId);
    if (notif.channelId) {
      await setActiveChannel(notif.channelId);
    }
    setOpen(false);
  }

  function typeIcon(type: string) {
    switch (type) {
      case "mention": return "@";
      case "role_mention": return "@&";
      case "everyone": return "@all";
      case "reply": return "↩";
      default: return "•";
    }
  }

  function timeAgo(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  }

  return (
    <>
      <button
        onClick={togglePanel}
        className="relative flex h-7 w-7 items-center justify-center rounded text-slate-400 transition-colors hover:text-slate-200"
        title="Notifications"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
          <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Full-screen overlay panel */}
      {open && (
        <div className="fixed inset-0 z-modal flex items-start justify-center" onClick={() => setOpen(false)}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" />

          {/* Panel */}
          <div
            className="relative mt-14 w-full max-w-md overflow-hidden rounded-xl border border-dark-700 bg-dark-850 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-dark-700 px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current text-nexe-400">
                  <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
                </svg>
                <h3 className="text-sm font-semibold text-slate-100">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500/20 px-1.5 text-[11px] font-semibold text-red-400">
                    {unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="rounded-md px-2.5 py-1 text-xs font-medium text-nexe-400 transition-colors hover:bg-nexe-500/10 hover:text-nexe-300"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="flex h-6 w-6 items-center justify-center rounded text-slate-500 transition-colors hover:text-slate-300"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Notification list */}
            <div className="max-h-[60vh] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-dark-600 border-t-nexe-400" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <svg viewBox="0 0 24 24" className="mb-3 h-10 w-10 fill-current text-dark-600">
                    <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
                  </svg>
                  <p className="text-sm text-slate-500">No notifications yet</p>
                  <p className="mt-1 text-xs text-slate-600">Mentions and replies will show up here</p>
                </div>
              ) : (
                notifications.map((notif) => (
                  <button
                    key={notif.id}
                    onClick={() => handleClick(notif)}
                    className={`flex w-full items-start gap-3 border-b border-dark-800 px-5 py-3.5 text-left transition-colors hover:bg-dark-800 ${
                      !notif.read ? "bg-nexe-500/5" : ""
                    }`}
                  >
                    {/* Type icon */}
                    <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      notif.type === "mention" ? "bg-nexe-500/15 text-nexe-400" :
                      notif.type === "everyone" ? "bg-yellow-500/15 text-yellow-400" :
                      notif.type === "reply" ? "bg-blue-500/15 text-blue-400" :
                      notif.type === "role_mention" ? "bg-purple-500/15 text-purple-400" :
                      "bg-dark-700 text-slate-400"
                    }`}>
                      <span className="text-xs font-bold">{typeIcon(notif.type)}</span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-200">
                          {usernames[notif.authorId || ""] || notif.authorId?.slice(0, 8) || "Someone"}
                        </span>
                        <span className="text-[11px] text-slate-600">
                          {timeAgo(notif.createdAt)}
                        </span>
                        {!notif.read && (
                          <div className="ml-auto h-2 w-2 shrink-0 rounded-full bg-nexe-500" />
                        )}
                      </div>
                      <p className="mt-0.5 text-sm leading-snug text-slate-400 line-clamp-2">{notif.content}</p>
                      <p className="mt-1 text-[11px] text-slate-600">
                        {guilds.find((g) => g.id === notif.guildId)?.name || "Server"}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
