import { useEffect, useRef, useState } from "react";
import { api, type AppNotification } from "../lib/api";
import { useGuildStore } from "../stores/guild";

export default function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
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

      // Desktop notification (Tauri or browser)
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

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 10);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [open]);

  async function togglePanel() {
    if (!open) {
      setLoading(true);
      try {
        const notifs = await api.getNotifications();
        setNotifications(notifs || []);
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

  function typeColor(type: string) {
    switch (type) {
      case "mention": return "text-nexe-400";
      case "everyone": return "text-yellow-400";
      case "reply": return "text-blue-400";
      default: return "text-slate-400";
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
    <div className="relative" ref={panelRef}>
      <button
        onClick={togglePanel}
        className="relative flex h-8 w-8 items-center justify-center rounded-full bg-dark-700 text-slate-300 transition-colors hover:bg-dark-600 hover:text-white"
        title="Notifications"
      >
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 fill-current">
          <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-dark-700 bg-dark-800 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-dark-700 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-100">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-nexe-400 hover:text-nexe-300"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-dark-600 border-t-nexe-400" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">
                No notifications
              </div>
            ) : (
              notifications.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleClick(notif)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-dark-700 ${
                    !notif.read ? "bg-dark-750" : ""
                  }`}
                >
                  {/* Type badge */}
                  <span className={`mt-0.5 shrink-0 text-xs font-bold ${typeColor(notif.type)}`}>
                    {typeIcon(notif.type)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-slate-200">
                        {usernames[notif.authorId || ""] || "Someone"}
                      </span>
                      <span className="text-[10px] text-slate-600">
                        {timeAgo(notif.createdAt)}
                      </span>
                      {!notif.read && (
                        <div className="ml-auto h-2 w-2 shrink-0 rounded-full bg-nexe-500" />
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-400">{notif.content}</p>
                    <p className="mt-0.5 text-[10px] text-slate-600">
                      {guilds.find((g) => g.id === notif.guildId)?.name || "Server"}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
