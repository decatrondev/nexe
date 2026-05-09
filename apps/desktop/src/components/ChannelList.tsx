import { useState } from "react";
import { useGuildStore } from "../stores/guild";
import { useAuthStore } from "../stores/auth";
import { type Channel } from "../lib/api";
import CreateChannelModal from "./CreateChannelModal";

const statusColors: Record<string, string> = {
  online: "bg-green-500",
  idle: "bg-yellow-500",
  dnd: "bg-red-500",
  offline: "bg-slate-500",
};

const EMPTY_CHANNELS: Channel[] = [];

export default function ChannelList() {
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const activeChannelId = useGuildStore((s) => s.activeChannelId);
  const setActiveChannel = useGuildStore((s) => s.setActiveChannel);
  const allChannels = useGuildStore((s) => s.channels);
  const channels = (activeGuildId ? allChannels[activeGuildId] : undefined) ?? EMPTY_CHANNELS;
  const guilds = useGuildStore((s) => s.guilds);
  const user = useAuthStore((s) => s.user);
  const [showCreateChannel, setShowCreateChannel] = useState(false);

  const activeGuild = guilds.find((g) => g.id === activeGuildId);
  const serverName = activeGuild?.name || "Nexe";
  const userStatus = user?.status || "online";

  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(),
  );

  function toggleSection(section: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  function renderSection(
    title: string,
    sectionChannels: typeof channels,
    icon: "text" | "voice",
  ) {
    if (sectionChannels.length === 0) return null;
    const isCollapsed = collapsedSections.has(title);
    return (
      <div className="mb-1">
        <button
          className="flex w-full items-center gap-0.5 px-1 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400 transition-colors hover:text-slate-200"
          onClick={() => toggleSection(title)}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-3 w-3 fill-current transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
          >
            <path d="M7 10l5 5 5-5z" />
          </svg>
          {title}
        </button>

        {!isCollapsed &&
          sectionChannels.map((ch) => (
            <button
              key={ch.id}
              className={`group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                activeChannelId === ch.id
                  ? "bg-dark-700/50 text-white"
                  : "text-slate-400 hover:bg-dark-800 hover:text-slate-200"
              }`}
              onClick={() => setActiveChannel(ch.id)}
            >
              {icon === "text" ? (
                <span className="text-lg leading-none text-slate-500">#</span>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0 fill-current text-slate-500"
                >
                  <path d="M12 3a1 1 0 0 0-.707.293l-7 7a1 1 0 0 0 0 1.414l7 7A1 1 0 0 0 13 18v-4.28c3.526.36 5.47 2.03 6.136 3.636a1 1 0 0 0 1.864-.728C20.143 14.07 17.368 11 13 10.29V6a1 1 0 0 0-1-1z" />
                </svg>
              )}
              <span className="truncate">{ch.name}</span>
            </button>
          ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full w-60 shrink-0 flex-col bg-dark-900">
        {/* Server header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-dark-950 px-4">
          <h2 className="truncate text-sm font-semibold text-slate-100">
            {serverName}
          </h2>
          {activeGuildId && (
            <button
              onClick={() => setShowCreateChannel(true)}
              className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:text-slate-200"
              title="Create channel"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                <path d="M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6z" />
              </svg>
            </button>
          )}
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {!activeGuildId ? (
            <p className="px-2 py-4 text-center text-sm text-slate-500">
              Select a server to see channels
            </p>
          ) : channels.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-slate-500">
              No channels yet
            </p>
          ) : (
            <>
              {renderSection("Text Channels", textChannels, "text")}
              {renderSection("Voice Channels", voiceChannels, "voice")}
            </>
          )}
        </div>

        {/* User info bar */}
        <div className="flex shrink-0 items-center gap-2 border-t border-dark-950 bg-dark-950/50 px-2 py-2">
          <div className="relative">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-nexe-600 text-xs font-semibold text-white">
              {(user?.username || "U").charAt(0).toUpperCase()}
            </div>
            <div
              className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-dark-950 ${statusColors[userStatus] || statusColors.online}`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-200">
              {user?.displayName || user?.username || "User"}
            </p>
            <p className="truncate text-xs text-slate-500">Online</p>
          </div>
        </div>
      </div>

      {showCreateChannel && (
        <CreateChannelModal onClose={() => setShowCreateChannel(false)} />
      )}
    </>
  );
}
