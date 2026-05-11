import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useGuildStore } from "../stores/guild";
import { useAuthStore } from "../stores/auth";
import { api, type Message, type Role, type ReactionGroup } from "../lib/api";
import { nexeWS } from "../lib/websocket";
import { hasPermission, computePermissions, Permissions } from "../lib/permissions";
import { copyToClipboard, formatTimestamp, userColor, getRoleColor } from "../lib/utils";
import MiniProfilePopover from "./MiniProfilePopover";
import ProfileModal from "./ProfileModal";
import EmojiPicker from "./EmojiPicker";
import MessageContent from "./MessageContent";
import MessageActions from "./MessageActions";

const EMPTY_MSGS: Message[] = [];
const EMPTY_ROLES: Role[] = [];

// ---- Context Menu ----
interface ContextMenuState {
  x: number;
  y: number;
  messageId: string;
  authorId: string;
  isOwn: boolean;
}

// ---- Typing indicator state ----
interface TypingUser {
  username: string;
  timestamp: number;
}

// Highlight search query matches in text
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-nexe-500/30 text-nexe-200 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function ChatArea() {
  const activeChannelId = useGuildStore((s) => s.activeChannelId);
  const allMessages = useGuildStore((s) => s.messages);
  const messages = (activeChannelId ? allMessages[activeChannelId] : undefined) ?? EMPTY_MSGS;
  const allChannels = useGuildStore((s) => s.channels);
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const allRoles = useGuildStore((s) => s.roles);
  const memberRolesMap = useGuildStore((s) => s.memberRoles);
  const guildRoles = (activeGuildId ? allRoles[activeGuildId] : undefined) ?? EMPTY_ROLES;
  const usernames = useGuildStore((s) => s.usernames);
  const sendMessage = useGuildStore((s) => s.sendMessage);
  const editMessage = useGuildStore((s) => s.editMessage);
  const deleteMessage = useGuildStore((s) => s.deleteMessage);
  const loadMoreMessages = useGuildStore((s) => s.loadMoreMessages);
  const allHasMore = useGuildStore((s) => s.hasMoreMessages);
  const hasMore = activeChannelId ? (allHasMore[activeChannelId] ?? false) : false;
  const currentUser = useAuthStore((s) => s.user);
  const guilds = useGuildStore((s) => s.guilds);

  // Permission checking
  const activeGuild = guilds.find((g) => g.id === activeGuildId);
  const isOwner = activeGuild?.ownerId === currentUser?.id;
  const currentUserRoleIds = memberRolesMap[currentUser?.id ?? ""] || [];
  const myPerms = computePermissions(currentUserRoleIds, guildRoles);
  const canManageMessages = isOwner || hasPermission(myPerms, Permissions.MANAGE_MESSAGES);
  const canKick = isOwner || hasPermission(myPerms, Permissions.KICK_MEMBERS);
  const canBan = isOwner || hasPermission(myPerms, Permissions.BAN_MEMBERS);
  const canTimeout = isOwner || hasPermission(myPerms, Permissions.TIMEOUT_MEMBERS);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  // Reply state
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Mini profile popover + full profile
  const [profilePopover, setProfilePopover] = useState<{ userId: string; x: number; y: number } | null>(null);
  const [fullProfileUserId, setFullProfileUserId] = useState<string | null>(null);

  // Typing indicator
  const [typingUsers, setTypingUsers] = useState<Map<string, TypingUser>>(new Map());
  const lastTypingSent = useRef(0);

  // Reactions state: messageId -> ReactionGroup[]
  const [messageReactions, setMessageReactions] = useState<Record<string, ReactionGroup[]>>({});
  // Emoji picker for reactions (positioned)
  const [emojiPicker, setEmojiPicker] = useState<{ messageId: string; x: number; y: number } | null>(null);
  // Emoji picker for message input
  const [inputEmojiPicker, setInputEmojiPicker] = useState<{ x: number; y: number } | null>(null);

  // Pins panel
  const [pinsOpen, setPinsOpen] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [pinsLoading, setPinsLoading] = useState(false);

  // Slowmode
  const [lastSendTime, setLastSendTime] = useState(0);
  const [slowmodeRemaining, setSlowmodeRemaining] = useState(0);

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionMapRef = useRef<Map<string, string>>(new Map()); // username → userId

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const MAX_CHARS = 2000;

  const guildChannels = activeGuildId ? allChannels[activeGuildId] : undefined;
  const activeChannel = guildChannels?.find((c) => c.id === activeChannelId);
  const channelName = activeChannel?.name || "general";
  const slowmodeSeconds = activeChannel?.slowmodeSeconds ?? 0;

  const allMembers = useGuildStore((s) => s.members);
  const members = (activeGuildId ? allMembers[activeGuildId] : undefined) ?? [];

  // Filtered mention suggestions
  const mentionSuggestions = mentionQuery !== null
    ? members
        .filter((m) => {
          const name = (usernames[m.userId] || "").toLowerCase();
          return name.includes(mentionQuery.toLowerCase());
        })
        .slice(0, 8)
    : [];

  // no auto-resize effect needed — textarea uses rows + CSS

  // Close context menu on any click
  useEffect(() => {
    const close = () => { setCtxMenu(null); };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // Batch-fetch reactions when messages load (persistence fix)
  useEffect(() => {
    if (!messages.length) return;

    const toFetch = messages.filter((m) => !(m.id in messageReactions)).slice(0, 50);
    if (toFetch.length === 0) return;

    const batches: Message[][] = [];
    for (let i = 0; i < toFetch.length; i += 5) {
      batches.push(toFetch.slice(i, i + 5));
    }

    let cancelled = false;
    (async () => {
      for (const batch of batches) {
        if (cancelled) break;
        const results = await Promise.allSettled(
          batch.map((m) => api.getReactions(m.id))
        );
        if (cancelled) break;
        const updates: Record<string, ReactionGroup[]> = {};
        results.forEach((r, idx) => {
          if (r.status === "fulfilled") {
            updates[batch[idx].id] = Array.isArray(r.value) ? r.value : [];
          } else {
            updates[batch[idx].id] = [];
          }
        });
        setMessageReactions((prev) => ({ ...prev, ...updates }));
      }
    })();

    return () => { cancelled = true; };
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Typing indicator -- listen for WS events
  useEffect(() => {
    const handler = (data: unknown) => {
      const d = data as { userId: string; username: string; channelId: string; timestamp: number };
      if (d.channelId !== activeChannelId) return;
      if (d.userId === currentUser?.id) return;
      setTypingUsers((prev) => {
        const next = new Map(prev);
        next.set(d.userId, { username: d.username, timestamp: d.timestamp });
        return next;
      });
    };
    nexeWS.on("TYPING_START", handler);
    return () => { nexeWS.off("TYPING_START", handler); };
  }, [activeChannelId, currentUser?.id]);

  // Clean up stale typing indicators every 3s
  useEffect(() => {
    const interval = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const next = new Map<string, TypingUser>();
        for (const [id, u] of prev) {
          if (now - u.timestamp < 5000) next.set(id, u);
        }
        return next.size !== prev.size ? next : prev;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    const newCount = messages.length;
    prevMessageCountRef.current = newCount;
    if (newCount > prevCount && prevCount > 0) {
      if (newCount - prevCount <= 5) {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } else if (prevCount === 0 && newCount > 0) {
      messagesEndRef.current?.scrollIntoView();
    }
  }, [messages.length]);

  // Reset state on channel switch
  useEffect(() => {
    setEditingId(null);
    setReplyTo(null);
    setCtxMenu(null);
    setDeleteConfirm(null);
    setProfilePopover(null);
    setTypingUsers(new Map());
    setMessageReactions({});
    setEmojiPicker(null);
    setInputEmojiPicker(null);
    setPinsOpen(false);
    setPinnedMessages([]);
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setLastSendTime(0);
    setSlowmodeRemaining(0);
  }, [activeChannelId]);

  // Focus edit input + auto-resize to fit content
  useEffect(() => {
    if (editingId && editInputRef.current) {
      const el = editInputRef.current;
      el.focus();
      el.style.height = "0px";
      el.style.height = Math.max(36, Math.min(el.scrollHeight, 200)) + "px";
    }
  }, [editingId]);

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // Slowmode countdown timer
  useEffect(() => {
    if (slowmodeSeconds <= 0 || lastSendTime === 0) return;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - lastSendTime) / 1000);
      const remaining = Math.max(0, slowmodeSeconds - elapsed);
      setSlowmodeRemaining(remaining);
      if (remaining <= 0) return;
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [slowmodeSeconds, lastSendTime]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    // Show/hide scroll-to-bottom button
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBottom(distanceFromBottom > 200);

    // Load more messages when near top
    if (!loadingMore && hasMore && el.scrollTop < 100) {
      setLoadingMore(true);
      const prevScrollHeight = el.scrollHeight;
      loadMoreMessages().finally(() => {
        setLoadingMore(false);
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const newScrollHeight = scrollContainerRef.current.scrollHeight;
            scrollContainerRef.current.scrollTop = newScrollHeight - prevScrollHeight;
          }
        });
      });
    }
  }, [loadingMore, hasMore, loadMoreMessages]);

  // Send typing indicator (throttled to 1 per 3s) + @mention detection
  function handleInputChange(value: string) {
    if (value.length > MAX_CHARS) return; // enforce char limit
    setInput(value);
    if (sendError) setSendError(null);
    const now = Date.now();
    if (activeChannelId && now - lastTypingSent.current > 3000) {
      lastTypingSent.current = now;
      nexeWS.sendTyping(activeChannelId);
    }

    // Detect @mention query
    const cursorPos = inputRef.current?.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  function insertMention(userId: string, username: string) {
    const cursorPos = inputRef.current?.selectionStart ?? input.length;
    const textBeforeCursor = input.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");
    if (atIndex === -1) return;
    const before = input.slice(0, atIndex);
    const after = input.slice(cursorPos);
    const newValue = `${before}@${username} ${after}`;
    mentionMapRef.current.set(username, userId);
    setInput(newValue);
    setMentionQuery(null);
    inputRef.current?.focus();
  }

  // Convert @username to <@userId> before sending
  function resolveContentMentions(text: string): string {
    let result = text;
    for (const [username, userId] of mentionMapRef.current) {
      result = result.replace(new RegExp(`@${username}\\b`, "g"), `<@${userId}>`);
    }
    return result;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const content = resolveContentMentions(input.trim());
    if (!content || sending) return;
    // Check slowmode
    if (slowmodeSeconds > 0 && slowmodeRemaining > 0) return;
    setSending(true);
    setSendError(null);
    try {
      await sendMessage(content, replyTo?.id);
      // If this is a bridge channel, also send to Twitch
      const guild = guilds.find((g) => g.id === activeGuildId);
      if (guild?.bridgeChannelId && guild.bridgeChannelId === activeChannelId && currentUser) {
        // Resolve <@userId> to @username for Twitch display
        const bridgeContent = content.replace(/<@([a-f0-9-]+)>/g, (_match, uid) => {
          return "@" + (usernames[uid] || uid.slice(0, 8));
        });
        api.sendToBridge(guild.id, guild.bridgeChannelId, bridgeContent, currentUser.displayName || currentUser.username).catch(() => {});
      }
      setInput("");
      mentionMapRef.current.clear();
      setReplyTo(null);
      if (slowmodeSeconds > 0) {
        setLastSendTime(Date.now());
        setSlowmodeRemaining(slowmodeSeconds);
      }
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      console.error("Failed to send message:", err);
      setSendError("Failed to send message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleEditSave(messageId: string) {
    const content = editContent.trim();
    if (!content) return;
    try {
      await editMessage(messageId, content);
      setEditingId(null);
      setEditContent("");
    } catch (err) {
      console.error("Failed to edit message:", err);
    }
  }

  async function handleDelete(messageId: string) {
    try {
      await deleteMessage(messageId);
      setDeleteConfirm(null);
    } catch (err) {
      console.error("Failed to delete message:", err);
    }
  }

  function handleContextMenu(e: React.MouseEvent, msg: Message) {
    e.preventDefault();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      messageId: msg.id,
      authorId: msg.authorId,
      isOwn: msg.authorId !== "" && msg.authorId === currentUser?.id,
    });
  }

  function startEdit(msg: Message) {
    setEditingId(msg.id);
    setEditContent(msg.content);
    setCtxMenu(null);
  }

  function startReply(msg: Message) {
    setReplyTo(msg);
    setCtxMenu(null);
    inputRef.current?.focus();
  }

  // ---- Reaction handlers ----

  async function fetchReactions(messageId: string) {
    try {
      const reactions = await api.getReactions(messageId);
      const list = Array.isArray(reactions) ? reactions : [];
      setMessageReactions((prev) => ({ ...prev, [messageId]: list }));
    } catch {
      // If API returns error (e.g. no reactions), set empty
      setMessageReactions((prev) => ({ ...prev, [messageId]: [] }));
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    const currentReactions = messageReactions[messageId] || [];
    const existing = currentReactions.find((r) => r.emoji === emoji);
    const userId = currentUser?.id ?? "";

    try {
      if (existing && existing.users.includes(userId)) {
        // Remove reaction - optimistic update
        setMessageReactions((prev) => {
          const updated = (prev[messageId] || []).map((r) => {
            if (r.emoji !== emoji) return r;
            const newUsers = r.users.filter((u) => u !== userId);
            return { ...r, count: Math.max(0, r.count - 1), users: newUsers };
          }).filter((r) => r.count > 0);
          return { ...prev, [messageId]: updated };
        });
        await api.removeReaction(messageId, emoji);
      } else {
        // Add reaction - optimistic update
        setMessageReactions((prev) => {
          const existing2 = (prev[messageId] || []).find((r) => r.emoji === emoji);
          let updated: ReactionGroup[];
          if (existing2) {
            updated = (prev[messageId] || []).map((r) => {
              if (r.emoji !== emoji) return r;
              return { ...r, count: r.count + 1, users: [...r.users, userId] };
            });
          } else {
            updated = [...(prev[messageId] || []), { emoji, count: 1, users: [userId] }];
          }
          return { ...prev, [messageId]: updated };
        });
        await api.addReaction(messageId, emoji);
      }
      // Refetch to ensure consistency
      await fetchReactions(messageId);
    } catch (err) {
      console.error("Reaction failed:", err);
      // Refetch to revert optimistic update
      await fetchReactions(messageId);
    }
  }

  function handleEmojiPickerClick(e: React.MouseEvent, messageId: string) {
    e.stopPropagation();
    if (emojiPicker?.messageId === messageId) {
      setEmojiPicker(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setEmojiPicker({ messageId, x: rect.left, y: rect.bottom + 4 });
    }
  }

  // ---- Pin handlers ----

  async function loadPins() {
    if (!activeChannelId) return;
    setPinsLoading(true);
    try {
      const pins = await api.getPinnedMessages(activeChannelId);
      setPinnedMessages(Array.isArray(pins) ? pins : []);
    } catch {
      setPinnedMessages([]);
    } finally {
      setPinsLoading(false);
    }
  }

  function togglePinsPanel() {
    const newOpen = !pinsOpen;
    setPinsOpen(newOpen);
    if (newOpen) {
      loadPins();
    }
  }

  async function handlePinMessage(messageId: string) {
    try {
      await api.pinMessage(messageId);
      setCtxMenu(null);
      if (pinsOpen) loadPins();
    } catch (err) {
      console.error("Pin failed:", err);
    }
  }

  async function handleUnpinMessage(messageId: string) {
    try {
      await api.unpinMessage(messageId);
      setCtxMenu(null);
      if (pinsOpen) loadPins();
      setPinnedMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch (err) {
      console.error("Unpin failed:", err);
    }
  }

  // ---- Search handlers ----

  function toggleSearch() {
    const newOpen = !searchOpen;
    setSearchOpen(newOpen);
    if (!newOpen) {
      setSearchQuery("");
      setSearchResults([]);
    }
  }

  async function handleSearch() {
    const q = searchQuery.trim();
    if (!activeChannelId || !q || q.length < 2) {
      if (q.length > 0 && q.length < 2) setSearchResults([]); // too short
      return;
    }
    setSearchLoading(true);
    try {
      const results = await api.searchMessages(activeChannelId, q, 25);
      setSearchResults(Array.isArray(results) ? results : []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  // Typing indicator text
  const typingNames = Array.from(typingUsers.values()).map((u) => u.username);
  const typingText = typingNames.length === 1
    ? `${typingNames[0]} is typing...`
    : typingNames.length === 2
      ? `${typingNames[0]} and ${typingNames[1]} are typing...`
      : typingNames.length > 2
        ? `${typingNames[0]} and ${typingNames.length - 1} others are typing...`
        : null;

  if (!activeChannelId) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center bg-dark-850">
        <div className="text-center">
          <div className="mb-4 text-6xl text-slate-700">#</div>
          <h2 className="text-xl font-semibold text-slate-300">Select a channel</h2>
          <p className="mt-2 text-sm text-slate-500">Pick a channel from the sidebar to start chatting</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-dark-850">
      {/* Channel header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-dark-900 px-4">
        <span className="text-lg text-slate-500">#</span>
        <span className="text-sm font-semibold text-white">{channelName}</span>
        {activeChannel?.topic && (
          <>
            <div className="mx-2 h-5 w-px bg-dark-700" />
            <span className="truncate text-xs text-slate-500">{activeChannel.topic}</span>
          </>
        )}
        {slowmodeSeconds > 0 && (
          <>
            <div className="mx-2 h-5 w-px bg-dark-700" />
            <div className="flex items-center gap-1 text-xs text-slate-400" title={`Slowmode: ${slowmodeSeconds}s`}>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{slowmodeSeconds >= 60 ? `${Math.floor(slowmodeSeconds / 60)}m` : `${slowmodeSeconds}s`}</span>
            </div>
          </>
        )}
        <div className="flex-1" />

        {/* Search toggle */}
        <button
          onClick={toggleSearch}
          className={`rounded p-1.5 transition-colors ${searchOpen ? "bg-dark-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
          title="Search"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>

        {/* Pins toggle */}
        <button
          onClick={togglePinsPanel}
          className={`rounded p-1.5 transition-colors ${pinsOpen ? "bg-dark-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
          title="Pinned Messages"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a2 2 0 014 0v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
          </svg>
        </button>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div className="relative shrink-0 border-b border-dark-900 px-4 py-2">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); if (e.key === "Escape") toggleSearch(); }}
              placeholder={`Search in #${channelName}`}
              className="flex-1 bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
            />
            {searchLoading && (
              <span className="text-xs text-slate-500">Searching...</span>
            )}
            <button onClick={toggleSearch} className="text-slate-500 hover:text-white">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Search results dropdown */}
          {searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-40 max-h-80 overflow-y-auto border-b border-dark-700 bg-dark-900 shadow-xl animate-slide-down">
              <div className="px-3 py-2 text-xs font-medium text-slate-500">
                {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
              </div>
              {searchResults.map((msg) => {
                const authorName = msg.bridgeSource ? (msg.bridgeAuthor || "Unknown") : (usernames[msg.authorId] || "Unknown");
                const color = msg.bridgeSource ? (msg.bridgeSource === "twitch" ? "#9146FF" : "#888") : (getRoleColor(msg.authorId, memberRolesMap, guildRoles) || userColor(msg.authorId));
                return (
                  <div
                    key={msg.id}
                    className="cursor-pointer px-3 py-2 transition-colors hover:bg-dark-800"
                    onClick={() => {
                      setSearchOpen(false);
                      setSearchQuery("");
                      setSearchResults([]);
                      // Scroll to the message and highlight it
                      requestAnimationFrame(() => {
                        const el = document.getElementById(`msg-${msg.id}`);
                        if (el) {
                          el.scrollIntoView({ behavior: "smooth", block: "center" });
                          el.classList.add("bg-nexe-600/10");
                          setTimeout(() => el.classList.remove("bg-nexe-600/10"), 2000);
                        }
                      });
                    }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold" style={{ color }}>{authorName}</span>
                      <span className="text-xs text-slate-500">{formatTimestamp(msg.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-300 break-words">
                      {highlightMatch(msg.content, searchQuery)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
          {searchQuery && searchResults.length === 0 && !searchLoading && (
            <div className="absolute left-0 right-0 top-full z-40 border-b border-dark-700 bg-dark-900 px-4 py-4 text-center shadow-xl animate-slide-down">
              <p className="text-sm text-slate-500">No results found</p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Messages area */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-4"
          >
            {loadingMore && (
              <div className="flex justify-center py-2">
                <span className="text-xs text-slate-500">Loading older messages...</span>
              </div>
            )}

            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center animate-fade-in">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-dark-800 text-4xl text-slate-600">#</div>
                <h3 className="text-lg font-semibold text-slate-200">Welcome to #{channelName}</h3>
                <p className="mt-1 text-sm text-slate-500">This is the start of the channel. Say something!</p>
              </div>
            ) : (
              messages.map((msg, idx) => {
                const prevMsg = idx > 0 ? messages[idx - 1] : null;
                const isBridge = msg.type === "bridge" && msg.bridgeSource;
                const isGrouped = isBridge
                  ? prevMsg?.type === "bridge" && prevMsg?.bridgeAuthorId === msg.bridgeAuthorId
                  : prevMsg?.authorId === msg.authorId && prevMsg?.type !== "bridge";
                const authorName = isBridge ? (msg.bridgeAuthor || "Unknown") : (usernames[msg.authorId] || "Unknown");
                const bridgeColor = msg.bridgeSource === "twitch" ? "#9146FF" : msg.bridgeSource === "kick" ? "#53FC18" : msg.bridgeSource === "youtube" ? "#FF0000" : undefined;
                const color = isBridge ? (bridgeColor || "#9146FF") : (getRoleColor(msg.authorId, memberRolesMap, guildRoles) || userColor(msg.authorId));
                const isEditing = editingId === msg.id;
                const replyRef = msg.replyToId ? messages.find((m) => m.id === msg.replyToId) : null;
                const reactions = messageReactions[msg.id] || [];

                return (
                  <div
                    key={msg.id}
                    id={`msg-${msg.id}`}
                    onContextMenu={(e) => handleContextMenu(e, msg)}
                    className={`group relative flex gap-4 rounded-md px-2 py-0.5 transition-[background-color] duration-100 hover:bg-dark-800/40 ${!isGrouped ? "mt-3" : ""}`}
                  >
                    {/* Avatar column */}
                    <div className="w-10 shrink-0">
                      {!isGrouped && (
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
                          style={{ backgroundColor: color + "33" }}
                        >
                          <span style={{ color }}>{(authorName || "?").charAt(0).toUpperCase()}</span>
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      {/* Reply reference */}
                      {replyRef && (
                        <button
                          onClick={() => {
                            const el = document.getElementById(`msg-${replyRef.id}`);
                            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                          }}
                          className="mb-0.5 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                        >
                          <svg className="h-3 w-3 rotate-180 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v4M3 10l6 6m-6-6l6-6" />
                          </svg>
                          <span style={{ color: replyRef.bridgeSource ? (replyRef.bridgeSource === "twitch" ? "#9146FF" : "#888") : (getRoleColor(replyRef.authorId, memberRolesMap, guildRoles) || userColor(replyRef.authorId)) }} className="font-medium">
                            {replyRef.bridgeSource ? (replyRef.bridgeAuthor || "Unknown") : (usernames[replyRef.authorId] || "Unknown")}
                          </span>
                          <span className="truncate max-w-xs">{replyRef.content}</span>
                        </button>
                      )}

                      {!isGrouped && (
                        <div className="flex items-baseline gap-2">
                          {isBridge ? (
                            <span className="flex items-center gap-1.5">
                              <span
                                className="rounded px-1 py-px text-[9px] font-bold uppercase text-white"
                                style={{ backgroundColor: bridgeColor }}
                              >
                                {msg.bridgeSource}
                              </span>
                              <span className="text-sm font-semibold" style={{ color }}>
                                {authorName}
                              </span>
                            </span>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); setProfilePopover({ userId: msg.authorId, x: e.clientX, y: e.clientY }); }}
                              className="text-sm font-semibold hover:underline"
                              style={{ color }}
                            >
                              {authorName}
                            </button>
                          )}
                          <span className="text-xs text-slate-500">{formatTimestamp(msg.createdAt)}</span>
                          {msg.editedAt && (
                            <span className="text-xs text-slate-600" title={`Edited ${formatTimestamp(msg.editedAt)}`}>(edited)</span>
                          )}
                        </div>
                      )}

                      {isEditing ? (
                        <div className="mt-1">
                          <textarea
                            ref={editInputRef}
                            value={editContent}
                            onChange={(e) => {
                              setEditContent(e.target.value);
                              // Auto-resize
                              const t = e.currentTarget;
                              t.style.height = "0px";
                              t.style.height = Math.max(36, Math.min(t.scrollHeight, 200)) + "px";
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEditSave(msg.id); }
                              if (e.key === "Escape") { setEditingId(null); setEditContent(""); }
                            }}
                            className="w-full resize-none rounded bg-dark-800 px-3 py-1.5 text-sm leading-5 text-slate-200 outline-none ring-1 ring-nexe-500/50 focus:ring-nexe-500"
                            rows={1}
                          />
                          <p className="mt-1 text-xs text-slate-500">
                            Enter to save &middot; Escape to cancel
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start gap-1">
                            {msg.pinned && (
                              <span className="mt-0.5 shrink-0 text-xs text-amber-500/60" title="Pinned">
                                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                                  <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a2 2 0 014 0v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                                </svg>
                              </span>
                            )}
                            <MessageContent content={msg.content} usernames={usernames} />
                          </div>
                        </>
                      )}

                      {/* Reactions row */}
                      {reactions.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {reactions.map((r) => (
                            <button
                              key={r.emoji}
                              onClick={() => toggleReaction(msg.id, r.emoji)}
                              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border transition-colors ${
                                r.users.includes(currentUser?.id ?? "")
                                  ? "bg-nexe-600/20 border-nexe-500/40 text-nexe-300"
                                  : "bg-dark-800 border-dark-700 text-slate-400 hover:border-dark-600"
                              }`}
                            >
                              <span>{r.emoji}</span>
                              <span>{r.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Hover actions */}
                    {!isEditing && (
                      <MessageActions
                        messageId={msg.id}
                        authorId={msg.authorId}
                        currentUserId={currentUser?.id}
                        canManageMessages={canManageMessages}
                        onReaction={handleEmojiPickerClick}
                        onReply={() => startReply(msg)}
                        onEdit={() => startEdit(msg)}
                        onDelete={() => setDeleteConfirm(msg.id)}
                      />
                    )}
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Scroll to bottom — floating above the input when user scrolled up */}
          {showScrollBottom && (
            <button
              onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
              className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-nexe-600 px-4 py-1.5 text-xs font-medium text-white shadow-lg shadow-nexe-600/20 transition-all hover:bg-nexe-500 hover:shadow-nexe-500/30 animate-slide-up"
              title="Jump to latest"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
              </svg>
              New messages
            </button>
          )}

          {/* Typing indicator */}
          <div className="h-5 shrink-0 px-4">
            {typingText && (
              <p className="text-xs text-slate-400 animate-fade-in animate-pulse-subtle">{typingText}</p>
            )}
          </div>

          {/* Reply bar */}
          {replyTo && (
            <div className="mx-4 flex items-center gap-2 rounded-t-lg border border-b-0 border-dark-700 bg-dark-800/50 px-3 py-2 animate-slide-up">
              <span className="text-xs text-slate-400">Replying to</span>
              <span className="text-xs font-medium" style={{ color: getRoleColor(replyTo.authorId, memberRolesMap, guildRoles) || userColor(replyTo.authorId) }}>
                {usernames[replyTo.authorId] || "Unknown"}
              </span>
              <span className="flex-1 truncate text-xs text-slate-500">{replyTo.content}</span>
              <button onClick={() => setReplyTo(null)} className="text-slate-500 hover:text-white">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Message input */}
          <div className="shrink-0 px-4 pb-4">
            {/* @mention autocomplete */}
            {mentionQuery !== null && mentionSuggestions.length > 0 && (
              <div className="mb-1 overflow-hidden rounded-lg border border-dark-700 bg-dark-800 shadow-xl animate-slide-up">
                {mentionSuggestions.map((m, i) => {
                  const name = usernames[m.userId] || "Unknown";
                  const roleColor = getRoleColor(m.userId, memberRolesMap, guildRoles);
                  return (
                    <button
                      key={m.userId}
                      onClick={() => insertMention(m.userId, name)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors ${i === mentionIndex ? "bg-nexe-500/20 text-white" : "text-slate-300 hover:bg-dark-700"}`}
                    >
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-dark-600 text-xs font-semibold" style={{ color: roleColor || undefined }}>
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <span style={{ color: roleColor || undefined }}>{name}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {/* Char counter */}
            {input.length > 0 && (
              <div className="mb-1 text-right">
                <span className={`text-xs ${input.length > MAX_CHARS - 50 ? "text-red-400" : "text-slate-500"}`}>
                  {input.length}/{MAX_CHARS}
                </span>
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className={`bg-dark-800 px-4 transition-colors ${replyTo ? "rounded-b-lg" : "rounded-lg"}`}>
                <div className="flex items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => {
                    handleInputChange(e.target.value);
                    const t = e.currentTarget;
                    t.style.height = "0px";
                    t.style.height = Math.max(44, Math.min(t.scrollHeight, 160)) + "px";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                      // Reset height after send
                      if (inputRef.current) inputRef.current.style.height = "44px";
                    }
                    if (mentionQuery !== null && mentionSuggestions.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setMentionIndex((i) => Math.min(i + 1, mentionSuggestions.length - 1));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setMentionIndex((i) => Math.max(i - 1, 0));
                      } else if (e.key === "Tab") {
                        e.preventDefault();
                        const s = mentionSuggestions[mentionIndex];
                        if (s) insertMention(s.userId, usernames[s.userId] || "Unknown");
                      } else if (e.key === "Escape") {
                        setMentionQuery(null);
                      }
                    }
                  }}
                  placeholder={slowmodeRemaining > 0 ? `Slowmode: ${slowmodeRemaining}s remaining` : `Message #${channelName}`}
                  className="w-full resize-none bg-transparent py-3 text-sm leading-5 text-slate-200 outline-none placeholder:text-slate-500"
                  rows={1}
                  disabled={sending || slowmodeRemaining > 0}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (inputEmojiPicker) {
                      setInputEmojiPicker(null);
                    } else {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setInputEmojiPicker({ x: rect.right, y: rect.top - 4 });
                    }
                  }}
                  className="ml-1 rounded p-1.5 text-slate-400 transition-colors hover:bg-dark-700 hover:text-white"
                  title="Emoji"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
                </div>
              </div>
              {sendError && <p className="mt-1 text-xs text-red-400">{sendError}</p>}
            </form>
          </div>
        </div>

        {/* Pins panel (slides in from right) */}
        {pinsOpen && (
          <div className="flex w-72 shrink-0 flex-col border-l border-dark-900 bg-dark-800/50">
            <div className="flex h-10 items-center justify-between border-b border-dark-900 px-3">
              <span className="text-sm font-semibold text-white">Pinned Messages</span>
              <button onClick={() => setPinsOpen(false)} className="text-slate-400 hover:text-white">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {pinsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <span className="text-xs text-slate-500">Loading pins...</span>
                </div>
              ) : pinnedMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <svg className="mb-2 h-8 w-8 text-slate-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a2 2 0 014 0v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                  </svg>
                  <p className="text-xs text-slate-500">No pinned messages</p>
                </div>
              ) : (
                pinnedMessages.map((msg) => {
                  const authorName = msg.bridgeSource ? (msg.bridgeAuthor || "Unknown") : (usernames[msg.authorId] || "Unknown");
                  const color = msg.bridgeSource ? (msg.bridgeSource === "twitch" ? "#9146FF" : "#888") : (getRoleColor(msg.authorId, memberRolesMap, guildRoles) || userColor(msg.authorId));
                  return (
                    <div key={msg.id} className="mb-2 rounded-lg border border-dark-700 bg-dark-800 p-3 transition-colors hover:bg-dark-700/50 hover:border-dark-600">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold" style={{ color }}>{authorName}</span>
                        <span className="text-xs text-slate-600">{formatTimestamp(msg.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-300 break-words line-clamp-4">{msg.content}</p>
                      <div className="mt-2 flex items-center gap-3">
                        {canManageMessages && (
                          <button
                            onClick={() => handleUnpinMessage(msg.id)}
                            className="text-xs text-slate-500 hover:text-red-400 transition-colors"
                          >
                            Unpin
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setPinsOpen(false);
                            // Scroll to the pinned message in the chat
                            const el = document.getElementById(`msg-${msg.id}`);
                            if (el) {
                              el.scrollIntoView({ behavior: "smooth", block: "center" });
                              el.classList.add("bg-nexe-600/10");
                              setTimeout(() => el.classList.remove("bg-nexe-600/10"), 2000);
                            }
                          }}
                          className="text-xs text-nexe-400 hover:text-nexe-300 transition-colors"
                        >
                          Jump to message
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-50 min-w-44 rounded-lg border border-dark-700 bg-dark-900 py-1 shadow-xl animate-scale-in"
          style={{ left: ctxMenu.x, top: ctxMenu.y, transformOrigin: "top left" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Add Reaction */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setEmojiPicker({ messageId: ctxMenu.messageId, x: rect.right + 4, y: rect.top });
              setCtxMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-slate-300 hover:bg-dark-800"
          >
            Add Reaction
          </button>

          <button
            onClick={() => {
              const msg = messages.find((m) => m.id === ctxMenu.messageId);
              if (msg) startReply(msg);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-slate-300 hover:bg-dark-800"
          >
            Reply
          </button>
          {ctxMenu.isOwn && (
            <button
              onClick={() => {
                const msg = messages.find((m) => m.id === ctxMenu.messageId);
                if (msg) startEdit(msg);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-slate-300 hover:bg-dark-800"
            >
              Edit Message
            </button>
          )}
          <button
            onClick={() => {
              const msg = messages.find((m) => m.id === ctxMenu.messageId);
              if (msg) copyToClipboard(msg.content);
              setCtxMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-slate-300 hover:bg-dark-800"
          >
            Copy Text
          </button>
          <button
            onClick={() => {
              copyToClipboard(ctxMenu.messageId);
              setCtxMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-slate-300 hover:bg-dark-800"
          >
            Copy ID
          </button>

          {/* Pin / Unpin */}
          {canManageMessages && (
            <>
              <div className="my-1 h-px bg-dark-700" />
              {(() => {
                const msg = messages.find((m) => m.id === ctxMenu.messageId);
                return msg?.pinned ? (
                  <button
                    onClick={() => handleUnpinMessage(ctxMenu.messageId)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-amber-400 hover:bg-amber-500/10"
                  >
                    Unpin Message
                  </button>
                ) : (
                  <button
                    onClick={() => handlePinMessage(ctxMenu.messageId)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-amber-400 hover:bg-amber-500/10"
                  >
                    Pin Message
                  </button>
                );
              })()}
            </>
          )}

          {(ctxMenu.isOwn || canManageMessages) && (
            <>
              <div className="my-1 h-px bg-dark-700" />
              <button
                onClick={() => { setDeleteConfirm(ctxMenu.messageId); setCtxMenu(null); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10"
              >
                Delete Message
              </button>
            </>
          )}
          {!ctxMenu.isOwn && activeGuildId && (canKick || canBan || canTimeout) && activeGuild?.ownerId !== ctxMenu.authorId && (
            <>
              <div className="my-1 h-px bg-dark-700" />
              {canKick && (
                <button
                  onClick={async () => {
                    if (window.confirm("Kick this user from the server?")) {
                      try {
                        await api.kickMember(activeGuildId, ctxMenu.authorId);
                        const members = await api.getMembers(activeGuildId, 100);
                        useGuildStore.setState((s) => ({ members: { ...s.members, [activeGuildId]: Array.isArray(members) ? members : [] } }));
                      } catch (err) { console.error("Kick failed:", err); }
                    }
                    setCtxMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-orange-400 hover:bg-orange-500/10"
                >
                  Kick User
                </button>
              )}
              {canBan && (
                <button
                  onClick={async () => {
                    const reason = window.prompt("Ban reason (optional):");
                    if (reason !== null) {
                      try {
                        await api.banMember(activeGuildId, ctxMenu.authorId, reason || undefined);
                        const members = await api.getMembers(activeGuildId, 100);
                        useGuildStore.setState((s) => ({ members: { ...s.members, [activeGuildId]: Array.isArray(members) ? members : [] } }));
                      } catch (err) { console.error("Ban failed:", err); }
                    }
                    setCtxMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10"
                >
                  Ban User
                </button>
              )}
              {canTimeout && (
                <button
                  onClick={async () => {
                    if (window.confirm("Timeout this user for 5 minutes?")) {
                      try {
                        await api.timeoutMember(activeGuildId, ctxMenu.authorId, 300);
                      } catch (err) { console.error("Timeout failed:", err); }
                    }
                    setCtxMenu(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-yellow-400 hover:bg-yellow-500/10"
                >
                  Timeout User
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-modal-backdrop" onClick={() => setDeleteConfirm(null)}>
          <div className="w-full max-w-sm rounded-xl bg-dark-800 p-6 shadow-2xl animate-modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white">Delete Message</h3>
            <p className="mt-2 text-sm text-slate-400">Are you sure you want to delete this message? This cannot be undone.</p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-dark-700"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Emoji picker for reactions */}
      {emojiPicker && (
        <EmojiPicker
          x={emojiPicker.x}
          y={emojiPicker.y}
          onSelect={(emoji) => {
            toggleReaction(emojiPicker.messageId, emoji);
            setEmojiPicker(null);
          }}
          onClose={() => setEmojiPicker(null)}
        />
      )}

      {/* Emoji picker for message input */}
      {inputEmojiPicker && (
        <EmojiPicker
          x={inputEmojiPicker.x}
          y={inputEmojiPicker.y}
          onSelect={(emoji) => {
            setInput((prev) => prev + emoji);
            inputRef.current?.focus();
          }}
          onClose={() => setInputEmojiPicker(null)}
        />
      )}

      {/* Mini profile popover */}
      {profilePopover && (
        <MiniProfilePopover
          userId={profilePopover.userId}
          x={profilePopover.x}
          y={profilePopover.y}
          onClose={() => setProfilePopover(null)}
          onViewFull={() => {
            setFullProfileUserId(profilePopover.userId);
            setProfilePopover(null);
          }}
        />
      )}

      {/* Full profile modal */}
      {fullProfileUserId && (
        <ProfileModal
          userId={fullProfileUserId}
          onClose={() => setFullProfileUserId(null)}
        />
      )}
    </div>
  );
}
