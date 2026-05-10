import { useState, useRef, useEffect } from "react";
import { useGuildStore } from "../stores/guild";
import { useAuthStore } from "../stores/auth";
import { hasPermission, computePermissions, Permissions } from "../lib/permissions";
import { type Channel, api } from "../lib/api";
import { FREE_TIER_LIMITS } from "../lib/limits";
import CreateChannelModal from "./CreateChannelModal";
import ServerSettingsModal from "./ServerSettingsModal";
import InviteModal from "./InviteModal";
import UserSettingsModal from "./UserSettingsModal";

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
  const [showSettings, setShowSettings] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);

  const allRoles = useGuildStore((s) => s.roles);
  const memberRolesMap = useGuildStore((s) => s.memberRoles);

  const activeGuild = guilds.find((g) => g.id === activeGuildId);
  const serverName = activeGuild?.name || "Nexe";
  const userStatus = user?.status || "online";

  // Permission computation
  const guildRoles = (activeGuildId ? allRoles[activeGuildId] : undefined) ?? [];
  const isOwner = activeGuild?.ownerId === user?.id;
  const myRoleIds = memberRolesMap[user?.id ?? ""] || [];
  const myPerms = computePermissions(myRoleIds, guildRoles);
  const canManageChannels = isOwner || hasPermission(myPerms, Permissions.MANAGE_CHANNELS);
  const channelLimitReached = channels.length >= FREE_TIER_LIMITS.MAX_CHANNELS_PER_GUILD;

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
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
            {serverName}
          </h2>
          {activeGuildId && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setShowInvite(true)}
                className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:text-slate-200"
                title="Invite people"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                  <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:text-slate-200"
                title="Server settings"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                  <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
                </svg>
              </button>
              {canManageChannels && (
                <button
                  onClick={() => !channelLimitReached && setShowCreateChannel(true)}
                  disabled={channelLimitReached}
                  className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                    channelLimitReached
                      ? "text-slate-600 cursor-not-allowed"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                  title={channelLimitReached ? `Channel limit reached (${channels.length}/${FREE_TIER_LIMITS.MAX_CHANNELS_PER_GUILD})` : "Create channel"}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                    <path d="M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6z" />
                  </svg>
                </button>
              )}
            </div>
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
          <div className="relative" ref={statusMenuRef}>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-nexe-600 text-xs font-semibold text-white">
              {(user?.username || "U").charAt(0).toUpperCase()}
            </div>
            <button
              onClick={() => setShowStatusMenu((v) => !v)}
              className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-dark-950 cursor-pointer transition-transform hover:scale-125 ${statusColors[userStatus] || statusColors.online}`}
              title="Change status"
            />
            {showStatusMenu && (
              <StatusMenu
                current={userStatus}
                onSelect={async (status) => {
                  setShowStatusMenu(false);
                  try {
                    await api.updatePresence(status);
                    useAuthStore.setState((s) => ({
                      user: s.user ? { ...s.user, status: status as "online" | "idle" | "dnd" | "offline" } : null,
                    }));
                  } catch (err) {
                    console.error("Failed to update status:", err);
                  }
                }}
                onClose={() => setShowStatusMenu(false)}
                anchorRef={statusMenuRef}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-200">
              {user?.displayName || user?.username || "User"}
            </p>
            <p className="truncate text-xs capitalize text-slate-500">
              {userStatus === "dnd" ? "Do Not Disturb" : userStatus}
            </p>
          </div>
          <button
            onClick={() => setShowUserSettings(true)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-dark-800 hover:text-slate-200"
            title="User settings"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
            </svg>
          </button>
        </div>
      </div>

      {showCreateChannel && (
        <CreateChannelModal onClose={() => setShowCreateChannel(false)} />
      )}

      {showSettings && activeGuildId && (
        <ServerSettingsModal
          guildId={activeGuildId}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showInvite && activeGuildId && (
        channels.length === 0 ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowInvite(false)}>
            <div className="w-full max-w-sm rounded-xl bg-dark-800 p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm text-slate-300">Create a channel first before inviting people.</p>
              <button onClick={() => setShowInvite(false)} className="mt-4 rounded-lg bg-nexe-600 px-4 py-2 text-sm font-medium text-white hover:bg-nexe-500">OK</button>
            </div>
          </div>
        ) : (
          <InviteModal
            guildId={activeGuildId}
            channelId={activeChannelId || channels[0]?.id || ""}
            onClose={() => setShowInvite(false)}
          />
        )
      )}

      {showUserSettings && (
        <UserSettingsModal onClose={() => setShowUserSettings(false)} />
      )}
    </>
  );
}

// ── Status Selector Dropdown ──

const STATUS_OPTIONS = [
  { value: "online", label: "Online", color: "bg-green-500" },
  { value: "idle", label: "Idle", color: "bg-yellow-500" },
  { value: "dnd", label: "Do Not Disturb", color: "bg-red-500" },
  { value: "invisible", label: "Invisible", color: "bg-slate-500" },
] as const;

function StatusMenu({
  current,
  onSelect,
  onClose,
  anchorRef,
}: {
  current: string;
  onSelect: (status: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 10);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [onClose, anchorRef]);

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 mb-2 w-48 overflow-hidden rounded-lg border border-dark-700 bg-dark-800 py-1 shadow-xl"
      style={{ zIndex: 100 }}
    >
      <p className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        Set Status
      </p>
      {STATUS_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-sm transition-colors hover:bg-dark-700 ${
            current === opt.value ? "text-white" : "text-slate-300"
          }`}
        >
          <div className={`h-2.5 w-2.5 rounded-full ${opt.color}`} />
          <span>{opt.label}</span>
          {current === opt.value && (
            <svg className="ml-auto h-3.5 w-3.5 text-nexe-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}
