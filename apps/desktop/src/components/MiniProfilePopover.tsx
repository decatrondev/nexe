import { useEffect, useRef, useState } from "react";
import { api, type UserProfile } from "../lib/api";
import { useAuthStore } from "../stores/auth";
import { useGuildStore } from "../stores/guild";
import { hasPermission, computePermissions, Permissions } from "../lib/permissions";

function userColor(userId: string): string {
  const colors = ["#a78bfa","#34d399","#f472b6","#60a5fa","#fbbf24","#fb923c","#c084fc","#2dd4bf","#f87171","#a3e635"];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return ""; }
}

// Extended profile type — backend may include twitch fields
interface UserProfileWithTwitch extends UserProfile {
  twitchId?: string;
  twitchLogin?: string;
}

type ModAction = "kick" | "ban" | "timeout" | null;

const TIMEOUT_OPTIONS = [
  { label: "1 min", value: 60 },
  { label: "5 min", value: 300 },
  { label: "1 hour", value: 3600 },
  { label: "1 day", value: 86400 },
];

interface Props {
  userId: string;
  x: number;
  y: number;
  onClose: () => void;
  onViewFull?: () => void;
}

export default function MiniProfilePopover({ userId, x, y, onClose, onViewFull }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const color = userColor(userId);

  const currentUser = useAuthStore((s) => s.user);
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const guilds = useGuildStore((s) => s.guilds);
  const allRoles = useGuildStore((s) => s.roles);
  const memberRolesMap = useGuildStore((s) => s.memberRoles);
  const isOwnProfile = currentUser?.id === userId;

  // Permission checking
  const guildRoles = (activeGuildId ? allRoles[activeGuildId] : undefined) ?? [];
  const activeGuild = guilds.find((g) => g.id === activeGuildId);
  const isOwner = activeGuild?.ownerId === currentUser?.id;
  const currentUserRoleIds = memberRolesMap[currentUser?.id ?? ""] || [];
  const myPerms = computePermissions(currentUserRoleIds, guildRoles);
  const canKick = isOwner || hasPermission(myPerms, Permissions.KICK_MEMBERS);
  const canBan = isOwner || hasPermission(myPerms, Permissions.BAN_MEMBERS);
  const canTimeout = isOwner || hasPermission(myPerms, Permissions.TIMEOUT_MEMBERS);
  const canManageRoles = isOwner || hasPermission(myPerms, Permissions.MANAGE_ROLES);
  const hasAnyModPerm = canKick || canBan || canTimeout;

  // Check if target user is the guild owner — nobody can mod the owner
  const isTargetOwner = activeGuild?.ownerId === userId;

  // Target user's roles
  const targetRoleIds = memberRolesMap[userId] || [];
  const targetRoles = guildRoles.filter((r) => targetRoleIds.includes(r.id) && !r.isDefault);
  // availableRoles no longer needed — using toggle chips instead

  // Role management state
  const [showRolePanel, setShowRolePanel] = useState(false);
  const [roleSearch, setRoleSearch] = useState("");
  const [roleLoading, setRoleLoading] = useState<string | null>(null); // roleId being toggled

  // All non-default roles, filtered by search
  const allAssignableRoles = guildRoles.filter((r) => !r.isDefault);
  const filteredRoles = roleSearch.trim()
    ? allAssignableRoles.filter((r) => r.name.toLowerCase().includes(roleSearch.toLowerCase()))
    : allAssignableRoles;

  async function handleToggleRole(roleId: string) {
    if (!activeGuildId) return;
    const hasRole = targetRoleIds.includes(roleId);
    setRoleLoading(roleId);
    try {
      if (hasRole) {
        await api.removeRole(activeGuildId, userId, roleId);
        useGuildStore.setState((s) => ({
          memberRoles: {
            ...s.memberRoles,
            [userId]: (s.memberRoles[userId] || []).filter((id) => id !== roleId),
          },
        }));
      } else {
        await api.assignRole(activeGuildId, userId, roleId);
        useGuildStore.setState((s) => ({
          memberRoles: {
            ...s.memberRoles,
            [userId]: [...(s.memberRoles[userId] || []), roleId],
          },
        }));
      }
    } catch (err) {
      console.error("Failed to toggle role:", err);
    } finally {
      setRoleLoading(null);
    }
  }


  // Moderation state
  const [modAction, setModAction] = useState<ModAction>(null);
  const [banReason, setBanReason] = useState("");
  const [timeoutDuration, setTimeoutDuration] = useState(60);
  const [modLoading, setModLoading] = useState(false);

  useEffect(() => {
    let cancel = false;
    api.getProfile(userId).then((p) => { if (!cancel) { setProfile(p); setLoading(false); } }).catch(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [userId]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose(); };
    const t = setTimeout(() => document.addEventListener("mousedown", h), 10);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", h); };
  }, [onClose]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  // Reload members after mod action
  async function reloadMembers() {
    if (!activeGuildId) return;
    try {
      const members = await api.getMembers(activeGuildId, 100);
      const list = Array.isArray(members) ? members : [];
      useGuildStore.setState((s) => ({
        members: { ...s.members, [activeGuildId]: list },
      }));
    } catch { /* ignore */ }
  }

  async function handleKick() {
    if (!activeGuildId) return;
    setModLoading(true);
    try {
      await api.kickMember(activeGuildId, userId);
      await reloadMembers();
      onClose();
    } catch (err) {
      console.error("Failed to kick member:", err);
    } finally {
      setModLoading(false);
    }
  }

  async function handleBan() {
    if (!activeGuildId) return;
    setModLoading(true);
    try {
      await api.banMember(activeGuildId, userId, banReason || undefined);
      await reloadMembers();
      onClose();
    } catch (err) {
      console.error("Failed to ban member:", err);
    } finally {
      setModLoading(false);
    }
  }

  async function handleTimeout() {
    if (!activeGuildId) return;
    setModLoading(true);
    try {
      await api.timeoutMember(activeGuildId, userId, timeoutDuration);
      await reloadMembers();
      onClose();
    } catch (err) {
      console.error("Failed to timeout member:", err);
    } finally {
      setModLoading(false);
    }
  }

  const W = 300, H = 340, M = 12;
  let left = x + 8, top = y - 40;
  if (typeof window !== "undefined") {
    if (left + W + M > window.innerWidth) left = x - W - 8;
    if (left < M) left = M;
    if (top + H + M > window.innerHeight) top = window.innerHeight - H - M;
    if (top < M) top = M;
  }

  const accent = profile?.accentColor || color;
  const displayName = profile?.displayName || profile?.username || "User";
  const username = profile?.username || "unknown";
  const level = profile?.level ?? 1;

  return (
    <div
      ref={cardRef}
      className="fixed z-[60] overflow-hidden rounded-lg shadow-xl"
      style={{ left, top, width: W, backgroundColor: "#111827", border: "1px solid #1e293b" }}
    >
      {/* Banner */}
      <div className="h-16" style={{ backgroundColor: accent }} />

      {/* Avatar area */}
      <div className="relative px-4">
        <div className="relative -mt-8 inline-block">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold text-white"
            style={{ backgroundColor: accent, border: "4px solid #111827" }}
          >
            {loading ? "..." : displayName.charAt(0).toUpperCase()}
          </div>
          {/* Online dot */}
          <div className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-[3px] bg-green-500" style={{ borderColor: "#111827" }} />
        </div>
      </div>

      {/* Info */}
      <div className="px-4 pb-4 pt-2">
        {loading ? (
          <div className="space-y-2">
            <div className="h-5 w-28 animate-pulse rounded bg-slate-800" />
            <div className="h-3 w-20 animate-pulse rounded bg-slate-800" />
          </div>
        ) : profile ? (
          <>
            {/* Name */}
            <div className="mb-3">
              <div className="flex items-center gap-1.5">
                <h3 className="text-base font-bold text-white">{displayName}</h3>
                {profile.userId && (profile as UserProfileWithTwitch).twitchId && (
                  <span title="Twitch linked">
                    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-[#9146FF]">
                      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
                    </svg>
                  </span>
                )}
              </div>
              <p className="text-[13px] text-slate-400">@{username}</p>
            </div>

            {/* Separator */}
            <div className="mb-3 h-px bg-slate-700/50" />

            {/* About me */}
            {profile.bio && (
              <div className="mb-3">
                <p className="mb-1 text-[11px] font-bold uppercase text-slate-400">About Me</p>
                <p className="text-[13px] leading-relaxed text-slate-300 line-clamp-3">{profile.bio}</p>
              </div>
            )}

            {/* Member since */}
            <div className="mb-3">
              <p className="mb-1 text-[11px] font-bold uppercase text-slate-400">Member Since</p>
              <p className="text-[13px] text-slate-300">{formatDate(profile.createdAt)}</p>
            </div>

            {/* Level */}
            <div className="mb-3 flex items-center gap-2">
              <div
                className="flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold text-white"
                style={{ backgroundColor: accent + "33", color: accent }}
              >
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 1l2.39 6.26H19l-5.3 3.98L15.69 18 10 14.27 4.31 18l1.99-6.76L1 7.26h6.61z" />
                </svg>
                Level {level}
              </div>
            </div>

            {/* View Full Profile */}
            {onViewFull && (
              <button
                onClick={onViewFull}
                className="mt-1 w-full rounded-md bg-nexe-600 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-nexe-500"
              >
                View Full Profile
              </button>
            )}

            {/* Roles */}
            {activeGuildId && canManageRoles && !isOwnProfile && (
              <>
                <div className="mt-3 h-px bg-slate-700/50" />
                <div className="mt-2" onMouseDown={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[11px] font-bold uppercase text-slate-400">Roles</p>
                    {allAssignableRoles.length > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowRolePanel((v) => !v); setRoleSearch(""); }}
                        className="text-[11px] font-medium text-nexe-400 hover:text-nexe-300 transition-colors"
                      >
                        {showRolePanel ? "Done" : "Manage"}
                      </button>
                    )}
                  </div>

                  {/* Current roles as pills (always visible) */}
                  {targetRoles.length > 0 && !showRolePanel && (
                    <div className="flex flex-wrap gap-1">
                      {targetRoles.map((role) => (
                        <span
                          key={role.id}
                          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            backgroundColor: (role.color || "#99AAB5") + "22",
                            color: role.color || "#99AAB5",
                          }}
                        >
                          {role.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {targetRoles.length === 0 && !showRolePanel && (
                    <p className="text-[11px] text-slate-600">No roles</p>
                  )}

                  {/* Toggle chips panel */}
                  {showRolePanel && (
                    <div className="mt-1">
                      {/* Search — only if more than 5 roles */}
                      {allAssignableRoles.length > 5 && (
                        <input
                          type="text"
                          value={roleSearch}
                          onChange={(e) => setRoleSearch(e.target.value)}
                          placeholder="Search roles..."
                          className="mb-2 w-full rounded-md border border-dark-700 bg-dark-800 px-2.5 py-1.5 text-[12px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-nexe-500"
                          autoFocus
                        />
                      )}

                      {/* Role chips grid */}
                      <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                        {filteredRoles.length === 0 ? (
                          <p className="text-[11px] text-slate-600 py-1">No roles found</p>
                        ) : (
                          filteredRoles.map((role) => {
                            const isAssigned = targetRoleIds.includes(role.id);
                            const isToggling = roleLoading === role.id;
                            const c = role.color || "#99AAB5";
                            return (
                              <button
                                key={role.id}
                                onClick={(e) => { e.stopPropagation(); handleToggleRole(role.id); }}
                                disabled={isToggling}
                                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all disabled:opacity-50"
                                style={isAssigned ? {
                                  backgroundColor: c + "33",
                                  color: c,
                                  border: `1.5px solid ${c}88`,
                                } : {
                                  backgroundColor: "transparent",
                                  color: "#94a3b8",
                                  border: "1.5px solid #334155",
                                }}
                              >
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: c }}
                                />
                                {role.name}
                                {isAssigned && (
                                  <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )}
                                {isToggling && (
                                  <div className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Moderation Actions — hidden for own profile and guild owner */}
            {!isOwnProfile && !isTargetOwner && activeGuildId && hasAnyModPerm && (
              <>
                <div className="mt-3 h-px bg-slate-700/50" />
                {modAction === null ? (
                  <div className="mt-2 flex gap-2">
                    {canKick && (
                      <button
                        onClick={() => setModAction("kick")}
                        className="flex-1 rounded-md py-1.5 text-[12px] font-medium text-orange-400 transition-colors hover:bg-orange-500/10"
                      >
                        Kick
                      </button>
                    )}
                    {canBan && (
                      <button
                        onClick={() => setModAction("ban")}
                        className="flex-1 rounded-md py-1.5 text-[12px] font-medium text-red-400 transition-colors hover:bg-red-500/10"
                      >
                        Ban
                      </button>
                    )}
                    {canTimeout && (
                      <button
                        onClick={() => setModAction("timeout")}
                        className="flex-1 rounded-md py-1.5 text-[12px] font-medium text-yellow-400 transition-colors hover:bg-yellow-500/10"
                      >
                        Timeout
                      </button>
                    )}
                  </div>
                ) : modAction === "kick" ? (
                  <div className="mt-2">
                    <p className="text-[12px] text-slate-400">Kick this user from the server?</p>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={handleKick}
                        disabled={modLoading}
                        className="flex-1 rounded-md bg-orange-600 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
                      >
                        {modLoading ? "..." : "Yes, Kick"}
                      </button>
                      <button
                        onClick={() => setModAction(null)}
                        className="flex-1 rounded-md py-1.5 text-[12px] font-medium text-slate-400 transition-colors hover:bg-slate-700/50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : modAction === "ban" ? (
                  <div className="mt-2">
                    <p className="text-[12px] text-slate-400">Ban this user from the server?</p>
                    <input
                      type="text"
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                      placeholder="Reason (optional)"
                      className="mt-1.5 w-full rounded bg-dark-800 px-2 py-1 text-[12px] text-slate-200 outline-none ring-1 ring-slate-700 focus:ring-red-500/50"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={handleBan}
                        disabled={modLoading}
                        className="flex-1 rounded-md bg-red-600 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                      >
                        {modLoading ? "..." : "Yes, Ban"}
                      </button>
                      <button
                        onClick={() => { setModAction(null); setBanReason(""); }}
                        className="flex-1 rounded-md py-1.5 text-[12px] font-medium text-slate-400 transition-colors hover:bg-slate-700/50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2">
                    <p className="text-[12px] text-slate-400">Timeout duration:</p>
                    <div className="mt-1.5 grid grid-cols-2 gap-1">
                      {TIMEOUT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setTimeoutDuration(opt.value)}
                          className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                            timeoutDuration === opt.value
                              ? "bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/40"
                              : "text-slate-400 hover:bg-slate-700/50"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={handleTimeout}
                        disabled={modLoading}
                        className="flex-1 rounded-md bg-yellow-600 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-yellow-700 disabled:opacity-50"
                      >
                        {modLoading ? "..." : "Timeout"}
                      </button>
                      <button
                        onClick={() => setModAction(null)}
                        className="flex-1 rounded-md py-1.5 text-[12px] font-medium text-slate-400 transition-colors hover:bg-slate-700/50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-red-400">Failed to load profile</p>
        )}
      </div>
    </div>
  );
}
