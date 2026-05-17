import { useState, useRef, useEffect } from "react";
import { useRelationshipStore } from "../stores/relationships";
import { useAuthStore } from "../stores/auth";
import { useGuildStore } from "../stores/guild";
import { useDMStore } from "../stores/dm";
import { userColor } from "../lib/utils";
import { toast } from "@nexe/ui";
import type { Relationship } from "../lib/api";

type Tab = "online" | "all" | "pending" | "blocked" | "add";

const STATUS_DOT: Record<string, string> = {
  online: "bg-green-500",
  idle: "bg-yellow-500",
  dnd: "bg-red-500",
  offline: "bg-slate-500",
};

const STATUS_LABEL: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  offline: "Offline",
};

export default function FriendsPage() {
  const [tab, setTab] = useState<Tab>("online");
  const [search, setSearch] = useState("");
  const [addUsername, setAddUsername] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addSuccess, setAddSuccess] = useState("");
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteValue, setNoteValue] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);
  const noteInputRef = useRef<HTMLInputElement>(null);

  const myId = useAuthStore((s) => s.user?.id) ?? "";
  const relationships = useRelationshipStore((s) => s.relationships);
  const presenceMap = useGuildStore((s) => s.presenceMap);
  const usernames = useGuildStore((s) => s.usernames);
  const avatarMap = useGuildStore((s) => s.avatarMap);

  const {
    sendFriendRequest,
    acceptRequest,
    rejectRequest,
    removeFriend,
    blockUser,
    unblock,
    updateRelationship,
  } = useRelationshipStore.getState();

  // Focus add input when switching to add tab
  useEffect(() => {
    if (tab === "add") setTimeout(() => addInputRef.current?.focus(), 50);
  }, [tab]);

  // Focus note input when editing
  useEffect(() => {
    if (editingNote) setTimeout(() => noteInputRef.current?.focus(), 50);
  }, [editingNote]);

  // Close menu on click outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = () => setMenuOpen(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [menuOpen]);

  // Get the "other" user ID from a relationship
  function otherId(r: Relationship) {
    return r.userId === myId ? r.targetId : r.userId;
  }

  function getUsername(userId: string) {
    return usernames[userId] || "Unknown";
  }

  function getStatus(userId: string) {
    return presenceMap[userId] || "offline";
  }

  // Filter helpers
  const friends = relationships.filter((r) => r.type === "friend");
  const onlineFriends = friends.filter((r) => getStatus(otherId(r)) !== "offline");
  const pendingIncoming = relationships.filter((r) => r.type === "pending" && r.targetId === myId);
  const pendingOutgoing = relationships.filter((r) => r.type === "pending" && r.userId === myId);
  const blocked = relationships.filter((r) => r.type === "blocked");

  function getListForTab(): { items: Relationship[]; title: string } {
    switch (tab) {
      case "online":
        return { items: onlineFriends, title: `Online — ${onlineFriends.length}` };
      case "all":
        return { items: friends, title: `All Friends — ${friends.length}` };
      case "pending":
        return { items: [...pendingIncoming, ...pendingOutgoing], title: `Pending — ${pendingIncoming.length + pendingOutgoing.length}` };
      case "blocked":
        return { items: blocked, title: `Blocked — ${blocked.length}` };
      default:
        return { items: [], title: "" };
    }
  }

  const { items, title } = getListForTab();

  // Sort: favorites first, then alphabetical
  const sorted = [...items].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    return getUsername(otherId(a)).localeCompare(getUsername(otherId(b)));
  });

  // Apply search filter
  const filtered = search
    ? sorted.filter((r) => getUsername(otherId(r)).toLowerCase().includes(search.toLowerCase()))
    : sorted;

  async function handleAddFriend() {
    const username = addUsername.trim();
    if (!username) return;
    setAddLoading(true);
    setAddSuccess("");
    try {
      await sendFriendRequest(username);
      setAddSuccess(`Friend request sent to ${username}!`);
      setAddUsername("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send request");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleAccept(id: string) {
    try {
      await acceptRequest(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to accept");
    }
  }

  async function handleReject(id: string) {
    try {
      await rejectRequest(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function handleRemove(id: string) {
    try {
      await removeFriend(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
    setMenuOpen(null);
  }

  async function handleBlock(targetId: string) {
    try {
      await blockUser(targetId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
    setMenuOpen(null);
  }

  async function handleUnblock(id: string) {
    try {
      await unblock(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function handleToggleFavorite(r: Relationship) {
    try {
      await updateRelationship(r.id, { isFavorite: !r.isFavorite });
    } catch {
      // ignore
    }
  }

  async function handleSaveNote(id: string) {
    try {
      await updateRelationship(id, { note: noteValue });
    } catch {
      // ignore
    }
    setEditingNote(null);
  }

  function startEditNote(r: Relationship) {
    setEditingNote(r.id);
    setNoteValue(r.note || "");
  }

  // Avatar component
  function Avatar({ userId, size = 40 }: { userId: string; size?: number }) {
    const url = avatarMap[userId];
    const name = getUsername(userId);
    const color = userColor(userId);
    const status = getStatus(userId);
    const px = `${size}px`;

    return (
      <div className="relative shrink-0">
        {url ? (
          <img
            src={url}
            alt={name}
            className="rounded-full object-cover"
            style={{ width: px, height: px }}
          />
        ) : (
          <div
            className="flex items-center justify-center rounded-full font-semibold text-white select-none"
            style={{ width: px, height: px, backgroundColor: color, fontSize: `${size * 0.38}px` }}
          >
            {name.charAt(0).toUpperCase()}
          </div>
        )}
        {tab !== "blocked" && (
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[3px] border-dark-800 ${STATUS_DOT[status] || STATUS_DOT.offline}`}
          />
        )}
      </div>
    );
  }

  // Action button
  function ActionBtn({
    onClick,
    title: label,
    variant = "default",
    children,
  }: {
    onClick: () => void;
    title: string;
    variant?: "default" | "success" | "danger";
    children: React.ReactNode;
  }) {
    const colors = {
      default: "bg-dark-700 text-slate-300 hover:text-white",
      success: "bg-dark-700 text-slate-300 hover:text-green-400",
      danger: "bg-dark-700 text-slate-300 hover:text-red-400",
    };
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        title={label}
        className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${colors[variant]}`}
      >
        {children}
      </button>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col bg-dark-900">
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center gap-4 border-b border-dark-700 px-4">
        {/* Friends icon + label */}
        <div className="flex items-center gap-2 text-white">
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current text-slate-400">
            <path d="M16.5 13c1.3 0 2.4.4 3.2 1.1A5.5 5.5 0 0 1 22 18.5V20h-4v-1.5a4 4 0 0 0-1.5-3.1zm-9 0C4.6 13 2 14.6 2 18.5V20h12v-1.5C14 14.6 11.4 13 7.5 13zM7.5 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm9-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
          </svg>
          <span className="font-semibold text-sm">Friends</span>
        </div>

        <div className="h-6 w-px bg-dark-600" />

        {/* Tabs */}
        {(["online", "all", "pending", "blocked"] as const).map((t) => {
          const count = t === "pending" ? pendingIncoming.length : 0;
          return (
            <button
              key={t}
              onClick={() => { setTab(t); setSearch(""); }}
              className={`relative rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-all duration-150 ${
                tab === t
                  ? "bg-dark-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-dark-700/60"
              }`}
            >
              {t}
              {count > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {count}
                </span>
              )}
            </button>
          );
        })}

        {/* Add Friend button */}
        <button
          onClick={() => { setTab("add"); setAddSuccess(""); }}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
            tab === "add"
              ? "bg-green-500/10 text-green-400 ring-1 ring-green-500/30"
              : "bg-green-600 text-white hover:bg-green-500 shadow-sm"
          }`}
        >
          Add Friend
        </button>
      </div>

      {/* Add friend view */}
      {tab === "add" ? (
        <div className="px-6 pt-5">
          <h3 className="text-sm font-semibold uppercase text-white">Add Friend</h3>
          <p className="mt-1 text-sm text-slate-400">You can add friends with their Nexe username.</p>
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-dark-600 bg-dark-800 p-1.5 focus-within:border-nexe-500">
            <input
              ref={addInputRef}
              value={addUsername}
              onChange={(e) => { setAddUsername(e.target.value); setAddSuccess(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleAddFriend()}
              placeholder="Enter a username"
              className="flex-1 bg-transparent px-2 text-sm text-slate-200 outline-none placeholder:text-slate-500"
              disabled={addLoading}
            />
            <button
              onClick={handleAddFriend}
              disabled={!addUsername.trim() || addLoading}
              className="rounded-md bg-nexe-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-nexe-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {addLoading ? "Sending..." : "Send Friend Request"}
            </button>
          </div>
          {addSuccess && (
            <p className="mt-3 text-sm text-green-400">{addSuccess}</p>
          )}
        </div>
      ) : (
        <>
          {/* Search bar */}
          {items.length > 0 && (
            <div className="px-6 pt-4 pb-2">
              <div className="flex items-center rounded-md bg-dark-800 px-3 py-1.5">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search"
                  className="flex-1 bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
                />
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-500">
                  <path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                </svg>
              </div>
            </div>
          )}

          {/* Section title */}
          <div className="px-6 pt-3 pb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</span>
          </div>

          {/* Friend list */}
          <div className="flex-1 overflow-y-auto px-4">
            {filtered.length === 0 ? (
              <EmptyState tab={tab} hasSearch={!!search} />
            ) : (
              filtered.map((r) => {
                const uid = otherId(r);
                const name = getUsername(uid);
                const status = getStatus(uid);
                const isIncoming = r.type === "pending" && r.targetId === myId;
                const isOutgoing = r.type === "pending" && r.userId === myId;

                return (
                  <div
                    key={r.id}
                    className="group flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-dark-800/60 border-t border-dark-800/50"
                  >
                    <Avatar userId={uid} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {r.isFavorite && (
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-yellow-400">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                          </svg>
                        )}
                        <span className="truncate text-sm font-medium text-white">{name}</span>
                      </div>
                      {r.type === "friend" && (
                        <span className="text-xs text-slate-500">{STATUS_LABEL[status] || "Offline"}</span>
                      )}
                      {isIncoming && (
                        <span className="text-xs text-slate-500">Incoming Friend Request</span>
                      )}
                      {isOutgoing && (
                        <span className="text-xs text-slate-500">Outgoing Friend Request</span>
                      )}
                      {r.type === "blocked" && (
                        <span className="text-xs text-slate-500">Blocked</span>
                      )}
                      {/* Note display */}
                      {editingNote === r.id ? (
                        <div className="mt-1 flex items-center gap-1">
                          <input
                            ref={noteInputRef}
                            value={noteValue}
                            onChange={(e) => setNoteValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveNote(r.id);
                              if (e.key === "Escape") setEditingNote(null);
                            }}
                            onBlur={() => handleSaveNote(r.id)}
                            placeholder="Add a note..."
                            className="w-40 rounded bg-dark-700 px-2 py-0.5 text-xs text-slate-300 outline-none placeholder:text-slate-600 focus:ring-1 focus:ring-nexe-500"
                            maxLength={120}
                          />
                        </div>
                      ) : r.note ? (
                        <p
                          className="mt-0.5 truncate text-[11px] text-slate-600 cursor-pointer hover:text-slate-400"
                          onClick={() => startEditNote(r)}
                          title="Click to edit note"
                        >
                          {r.note}
                        </p>
                      ) : null}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* Online / All tab actions */}
                      {(tab === "online" || tab === "all") && r.type === "friend" && (
                        <>
                          {/* Message (open DM) */}
                          <ActionBtn
                            onClick={() => {
                              useDMStore.getState().openDM(uid).catch(() => toast.error("Failed to open DM"));
                            }}
                            title="Message"
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
                            </svg>
                          </ActionBtn>

                          {/* Favorite toggle */}
                          <ActionBtn
                            onClick={() => handleToggleFavorite(r)}
                            title={r.isFavorite ? "Remove from favorites" : "Add to favorites"}
                          >
                            <svg viewBox="0 0 24 24" className={`h-4 w-4 ${r.isFavorite ? "fill-yellow-400" : "fill-current"}`}>
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                          </ActionBtn>

                          {/* Note */}
                          <ActionBtn onClick={() => startEditNote(r)} title="Edit note">
                            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-6h8v2H8v-2zm0-4h8v2H8v-2z" />
                            </svg>
                          </ActionBtn>

                          {/* More menu */}
                          <div className="relative">
                            <ActionBtn
                              onClick={() => setMenuOpen(menuOpen === r.id ? null : r.id)}
                              title="More"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                                <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                              </svg>
                            </ActionBtn>
                            {menuOpen === r.id && (
                              <div className="absolute right-0 top-10 z-50 w-44 rounded-md border border-dark-600 bg-dark-800 py-1 shadow-xl">
                                <button
                                  onClick={() => handleRemove(r.id)}
                                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-dark-700"
                                >
                                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                  </svg>
                                  Remove Friend
                                </button>
                                <button
                                  onClick={() => handleBlock(uid)}
                                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-dark-700"
                                >
                                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.93 7.93 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.93 7.93 0 0 1 20 12c0 4.42-3.58 8-8 8z" />
                                  </svg>
                                  Block
                                </button>
                              </div>
                            )}
                          </div>
                        </>
                      )}

                      {/* Pending incoming: accept / reject */}
                      {tab === "pending" && isIncoming && (
                        <>
                          <ActionBtn onClick={() => handleAccept(r.id)} title="Accept" variant="success">
                            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 fill-current">
                              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                            </svg>
                          </ActionBtn>
                          <ActionBtn onClick={() => handleReject(r.id)} title="Reject" variant="danger">
                            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                            </svg>
                          </ActionBtn>
                        </>
                      )}

                      {/* Pending outgoing: cancel */}
                      {tab === "pending" && isOutgoing && (
                        <ActionBtn onClick={() => handleReject(r.id)} title="Cancel Request" variant="danger">
                          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                          </svg>
                        </ActionBtn>
                      )}

                      {/* Blocked: unblock */}
                      {tab === "blocked" && (
                        <button
                          onClick={() => handleUnblock(r.id)}
                          className="rounded-md border border-red-500/30 bg-transparent px-3 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
                        >
                          Unblock
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({ tab, hasSearch }: { tab: Tab; hasSearch: boolean }) {
  if (hasSearch) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-500">
        <svg viewBox="0 0 24 24" className="mb-3 h-12 w-12 fill-current opacity-30">
          <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>
        <p className="text-sm">No results found.</p>
      </div>
    );
  }

  const content: Record<string, { icon: React.ReactNode; text: string; sub: string }> = {
    online: {
      icon: (
        <svg viewBox="0 0 24 24" className="mb-3 h-16 w-16 fill-current opacity-20">
          <path d="M16.5 13c1.3 0 2.4.4 3.2 1.1A5.5 5.5 0 0 1 22 18.5V20h-4v-1.5a4 4 0 0 0-1.5-3.1zm-9 0C4.6 13 2 14.6 2 18.5V20h12v-1.5C14 14.6 11.4 13 7.5 13zM7.5 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm9-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
        </svg>
      ),
      text: "No one's online right now.",
      sub: "When your friends come online, they'll show up here.",
    },
    all: {
      icon: (
        <svg viewBox="0 0 24 24" className="mb-3 h-16 w-16 fill-current opacity-20">
          <path d="M16.5 13c1.3 0 2.4.4 3.2 1.1A5.5 5.5 0 0 1 22 18.5V20h-4v-1.5a4 4 0 0 0-1.5-3.1zm-9 0C4.6 13 2 14.6 2 18.5V20h12v-1.5C14 14.6 11.4 13 7.5 13zM7.5 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm9-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
        </svg>
      ),
      text: "You don't have any friends yet.",
      sub: "Click \"Add Friend\" to start connecting!",
    },
    pending: {
      icon: (
        <svg viewBox="0 0 24 24" className="mb-3 h-16 w-16 fill-current opacity-20">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
        </svg>
      ),
      text: "No pending friend requests.",
      sub: "Friend requests you send or receive will appear here.",
    },
    blocked: {
      icon: (
        <svg viewBox="0 0 24 24" className="mb-3 h-16 w-16 fill-current opacity-20">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.93 7.93 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.93 7.93 0 0 1 20 12c0 4.42-3.58 8-8 8z" />
        </svg>
      ),
      text: "No blocked users.",
      sub: "Users you block won't be able to message or add you.",
    },
  };

  const c = content[tab];
  if (!c) return null;

  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-500">
      {c.icon}
      <p className="text-sm font-medium text-slate-400">{c.text}</p>
      <p className="mt-1 text-xs">{c.sub}</p>
    </div>
  );
}
