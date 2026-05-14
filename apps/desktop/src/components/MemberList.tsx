import { useMemo, useState } from "react";
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

interface MemberGroup {
  key: string;
  label: string;
  color?: string;
  members: GuildMember[];
  isOffline?: boolean;
}

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
  const presenceMap = useGuildStore((s) => s.presenceMap);
  const streamStatusMap = useGuildStore((s) => s.streamStatusMap);

  const [profilePopover, setProfilePopover] = useState<{ userId: string; x: number; y: number } | null>(null);
  const [fullProfileUserId, setFullProfileUserId] = useState<string | null>(null);

  const groups = useMemo((): MemberGroup[] => {
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

      // Online — check for hoisted role
      const highestHoisted = getHighestHoistedRole(member.userId, memberRoles, roles);
      if (highestHoisted && hoistedGroups.has(highestHoisted.id)) {
        hoistedGroups.get(highestHoisted.id)!.push(member);
      } else {
        onlineMembers.push(member);
      }
    }

    const result: MemberGroup[] = [];

    // Hoisted role groups (only online members)
    for (const role of hoistedRoles) {
      const roleMembers = hoistedGroups.get(role.id) || [];
      if (roleMembers.length > 0) {
        result.push({
          key: role.id,
          label: role.name,
          color: role.color,
          members: roleMembers,
        });
      }
    }

    // Online (no hoisted role)
    if (onlineMembers.length > 0) {
      result.push({
        key: "online",
        label: "Online",
        members: onlineMembers,
      });
    }

    // Offline
    if (offlineMembers.length > 0) {
      result.push({
        key: "offline",
        label: "Offline",
        members: offlineMembers,
        isOffline: true,
      });
    }

    return result;
  }, [members, roles, memberRoles, presenceMap]);

  if (!activeGuildId) {
    return (
      <div className="flex h-full w-60 shrink-0 flex-col bg-dark-850 border-l border-dark-900">
        <div className="flex-1 overflow-y-auto px-2 py-4">
          <p className="px-2 text-center text-sm text-slate-500">
            No server selected
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-60 shrink-0 flex-col bg-dark-850 border-l border-dark-900">
      <div className="flex-1 overflow-y-auto px-2 py-4">
        {groups.map((group) => (
          <div key={group.key} className="mb-2">
            <h3
              className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide"
              style={{ color: group.color || undefined }}
            >
              <span className={group.color ? undefined : "text-slate-500"}>
                {group.label} — {group.members.length}
              </span>
            </h3>
            {group.members.map((member) => {
              const name = member.nickname || usernames[member.userId] || "Unknown";
              const roleColor = group.isOffline ? undefined : getHighestRoleColor(member.userId, memberRoles, roles);
              const status = presenceMap[member.userId];
              const isLive = !group.isOffline && streamStatusMap[member.userId]?.live;

              return (
                <button
                  key={member.id}
                  onClick={(e) => setProfilePopover({ userId: member.userId, x: e.clientX, y: e.clientY })}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 transition-all duration-150 hover:bg-dark-800/70 ${
                    group.isOffline ? "opacity-40" : ""
                  }`}
                >
                  <div className="relative">
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
                    {!group.isOffline && (
                      <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-dark-850 transition-colors duration-300 ${
                        status === "idle" ? "bg-yellow-500" :
                        status === "dnd" ? "bg-red-500" :
                        "bg-green-500"
                      }`} />
                    )}
                    {group.isOffline && (
                      <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-dark-850 bg-slate-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                      <p
                        className="truncate text-sm font-medium"
                        style={{ color: group.isOffline ? undefined : roleColor || undefined }}
                      >
                        <span className={group.isOffline ? "text-slate-500" : roleColor ? undefined : "text-slate-200"}>
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
                      <p className="truncate text-xs text-slate-500">
                        Streaming on Twitch
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
        {members.length === 0 && (
          <p className="mt-4 px-2 text-center text-sm text-slate-500">
            No members yet
          </p>
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
