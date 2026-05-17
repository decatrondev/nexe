import { useState } from "react";
import { useAuthStore } from "../stores/auth";
import { useGuildStore } from "../stores/guild";
import { useDMStore } from "../stores/dm";
import { useRelationshipStore } from "../stores/relationships";
import { userColor } from "../lib/utils";
import { toast } from "@nexe/ui";
import CreateGroupDMModal from "./CreateGroupDMModal";

export default function DMSidebar() {
  const [showGroupModal, setShowGroupModal] = useState(false);
  const myId = useAuthStore((s) => s.user?.id) ?? "";
  const channels = useDMStore((s) => s.channels);
  const requests = useDMStore((s) => s.requests);
  const unreads = useDMStore((s) => s.unreads);
  const activeChannelId = useDMStore((s) => s.activeChannelId);
  const setActive = useDMStore((s) => s.setActive);
  const closeDM = useDMStore((s) => s.closeDM);
  const ackChannel = useDMStore((s) => s.ackChannel);
  const usernames = useGuildStore((s) => s.usernames);
  const avatarMap = useGuildStore((s) => s.avatarMap);
  const presenceMap = useGuildStore((s) => s.presenceMap);
  const pendingCount = useRelationshipStore((s) =>
    s.relationships.filter((r) => r.type === "pending" && r.targetId === myId).length
  );

  function getOtherUser(ch: typeof channels[0]) {
    const other = ch.participants?.find((p) => p.userId !== myId);
    return other?.userId ?? "";
  }

  function getChannelName(ch: typeof channels[0]) {
    if (ch.type === "group_dm" && ch.name) return ch.name;
    const otherId = getOtherUser(ch);
    return usernames[otherId] || "Unknown";
  }

  const STATUS_DOT: Record<string, string> = {
    online: "bg-green-500",
    idle: "bg-yellow-500",
    dnd: "bg-red-500",
    offline: "bg-slate-500",
  };

  return (
    <>
    <div className="flex h-full w-60 shrink-0 flex-col bg-dark-800 border-r border-dark-700">
      {/* Search */}
      <div className="px-2.5 pt-3 pb-2">
        <div className="flex items-center rounded-md bg-dark-900 px-2.5 py-1.5 ring-1 ring-dark-700 transition-colors focus-within:ring-nexe-500/30">
          <input
            placeholder="Find or start a conversation"
            className="flex-1 bg-transparent text-xs text-slate-300 outline-none placeholder:text-slate-600"
            readOnly
          />
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-600">
            <path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
        </div>
      </div>

      {/* Friends button */}
      <button
        onClick={() => setActive(null)}
        className={`mx-2 mb-1 flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
          activeChannelId === null
            ? "bg-dark-700/70 text-white"
            : "text-slate-400 hover:bg-dark-800 hover:text-slate-200"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
          <path d="M16.5 13c1.3 0 2.4.4 3.2 1.1A5.5 5.5 0 0 1 22 18.5V20h-4v-1.5a4 4 0 0 0-1.5-3.1zm-9 0C4.6 13 2 14.6 2 18.5V20h12v-1.5C14 14.6 11.4 13 7.5 13zM7.5 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm9-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
        </svg>
        Friends
        {pendingCount > 0 && (
          <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {pendingCount}
          </span>
        )}
      </button>

      {/* Message Requests */}
      {requests.length > 0 && (
        <button
          onClick={() => setActive("__requests__")}
          className={`mx-2 mb-1 flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
            activeChannelId === "__requests__"
              ? "bg-dark-700/70 text-white"
              : "text-slate-400 hover:bg-dark-800 hover:text-slate-200"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
          </svg>
          Message Requests
          <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {requests.length}
          </span>
        </button>
      )}

      {/* DM list header */}
      <div className="mt-3 flex items-center justify-between px-4 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Direct Messages
        </span>
        <button
          onClick={() => setShowGroupModal(true)}
          className="flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:text-slate-300"
          title="Create Group DM"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
            <path d="M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6z" />
          </svg>
        </button>
      </div>

      {/* DM channel list */}
      <div className="flex-1 overflow-y-auto px-2">
        {channels.length === 0 ? (
          <p className="px-2 pt-4 text-center text-xs text-slate-600">
            No direct messages yet
          </p>
        ) : (
          [...channels].sort((a, b) => {
            // Pinned first
            const aPinned = a.participants?.some((p) => p.userId === myId && p.pinned) ?? false;
            const bPinned = b.participants?.some((p) => p.userId === myId && p.pinned) ?? false;
            if (aPinned !== bPinned) return aPinned ? -1 : 1;
            return 0; // keep server order (already sorted by updated_at)
          }).map((ch) => {
            const otherId = getOtherUser(ch);
            const name = getChannelName(ch);
            const status = presenceMap[otherId] || "offline";
            const avatarUrl = avatarMap[otherId];
            const color = userColor(otherId);
            const isActive = activeChannelId === ch.id;
            const unreadCount = unreads[ch.id] || 0;
            const isPinned = ch.participants?.some((p) => p.userId === myId && p.pinned) ?? false;

            return (
              <div
                key={ch.id}
                className={`group flex items-center gap-2.5 rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
                  isActive
                    ? "bg-dark-700/70 text-white"
                    : unreadCount > 0
                      ? "text-white hover:bg-dark-800"
                      : "text-slate-400 hover:bg-dark-800 hover:text-slate-200"
                }`}
                onClick={() => { setActive(ch.id); if (unreadCount > 0) ackChannel(ch.id); }}
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  {ch.type === "group_dm" ? (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-nexe-500/30 text-xs font-bold text-nexe-300 select-none">
                      {(ch.participants?.length ?? 0)}
                    </div>
                  ) : avatarUrl ? (
                    <img src={avatarUrl} alt={name} className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white select-none"
                      style={{ backgroundColor: color }}
                    >
                      {name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  {ch.type !== "group_dm" && (
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-dark-800 ${STATUS_DOT[status] || STATUS_DOT.offline}`}
                    />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    {isPinned && (
                      <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 fill-slate-500">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    )}
                    <span className={`block truncate text-sm ${unreadCount > 0 ? "font-semibold" : ""}`}>{name}</span>
                  </div>
                  {ch.type === "group_dm" && (
                    <span className="text-[10px] text-slate-500">{ch.participants?.length ?? 0} members</span>
                  )}
                </div>
                {unreadCount > 0 && !isActive && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}

                {/* Close button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeDM(ch.id).catch(() => toast.error("Failed to close DM"));
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded opacity-0 text-slate-500 hover:text-slate-300 group-hover:opacity-100 transition-opacity"
                  title="Close DM"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
    {showGroupModal && <CreateGroupDMModal onClose={() => setShowGroupModal(false)} />}
    </>
  );
}
