import { useState, useCallback } from "react";
import { useGuildStore } from "../stores/guild";
import { FREE_TIER_LIMITS } from "../lib/limits";
import { Tooltip } from "@nexe/ui";
import CreateGuildModal from "./CreateGuildModal";
import JoinServerModal from "./JoinServerModal";

function SidebarIcon({
  isActive,
  onClick,
  title,
  activeClass = "rounded-xl bg-nexe-500 text-white",
  inactiveClass = "rounded-2xl bg-dark-800 text-slate-300 hover:rounded-xl hover:bg-nexe-500 hover:text-white",
  disabled = false,
  badge,
  children,
}: {
  isActive?: boolean;
  onClick: () => void;
  title: string;
  activeClass?: string;
  inactiveClass?: string;
  disabled?: boolean;
  badge?: number;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div className="relative">
      {/* Active / hover indicator pill */}
      <div
        className={`absolute -left-1 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-white transition-all duration-200 ${
          isActive ? "h-10" : hovered ? "h-5" : "h-0"
        }`}
      />
      <Tooltip content={title} side="right" delay={150}>
        <button
          className={`flex h-12 w-12 items-center justify-center transition-all duration-200 ${
            isActive ? activeClass : disabled ? "rounded-2xl bg-dark-800 text-slate-600 cursor-not-allowed" : inactiveClass
          }`}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={() => !disabled && onClick()}
          disabled={disabled}
        >
          {children}
        </button>
      </Tooltip>
      {badge !== undefined && badge > 0 && !isActive && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white animate-scale-in">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </div>
  );
}

export default function ServerSidebar() {
  const guilds = useGuildStore((s) => s.guilds);
  const joinLimitReached = guilds.length >= FREE_TIER_LIMITS.MAX_SERVERS_JOINED;
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const setActiveGuild = useGuildStore((s) => s.setActiveGuild);
  const unreadChannels = useGuildStore((s) => s.unreadChannels);
  const allChannels = useGuildStore((s) => s.channels);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);

  const getGuildUnread = useCallback((guildId: string) => {
    const guildChannelList = allChannels[guildId] || [];
    return guildChannelList.reduce((sum, ch) => sum + (unreadChannels[ch.id] || 0), 0);
  }, [allChannels, unreadChannels]);

  return (
    <>
      <div className="flex h-full w-[72px] shrink-0 flex-col items-center gap-2 bg-dark-950 py-3 overflow-y-auto">
        {/* Home / DM button */}
        <SidebarIcon
          isActive={activeGuildId === null}
          onClick={() => useGuildStore.setState({ activeGuildId: null, activeChannelId: null })}
          title="Home"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
            <path d="M2.391 8.84a.5.5 0 0 1 .158-.457l9-8a.5.5 0 0 1 .662 0l9 8a.5.5 0 0 1 .158.457l-1.5 11a.5.5 0 0 1-.496.434H14.5v-5a2.5 2.5 0 1 0-5 0v5H4.73a.5.5 0 0 1-.497-.434z" />
          </svg>
        </SidebarIcon>

        {/* Divider */}
        <div className="mx-auto h-0.5 w-8 rounded-full bg-dark-800" />

        {/* Server list */}
        {guilds.map((guild) => (
          <SidebarIcon
            key={guild.id}
            isActive={activeGuildId === guild.id}
            onClick={() => setActiveGuild(guild.id)}
            title={guild.name}
            badge={getGuildUnread(guild.id)}
          >
            {guild.iconUrl ? (
              <img
                src={guild.iconUrl}
                alt={guild.name}
                className="h-12 w-12 rounded-[inherit] object-cover"
              />
            ) : (
              <span className="text-sm font-semibold select-none">
                {guild.name.charAt(0).toUpperCase()}
              </span>
            )}
          </SidebarIcon>
        ))}

        {/* Add server button */}
        <SidebarIcon
          onClick={() => setShowCreateModal(true)}
          title="Create a server"
          activeClass=""
          inactiveClass="rounded-2xl bg-dark-800 text-green-500 hover:rounded-xl hover:bg-green-600 hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
            <path d="M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6z" />
          </svg>
        </SidebarIcon>

        {/* Join server button */}
        <SidebarIcon
          onClick={() => setShowJoinModal(true)}
          title={joinLimitReached ? `Server limit (${guilds.length}/${FREE_TIER_LIMITS.MAX_SERVERS_JOINED})` : "Join a server"}
          disabled={joinLimitReached}
          activeClass=""
          inactiveClass="rounded-2xl bg-dark-800 text-nexe-400 hover:rounded-xl hover:bg-nexe-500 hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
            <path d="M15 12c0 1.654-1.346 3-3 3s-3-1.346-3-3 1.346-3 3-3 3 1.346 3 3zm9-.449s-4.252 8.449-11.985 8.449c-7.18 0-12.015-8.449-12.015-8.449s4.446-7.551 12.015-7.551c7.694 0 11.985 7.551 11.985 7.551zm-7 .449c0-2.757-2.243-5-5-5s-5 2.243-5 5 2.243 5 5 5 5-2.243 5-5z" />
          </svg>
        </SidebarIcon>
      </div>

      {showCreateModal && (
        <CreateGuildModal onClose={() => setShowCreateModal(false)} />
      )}
      {showJoinModal && (
        <JoinServerModal onClose={() => setShowJoinModal(false)} />
      )}
    </>
  );
}
