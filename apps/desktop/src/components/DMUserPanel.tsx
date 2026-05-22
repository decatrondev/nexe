import { useEffect, useState } from "react";
import { useAuthStore } from "../stores/auth";
import { useGuildStore } from "../stores/guild";
import { useRelationshipStore } from "../stores/relationships";
import { api, type UserProfile } from "../lib/api";
import { userColor } from "../lib/utils";
import { toast } from "@nexe/ui";

const STATUS_DOT: Record<string, string> = {
  online: "bg-green-500", idle: "bg-yellow-500", dnd: "bg-red-500", offline: "bg-slate-500",
};
const STATUS_LABEL: Record<string, string> = {
  online: "Online", idle: "Idle", dnd: "Do Not Disturb", offline: "Offline",
};

// Collapsible section component
function Section({ title, count, defaultOpen = true, children }: {
  title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="px-3 py-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 hover:text-slate-400 transition-colors"
      >
        <svg
          viewBox="0 0 24 24"
          className={`h-3 w-3 fill-current transition-transform duration-150 ${open ? "" : "-rotate-90"}`}
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
        {title}
        {count !== undefined && <span className="ml-auto text-slate-600">{count}</span>}
      </button>
      {open && <div className="mt-1.5 animate-fade-in">{children}</div>}
    </div>
  );
}

export default function DMUserPanel({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [mutualFriendIds, setMutualFriendIds] = useState<string[]>([]);
  const [editingNote, setEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState("");

  const myId = useAuthStore((s) => s.user?.id) ?? "";
  const guilds = useGuildStore((s) => s.guilds);
  const allMembers = useGuildStore((s) => s.members);
  const presenceMap = useGuildStore((s) => s.presenceMap);
  const usernames = useGuildStore((s) => s.usernames);
  const avatarMap = useGuildStore((s) => s.avatarMap);
  const streamStatusMap = useGuildStore((s) => s.streamStatusMap);
  const relationships = useRelationshipStore((s) => s.relationships);

  const status = presenceMap[userId] || "offline";
  const color = userColor(userId);
  const stream = streamStatusMap[userId];

  const rel = relationships.find(
    (r) => (r.userId === myId && r.targetId === userId) || (r.userId === userId && r.targetId === myId)
  );
  const isFriend = rel?.type === "friend";
  const isBlocked = relationships.some((r) => r.userId === myId && r.targetId === userId && r.type === "blocked");

  const sharedServers = guilds.filter((g) => {
    const members = allMembers[g.id];
    return members?.some((m) => m.userId === userId);
  });

  useEffect(() => {
    api.getProfile(userId).then(setProfile).catch(() => {});
    api.getMutualFriends(userId).then((ids) => setMutualFriendIds(ids ?? [])).catch(() => {});
  }, [userId]);

  useEffect(() => {
    if (rel) setNoteValue(rel.note || "");
  }, [rel]);

  async function handleSaveNote() {
    if (!rel) return;
    try {
      await useRelationshipStore.getState().updateRelationship(rel.id, { note: noteValue });
    } catch { /* ignore */ }
    setEditingNote(false);
  }

  async function handleAddFriend() {
    try {
      await useRelationshipStore.getState().sendFriendRequest(profile?.username || "");
      toast.success("Friend request sent!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function handleBlock() {
    try {
      await useRelationshipStore.getState().blockUser(userId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  const displayName = profile?.displayName || profile?.username || usernames[userId] || "User";
  const username = profile?.username || usernames[userId] || "unknown";
  const avatarUrl = profile?.avatarUrl || avatarMap[userId];
  const bio = profile?.bio;
  const socialLinks = profile?.socialLinks || [];
  const memberSince = profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  const friendSince = rel?.type === "friend" ? new Date(rel.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col border-l border-dark-700 bg-dark-800 overflow-y-auto">
      {/* Banner */}
      <div
        className="relative h-[100px] shrink-0 transition-colors"
        style={{ backgroundColor: profile?.accentColor || color }}
      >
        {profile?.bannerUrl && (
          <img src={profile.bannerUrl} alt="" className="h-full w-full object-cover" />
        )}
        {/* Gradient overlay */}
        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-dark-800 to-transparent" />
      </div>

      {/* Avatar + Badge area */}
      <div className="relative px-4 -mt-10 z-10">
        <div className="relative inline-block">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="h-[72px] w-[72px] rounded-full border-[5px] border-dark-800 object-cover shadow-lg"
            />
          ) : (
            <div
              className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-[5px] border-dark-800 text-2xl font-bold text-white shadow-lg"
              style={{ backgroundColor: color }}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <span
            className={`absolute bottom-1 right-1 h-5 w-5 rounded-full border-[3px] border-dark-800 ${STATUS_DOT[status]}`}
          />
        </div>
      </div>

      {/* Profile Card */}
      <div className="mx-3 mt-2 rounded-lg bg-dark-900/60 p-3">
        {/* Name */}
        <h3 className="text-base font-bold text-white leading-tight">{displayName}</h3>
        <p className="text-[11px] text-slate-400">@{username}</p>

        {/* Status */}
        <div className="mt-2 flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
          <span className="text-[11px] text-slate-500">{STATUS_LABEL[status]}</span>
        </div>

        {/* Streaming */}
        {stream?.live && (
          <div className="mt-2 flex items-center gap-2 rounded-md bg-red-500/10 px-2.5 py-1.5 border border-red-500/20">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase text-red-400">Live</p>
              {stream.title && <p className="truncate text-[11px] text-slate-400">{stream.title}</p>}
              {stream.game && <p className="text-[10px] text-slate-500">{stream.game}</p>}
            </div>
          </div>
        )}

        {/* Bio */}
        {bio && (
          <div className="mt-3 border-t border-dark-700 pt-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">About Me</p>
            <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">{bio}</p>
          </div>
        )}

        {/* Social Links */}
        {socialLinks.length > 0 && (
          <div className="mt-2 border-t border-dark-700 pt-2 flex flex-wrap gap-1.5">
            {socialLinks.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-dark-700 px-2 py-1 text-[10px] text-slate-400 hover:text-nexe-400 hover:bg-dark-600 transition-colors"
              >
                {link.platform}
              </a>
            ))}
          </div>
        )}

        {/* Member Since / Friends Since */}
        <div className="mt-3 border-t border-dark-700 pt-2 space-y-1.5">
          {memberSince && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Nexe Member</span>
              <span className="text-[10px] text-slate-400">{memberSince}</span>
            </div>
          )}
          {friendSince && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Friends Since</span>
              <span className="text-[10px] text-slate-400">{friendSince}</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      {myId !== userId && (
        <div className="flex gap-2 px-4 py-3">
          {!isFriend && !isBlocked && (
            <button
              onClick={handleAddFriend}
              className="flex-1 rounded-lg bg-nexe-500 py-2 text-xs font-semibold text-white transition-colors hover:bg-nexe-400"
            >
              Add Friend
            </button>
          )}
          {!isBlocked && (
            <button
              onClick={handleBlock}
              className="rounded-lg border border-dark-600 px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:border-red-500/30 hover:text-red-400 hover:bg-red-500/5"
            >
              Block
            </button>
          )}
        </div>
      )}

      {/* Note */}
      {rel && rel.type === "friend" && (
        <Section title="Note" defaultOpen={true}>
          {editingNote ? (
            <textarea
              value={noteValue}
              onChange={(e) => setNoteValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveNote(); }
                if (e.key === "Escape") setEditingNote(false);
              }}
              onBlur={handleSaveNote}
              placeholder="Add a note about this user..."
              className="w-full resize-none rounded-md bg-dark-900 px-2.5 py-2 text-xs text-slate-300 outline-none placeholder:text-slate-600 ring-1 ring-dark-600 focus:ring-nexe-500/40 transition-shadow"
              rows={2}
              maxLength={120}
              autoFocus
            />
          ) : (
            <p
              onClick={() => setEditingNote(true)}
              className="cursor-pointer rounded-md bg-dark-900/50 px-2.5 py-2 text-xs text-slate-500 ring-1 ring-dark-700 transition-colors hover:ring-dark-600 hover:text-slate-400 min-h-[32px]"
            >
              {rel.note || "Click to add a note..."}
            </p>
          )}
        </Section>
      )}

      {/* Mutual Servers (collapsible) */}
      {sharedServers.length > 0 && (
        <Section title="Mutual Servers" count={sharedServers.length} defaultOpen={true}>
          <div className="space-y-0.5">
            {sharedServers.map((g) => (
              <div
                key={g.id}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-dark-700/50 cursor-pointer"
                onClick={() => {
                  useGuildStore.getState().setActiveGuild(g.id);
                }}
              >
                {g.iconUrl ? (
                  <img src={g.iconUrl} alt={g.name} className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-dark-600 text-[11px] font-semibold text-slate-300">
                    {g.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="flex-1 truncate text-xs font-medium text-slate-300">{g.name}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Mutual Friends (collapsible) */}
      {mutualFriendIds.length > 0 && (
        <Section title="Mutual Friends" count={mutualFriendIds.length} defaultOpen={mutualFriendIds.length <= 5}>
          <div className="space-y-0.5">
            {mutualFriendIds.slice(0, 12).map((fid) => {
              const fname = usernames[fid] || "User";
              const favatar = avatarMap[fid];
              const fstatus = presenceMap[fid] || "offline";
              return (
                <div key={fid} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-dark-700/50">
                  <div className="relative shrink-0">
                    {favatar ? (
                      <img src={favatar} alt={fname} className="h-7 w-7 rounded-full object-cover" />
                    ) : (
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                        style={{ backgroundColor: userColor(fid) }}
                      >
                        {fname.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-dark-800 ${STATUS_DOT[fstatus]}`} />
                  </div>
                  <span className="flex-1 truncate text-xs text-slate-300">{fname}</span>
                </div>
              );
            })}
            {mutualFriendIds.length > 12 && (
              <p className="px-2 pt-1 text-[10px] text-slate-600">+{mutualFriendIds.length - 12} more</p>
            )}
          </div>
        </Section>
      )}

      {/* Bottom spacer */}
      <div className="h-4 shrink-0" />
    </div>
  );
}
