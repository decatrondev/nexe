import { useMemo, useState } from "react";
import { useGuildStore } from "../stores/guild";
import { type GuildMember, type Role } from "../lib/api";
import { formatJoinDate } from "../lib/utils";
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

interface MemberGroup {
  role: Role | null; // null = "Online" (no hoisted role)
  members: GuildMember[];
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

  // Group members by their highest hoisted role
  const groups = useMemo((): MemberGroup[] => {
    const hoistedRoles = roles
      .filter((r) => r.hoisted && !r.isDefault)
      .sort((a, b) => b.position - a.position);

    if (hoistedRoles.length === 0) {
      // No hoisted roles — show all under a single "Members" group
      return [{ role: null, members }];
    }

    const grouped = new Map<string | null, GuildMember[]>();
    // Initialize groups for hoisted roles
    for (const role of hoistedRoles) {
      grouped.set(role.id, []);
    }
    grouped.set(null, []); // "Online" group for members without hoisted roles

    for (const member of members) {
      const highestHoisted = getHighestHoistedRole(member.userId, memberRoles, roles);
      const groupKey = highestHoisted?.id ?? null;
      if (!grouped.has(groupKey)) {
        grouped.set(null, [...(grouped.get(null) || []), member]);
      } else {
        grouped.get(groupKey)!.push(member);
      }
    }

    const result: MemberGroup[] = [];
    for (const role of hoistedRoles) {
      const roleMembers = grouped.get(role.id) || [];
      if (roleMembers.length > 0) {
        result.push({ role, members: roleMembers });
      }
    }
    const online = grouped.get(null) || [];
    if (online.length > 0) {
      result.push({ role: null, members: online });
    }

    return result;
  }, [members, roles, memberRoles]);

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
        {groups.map((group, groupIdx) => {
          const groupLabel = group.role
            ? group.role.name
            : "Online";
          const groupColor = group.role?.color;

          return (
            <div key={group.role?.id ?? `online-${groupIdx}`} className="mb-2">
              <h3
                className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide"
                style={{ color: groupColor || undefined }}
              >
                <span className={groupColor ? undefined : "text-slate-500"}>
                  {groupLabel} — {group.members.length}
                </span>
              </h3>
              {group.members.map((member) => {
                const name = member.nickname || usernames[member.userId] || "Unknown";
                const roleColor = getHighestRoleColor(member.userId, memberRoles, roles);
                return (
                  <button
                    key={member.id}
                    onClick={(e) => setProfilePopover({ userId: member.userId, x: e.clientX, y: e.clientY })}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 transition-all duration-150 hover:bg-dark-800/70"
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
                      <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-dark-850 transition-colors duration-300 ${
                        presenceMap[member.userId] === "idle" ? "bg-yellow-500" :
                        presenceMap[member.userId] === "dnd" ? "bg-red-500" :
                        presenceMap[member.userId] === "offline" ? "bg-slate-500" :
                        "bg-green-500"
                      }`} />
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-1.5">
                        <p
                          className="truncate text-sm font-medium"
                          style={{ color: roleColor || undefined }}
                        >
                          <span className={roleColor ? undefined : "text-slate-200"}>
                            {name}
                          </span>
                        </p>
                        {streamStatusMap[member.userId]?.live && (
                          <span className="shrink-0 rounded bg-red-600 px-1 py-px text-[9px] font-bold uppercase text-white animate-pulse-subtle">
                            Live
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-slate-500">
                        {streamStatusMap[member.userId]?.live
                          ? "Streaming on Twitch"
                          : `Joined ${formatJoinDate(member.joinedAt)}`
                        }
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
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
