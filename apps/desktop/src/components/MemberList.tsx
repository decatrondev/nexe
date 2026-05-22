import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useGuildStore } from "../stores/guild";
import { type GuildMember, type Role } from "../lib/api";
import MiniProfilePopover from "./MiniProfilePopover";
import ProfileModal from "./ProfileModal";

function getHighestRoleColor(
  userId: string,
  memberRoles: Record<string, string[]>,
  roles: Role[],
): string | undefined {
  const userRoleIds = memberRoles[userId];
  if (!userRoleIds || userRoleIds.length === 0) return undefined;

  const userRoles = roles
    .filter((r) => userRoleIds.includes(r.id) && r.color)
    .sort((a, b) => b.position - a.position);

  return userRoles.length > 0 ? userRoles[0].color : undefined;
}

function getHighestHoistedRole(
  userId: string,
  memberRoles: Record<string, string[]>,
  roles: Role[],
): Role | undefined {
  const userRoleIds = memberRoles[userId];
  if (!userRoleIds || userRoleIds.length === 0) return undefined;

  return roles
    .filter((r) => userRoleIds.includes(r.id) && r.hoisted)
    .sort((a, b) => b.position - a.position)[0];
}

function getTopRoles(
  userId: string,
  memberRoles: Record<string, string[]>,
  roles: Role[],
  max = 3,
): Role[] {
  const userRoleIds = memberRoles[userId];
  if (!userRoleIds || userRoleIds.length === 0) return [];
  return roles
    .filter((r) => userRoleIds.includes(r.id) && !r.isDefault && r.color)
    .sort((a, b) => b.position - a.position)
    .slice(0, max);
}

function isOnline(status: string | undefined): boolean {
  return status === "online" || status === "idle" || status === "dnd";
}

function getMemberName(member: GuildMember, usernames: Record<string, string>): string {
  return member.nickname || usernames[member.userId] || member.displayName || member.username || "Unknown";
}

function sortMembers(list: GuildMember[], usernames: Record<string, string>): GuildMember[] {
  return [...list].sort((a, b) =>
    getMemberName(a, usernames).localeCompare(getMemberName(b, usernames)),
  );
}

type FlatItem =
  | { type: "header"; key: string; label: string; color?: string; count: number }
  | { type: "member"; key: string; member: GuildMember; isOffline: boolean };

const EMPTY_MEMBERS: GuildMember[] = [];
const EMPTY_ROLES: Role[] = [];

export default function MemberList() {
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const allMembers = useGuildStore((s) => s.members);
  const members = (activeGuildId ? allMembers[activeGuildId] : undefined) ?? EMPTY_MEMBERS;
  const allRoles = useGuildStore((s) => s.roles);
  const roles = (activeGuildId ? allRoles[activeGuildId] : undefined) ?? EMPTY_ROLES;
  const memberRoles = useGuildStore((s) => s.memberRoles);
  const usernames = useGuildStore((s) => s.usernames);
  const avatarMap = useGuildStore((s) => s.avatarMap);
  const presenceMap = useGuildStore((s) => s.presenceMap);
  const streamStatusMap = useGuildStore((s) => s.streamStatusMap);
  const loading = useGuildStore((s) => s.loading);

  const [search, setSearch] = useState("");
  const [profilePopover, setProfilePopover] = useState<{ userId: string; x: number; y: number } | null>(null);
  const [fullProfileUserId, setFullProfileUserId] = useState<string | null>(null);
  const [hoveredMemberId, setHoveredMemberId] = useState<string | null>(null);

  const flatItems = useMemo((): FlatItem[] => {
    const hoistedRoles = roles
      .filter((r) => r.hoisted && !r.isDefault)
      .sort((a, b) => b.position - a.position);

    const onlineMembers: GuildMember[] = [];
    const offlineMembers: GuildMember[] = [];
    const hoistedGroups = new Map<string, GuildMember[]>();

    for (const role of hoistedRoles) {
      hoistedGroups.set(role.id, []);
    }

    // Filter by search
    const query = search.trim().toLowerCase();
    const filtered = query
      ? members.filter((m) => getMemberName(m, usernames).toLowerCase().includes(query))
      : members;

    for (const member of filtered) {
      const online = isOnline(presenceMap[member.userId]);

      if (!online) {
        offlineMembers.push(member);
        continue;
      }

      const highestHoisted = getHighestHoistedRole(member.userId, memberRoles, roles);
      if (highestHoisted && hoistedGroups.has(highestHoisted.id)) {
        hoistedGroups.get(highestHoisted.id)!.push(member);
      } else {
        onlineMembers.push(member);
      }
    }

    const items: FlatItem[] = [];

    for (const role of hoistedRoles) {
      const roleMembers = sortMembers(hoistedGroups.get(role.id) || [], usernames);
      if (roleMembers.length > 0) {
        items.push({ type: "header", key: `h-${role.id}`, label: role.name, color: role.color, count: roleMembers.length });
        for (const m of roleMembers) {
          items.push({ type: "member", key: m.id, member: m, isOffline: false });
        }
      }
    }

    const sortedOnline = sortMembers(onlineMembers, usernames);
    if (sortedOnline.length > 0) {
      items.push({ type: "header", key: "h-online", label: "Online", count: sortedOnline.length });
      for (const m of sortedOnline) {
        items.push({ type: "member", key: m.id, member: m, isOffline: false });
      }
    }

    const sortedOffline = sortMembers(offlineMembers, usernames);
    if (sortedOffline.length > 0) {
      items.push({ type: "header", key: "h-offline", label: "Offline", count: sortedOffline.length });
      for (const m of sortedOffline) {
        items.push({ type: "member", key: m.id, member: m, isOffline: true });
      }
    }

    return items;
  }, [members, roles, memberRoles, presenceMap, usernames, search]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => flatItems[i].type === "header" ? 28 : 44,
    overscan: 10,
  });

  if (!activeGuildId) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col bg-dark-800 border-l border-dark-900">
        <div className="flex-1 overflow-y-auto px-2 py-4">
          <p className="px-2 text-center text-sm text-slate-500">No server selected</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-dark-800 border-l border-dark-900">
      {/* Search */}
      <div className="shrink-0 px-2 pt-3 pb-1">
        <div className="relative">
          <svg className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            type="text"
            placeholder="Search members"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-dark-900 bg-dark-900/60 py-1.5 pl-7 pr-2 text-xs text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-nexe-600/40 focus:bg-dark-900"
          />
        </div>
      </div>

      {/* Member list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-2 accent-scrollbar scrollbar-thin">
        {loading ? (
          // Skeleton loading
          <div className="space-y-1 px-1">
            {[...Array(3)].map((_, gi) => (
              <div key={gi}>
                <div className="mb-2 mt-3 h-3 w-20 animate-pulse rounded bg-white/[0.04]" />
                {[...Array(gi === 0 ? 4 : gi === 1 ? 6 : 3)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5 px-2">
                    <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-white/[0.04]" />
                    <div className="h-3 animate-pulse rounded bg-white/[0.04]" style={{ width: `${50 + Math.random() * 60}px` }} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : members.length === 0 ? (
          <p className="mt-4 px-2 text-center text-sm text-slate-500">No members yet</p>
        ) : flatItems.length === 0 && search ? (
          <p className="mt-4 px-2 text-center text-sm text-slate-500">No members match "{search}"</p>
        ) : (
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const item = flatItems[vItem.index];

              if (item.type === "header") {
                return (
                  <div
                    key={item.key}
                    className="absolute left-0 right-0"
                    style={{ height: vItem.size, transform: `translateY(${vItem.start}px)` }}
                  >
                    <h3 className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide">
                      <span style={{ color: item.color || undefined }} className={item.color ? undefined : "text-slate-500"}>
                        {item.label} — {item.count}
                      </span>
                    </h3>
                  </div>
                );
              }

              const { member, isOffline } = item;
              const name = getMemberName(member, usernames);
              const roleColor = getHighestRoleColor(member.userId, memberRoles, roles);
              const status = presenceMap[member.userId];
              const isLive = !isOffline && streamStatusMap[member.userId]?.live;
              const avatar = avatarMap[member.userId];
              const topRoles = getTopRoles(member.userId, memberRoles, roles);
              const isHovered = hoveredMemberId === member.userId;
              const streamData = streamStatusMap[member.userId];

              return (
                <div
                  key={item.key}
                  className="absolute left-0 right-0"
                  style={{ height: vItem.size, transform: `translateY(${vItem.start}px)` }}
                >
                  <button
                    onClick={(e) => setProfilePopover({ userId: member.userId, x: e.clientX, y: e.clientY })}
                    onMouseEnter={() => setHoveredMemberId(member.userId)}
                    onMouseLeave={() => setHoveredMemberId(null)}
                    className={`group relative flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 transition-all duration-150 hover:bg-white/[0.04] ${
                      isOffline ? "opacity-50" : ""
                    }`}
                    title={name}
                  >
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      {avatar ? (
                        <img src={avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
                          style={{
                            backgroundColor: roleColor ? roleColor + "22" : undefined,
                            color: roleColor || undefined,
                          }}
                        >
                          {!roleColor && (
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-nexe-700 text-white">
                              {name.charAt(0).toUpperCase()}
                            </span>
                          )}
                          {roleColor && name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      {/* Presence dot */}
                      <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-dark-800 transition-colors duration-300 ${
                        isOffline
                          ? "bg-slate-600"
                          : status === "idle"
                          ? "bg-yellow-500"
                          : status === "dnd"
                          ? "bg-red-500"
                          : "bg-green-500"
                      }`} />
                    </div>

                    {/* Name + badges */}
                    <div className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-1.5">
                        <p
                          className="truncate text-sm font-medium leading-tight"
                          style={{ color: isOffline ? (roleColor ? roleColor + "66" : undefined) : (roleColor || undefined) }}
                        >
                          <span className={!roleColor ? (isOffline ? "text-slate-600" : "text-slate-200") : undefined}>
                            {name}
                          </span>
                        </p>
                        {/* Role dots */}
                        {topRoles.length > 0 && !isLive && (
                          <div className="flex shrink-0 gap-0.5">
                            {topRoles.map((r) => (
                              <div
                                key={r.id}
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: r.color }}
                                title={r.name}
                              />
                            ))}
                          </div>
                        )}
                        {/* LIVE badge — shown even for offline users */}
                        {isLive && (
                          <span className="shrink-0 rounded bg-red-600 px-1 py-px text-[9px] font-bold uppercase leading-none text-white animate-pulse-subtle">
                            Live
                          </span>
                        )}
                      </div>
                      {/* Streaming info */}
                      {isLive && streamData && (
                        <p className="truncate text-[11px] leading-tight text-purple-400/70">
                          {streamData.game || "Streaming"}
                        </p>
                      )}
                    </div>

                    {/* Hover tooltip with full name */}
                    {isHovered && name.length > 16 && (
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-dark-950 px-2 py-1 text-xs text-slate-200 shadow-lg ring-1 ring-white/5">
                        {name}
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {profilePopover && (
        <MiniProfilePopover
          userId={profilePopover.userId}
          x={profilePopover.x}
          y={profilePopover.y}
          streamStatus={streamStatusMap[profilePopover.userId] ? { ...streamStatusMap[profilePopover.userId], linked: true } : undefined}
          onClose={() => setProfilePopover(null)}
          onViewFull={() => {
            setFullProfileUserId(profilePopover.userId);
            setProfilePopover(null);
          }}
        />
      )}

      {fullProfileUserId && (
        <ProfileModal
          userId={fullProfileUserId}
          streamStatus={streamStatusMap[fullProfileUserId] ? { ...streamStatusMap[fullProfileUserId], linked: true } : undefined}
          onClose={() => setFullProfileUserId(null)}
        />
      )}
    </div>
  );
}
