import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useGuildStore } from "../stores/guild";
import { type GuildMember, type Role } from "../lib/api";
import MiniProfilePopover from "./MiniProfilePopover";
import ProfileModal from "./ProfileModal";

/** Get the highest-position role with a color for a user */
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

/** Get the highest hoisted role for a user */
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

function isOnline(status: string | undefined): boolean {
  return status === "online" || status === "idle" || status === "dnd";
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

  const [profilePopover, setProfilePopover] = useState<{ userId: string; x: number; y: number } | null>(null);
  const [fullProfileUserId, setFullProfileUserId] = useState<string | null>(null);

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

    for (const member of members) {
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
      const roleMembers = hoistedGroups.get(role.id) || [];
      if (roleMembers.length > 0) {
        items.push({ type: "header", key: `h-${role.id}`, label: role.name, color: role.color, count: roleMembers.length });
        for (const m of roleMembers) {
          items.push({ type: "member", key: m.id, member: m, isOffline: false });
        }
      }
    }

    if (onlineMembers.length > 0) {
      items.push({ type: "header", key: "h-online", label: "Online", count: onlineMembers.length });
      for (const m of onlineMembers) {
        items.push({ type: "member", key: m.id, member: m, isOffline: false });
      }
    }

    if (offlineMembers.length > 0) {
      items.push({ type: "header", key: "h-offline", label: "Offline", count: offlineMembers.length });
      for (const m of offlineMembers) {
        items.push({ type: "member", key: m.id, member: m, isOffline: true });
      }
    }

    return items;
  }, [members, roles, memberRoles, presenceMap]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => flatItems[i].type === "header" ? 28 : 40,
    overscan: 10,
  });

  if (!activeGuildId) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col bg-dark-850 border-l border-dark-900">
        <div className="flex-1 overflow-y-auto px-2 py-4">
          <p className="px-2 text-center text-sm text-slate-500">
            No server selected
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-dark-850 border-l border-dark-900">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-4 accent-scrollbar">
        {members.length === 0 ? (
          <p className="mt-4 px-2 text-center text-sm text-slate-500">
            No members yet
          </p>
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
                    <h3 className="px-2 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide"
                      style={{ color: item.color || undefined }}
                    >
                      <span className={item.color ? undefined : "text-slate-500"}>
                        {item.label} — {item.count}
                      </span>
                    </h3>
                  </div>
                );
              }

              const { member, isOffline } = item;
              const name = member.nickname || usernames[member.userId] || "Unknown";
              const roleColor = isOffline ? undefined : getHighestRoleColor(member.userId, memberRoles, roles);
              const status = presenceMap[member.userId];
              const isLive = !isOffline && streamStatusMap[member.userId]?.live;
              const avatar = avatarMap[member.userId];

              return (
                <div
                  key={item.key}
                  className="absolute left-0 right-0"
                  style={{ height: vItem.size, transform: `translateY(${vItem.start}px)` }}
                >
                  <button
                    onClick={(e) => setProfilePopover({ userId: member.userId, x: e.clientX, y: e.clientY })}
                    className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 transition-all duration-150 hover:bg-dark-800/70 ${
                      isOffline ? "opacity-40" : ""
                    }`}
                  >
                    <div className="relative">
                      {avatar ? (
                        <img src={avatar} alt={name} className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                          style={{ backgroundColor: roleColor ? roleColor + "33" : undefined }}
                        >
                          {roleColor ? (
                            <span style={{ color: roleColor }}>{name.charAt(0).toUpperCase()}</span>
                          ) : (
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-nexe-700">
                              {name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                      )}
                      {!isOffline && (
                        <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-dark-850 transition-colors duration-300 ${
                          status === "idle" ? "bg-yellow-500" :
                          status === "dnd" ? "bg-red-500" :
                          "bg-green-500"
                        }`} />
                      )}
                      {isOffline && (
                        <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-dark-850 bg-slate-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-1.5">
                        <p
                          className="truncate text-sm font-medium"
                          style={{ color: isOffline ? undefined : roleColor || undefined }}
                        >
                          <span className={isOffline ? "text-slate-500" : roleColor ? undefined : "text-slate-200"}>
                            {name}
                          </span>
                        </p>
                        {isLive && (
                          <span className="shrink-0 rounded bg-red-600 px-1 py-px text-[9px] font-bold uppercase text-white animate-pulse-subtle">
                            Live
                          </span>
                        )}
                      </div>
                      {isLive && (
                        <p className="truncate text-xs text-purple-400/70">
                          {streamStatusMap[member.userId]?.game || "Streaming on Twitch"}
                        </p>
                      )}
                    </div>
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
