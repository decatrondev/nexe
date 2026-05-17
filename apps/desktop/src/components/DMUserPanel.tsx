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
  const relationships = useRelationshipStore((s) => s.relationships);

  const status = presenceMap[userId] || "offline";
  const color = userColor(userId);

  // Find relationship with this user
  const rel = relationships.find(
    (r) => (r.userId === myId && r.targetId === userId) || (r.userId === userId && r.targetId === myId)
  );
  const isFriend = rel?.type === "friend";
  const isBlocked = relationships.some((r) => r.userId === myId && r.targetId === userId && r.type === "blocked");

  // Shared servers
  const sharedServers = guilds.filter((g) => {
    const members = allMembers[g.id];
    return members?.some((m) => m.userId === userId);
  });

  useEffect(() => {
    api.getProfile(userId).then(setProfile).catch(() => {});
    api.getMutualFriends(userId).then((ids) => setMutualFriendIds(ids ?? [])).catch(() => {});
  }, [userId]);

  // Initialize note from relationship
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
  const memberSince = profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";
  const friendSince = rel?.type === "friend" ? new Date(rel.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-l border-dark-700 bg-dark-800 overflow-y-auto">
      {/* Banner area */}
      <div className="relative h-16 shrink-0" style={{ backgroundColor: profile?.accentColor || color }}>
        {profile?.bannerUrl && (
          <img src={profile.bannerUrl} alt="" className="h-full w-full object-cover" />
        )}
      </div>

      {/* Avatar */}
      <div className="relative px-4 -mt-8">
        <div className="relative inline-block">
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} className="h-16 w-16 rounded-full border-4 border-dark-800 object-cover" />
          ) : (
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-dark-800 text-xl font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className={`absolute bottom-0 right-0 h-4 w-4 rounded-full border-[3px] border-dark-800 ${STATUS_DOT[status]}`} />
        </div>
      </div>

      {/* Name & Status */}
      <div className="px-4 pt-2 pb-3">
        <h3 className="text-base font-bold text-white">{displayName}</h3>
        <p className="text-xs text-slate-400">@{username}</p>
        <p className="mt-1 text-xs text-slate-500">{STATUS_LABEL[status]}</p>
        {bio && <p className="mt-2 text-xs text-slate-400 leading-relaxed">{bio}</p>}
      </div>

      <div className="mx-4 h-px bg-dark-700" />

      {/* Actions */}
      {myId !== userId && (
        <div className="flex gap-2 px-4 py-3">
          {!isFriend && !isBlocked && (
            <button
              onClick={handleAddFriend}
              className="flex-1 rounded-md bg-nexe-500 py-1.5 text-xs font-medium text-white hover:bg-nexe-600"
            >
              Add Friend
            </button>
          )}
          {!isBlocked && (
            <button
              onClick={handleBlock}
              className="rounded-md border border-dark-600 px-3 py-1.5 text-xs font-medium text-slate-400 hover:border-red-500/30 hover:text-red-400"
            >
              Block
            </button>
          )}
        </div>
      )}

      {/* Member Since */}
      <div className="px-4 py-2">
        <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Nexe Member Since</h4>
        <p className="mt-0.5 text-xs text-slate-400">{memberSince}</p>
        {friendSince && (
          <>
            <h4 className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Friends Since</h4>
            <p className="mt-0.5 text-xs text-slate-400">{friendSince}</p>
          </>
        )}
      </div>

      <div className="mx-4 h-px bg-dark-700" />

      {/* Note */}
      {rel && rel.type === "friend" && (
        <div className="px-4 py-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Note</h4>
          {editingNote ? (
            <textarea
              value={noteValue}
              onChange={(e) => setNoteValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveNote(); }
                if (e.key === "Escape") setEditingNote(false);
              }}
              onBlur={handleSaveNote}
              placeholder="Click to add a note"
              className="mt-1 w-full resize-none rounded bg-dark-900 px-2 py-1.5 text-xs text-slate-300 outline-none placeholder:text-slate-600 focus:ring-1 focus:ring-nexe-500"
              rows={2}
              maxLength={120}
              autoFocus
            />
          ) : (
            <p
              onClick={() => setEditingNote(true)}
              className="mt-1 cursor-pointer rounded px-2 py-1.5 text-xs text-slate-500 hover:bg-dark-700 min-h-[28px]"
            >
              {rel.note || "Click to add a note"}
            </p>
          )}
        </div>
      )}

      {/* Mutual Servers */}
      {sharedServers.length > 0 && (
        <div className="px-4 py-2">
          <div className="mx-[-16px] h-px bg-dark-700 mb-2" />
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Mutual Servers — {sharedServers.length}
          </h4>
          <div className="mt-1.5 space-y-1">
            {sharedServers.map((g) => (
              <div key={g.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-dark-700/50">
                {g.iconUrl ? (
                  <img src={g.iconUrl} alt={g.name} className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-dark-700 text-[10px] font-semibold text-slate-300">
                    {g.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="flex-1 truncate text-xs text-slate-300">{g.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mutual Friends */}
      {mutualFriendIds.length > 0 && (
        <div className="px-4 py-2">
          <div className="mx-[-16px] h-px bg-dark-700 mb-2" />
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Mutual Friends — {mutualFriendIds.length}
          </h4>
          <div className="mt-1.5 space-y-1">
            {mutualFriendIds.slice(0, 8).map((fid) => {
              const fname = usernames[fid] || "User";
              const favatar = avatarMap[fid];
              const fstatus = presenceMap[fid] || "offline";
              return (
                <div key={fid} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-dark-700/50">
                  <div className="relative">
                    {favatar ? (
                      <img src={favatar} alt={fname} className="h-7 w-7 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: userColor(fid) }}>
                        {fname.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-dark-800 ${STATUS_DOT[fstatus]}`} />
                  </div>
                  <span className="flex-1 truncate text-xs text-slate-300">{fname}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
