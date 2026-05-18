import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useDMStore } from "../stores/dm";
import { useAuthStore } from "../stores/auth";
import { useGuildStore } from "../stores/guild";
import { userColor, formatTimestamp } from "../lib/utils";
import { api, type DMMessage, type ReactionGroup } from "../lib/api";
import { toast } from "@nexe/ui";
import MessageContent from "./MessageContent";
import DMUserPanel from "./DMUserPanel";
import EmotePicker from "./EmotePicker";
import GifPicker from "./GifPicker";

export default function DMChat() {
  const activeChannelId = useDMStore((s) => s.activeChannelId);
  const allMessages = useDMStore((s) => s.messages);
  const channels = useDMStore((s) => s.channels);
  const sendMessage = useDMStore((s) => s.sendMessage);
  const editMessage = useDMStore((s) => s.editMessage);
  const deleteMessage = useDMStore((s) => s.deleteMessage);
  const ackChannel = useDMStore((s) => s.ackChannel);
  const typingState = useDMStore((s) => activeChannelId ? s.typing[activeChannelId] : undefined);
  const myId = useAuthStore((s) => s.user?.id) ?? "";
  const usernames = useGuildStore((s) => s.usernames);
  const avatarMap = useGuildStore((s) => s.avatarMap);
  const presenceMap = useGuildStore((s) => s.presenceMap);

  const messages = activeChannelId ? allMessages[activeChannelId] || [] : [];
  const channel = channels.find((c) => c.id === activeChannelId);
  const isGroup = channel?.type === "group_dm";
  const otherUser = channel?.participants?.find((p) => p.userId !== myId);
  const channelName = isGroup
    ? (channel?.name || channel?.participants?.filter((p) => p.userId !== myId).map((p) => usernames[p.userId] || "User").join(", ") || "Group")
    : (otherUser ? (usernames[otherUser.userId] || "Unknown") : "Unknown");

  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [showMembers, setShowMembers] = useState(false);
  const [replyTo, setReplyTo] = useState<DMMessage | null>(null);
  const [messageReactions, setMessageReactions] = useState<Record<string, ReactionGroup[]>>({});
  const [emojiPicker, setEmojiPicker] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const [dmGifPicker, setDmGifPicker] = useState<{ x: number; y: number } | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);

  // Mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionMapRef = useRef<Map<string, string>>(new Map());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get participants for mention autocomplete
  const participants = channel?.participants || [];
  const mentionSuggestions = mentionQuery !== null
    ? participants
        .filter((p) => p.userId !== myId)
        .filter((p) => {
          const name = usernames[p.userId] || "";
          return name.toLowerCase().includes(mentionQuery.toLowerCase());
        })
        .slice(0, 8)
    : [];

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Focus input and ack when channel changes
  useEffect(() => {
    inputRef.current?.focus();
    if (activeChannelId) ackChannel(activeChannelId);
    // Reset state on channel change
    setReplyTo(null);
    setEditingId(null);
    setPendingFile(null);
    setPendingPreview(null);
    setMessageReactions({});
    setMentionQuery(null);
    setPlusMenuOpen(false);
  }, [activeChannelId, ackChannel]);

  // Batch-fetch reactions when messages load
  useEffect(() => {
    if (!messages.length) return;
    const toFetch = messages.filter((m) => !(m.id in messageReactions)).slice(0, 50);
    if (toFetch.length === 0) return;
    let cancelled = false;
    (async () => {
      const batches: DMMessage[][] = [];
      for (let i = 0; i < toFetch.length; i += 5) batches.push(toFetch.slice(i, i + 5));
      for (const batch of batches) {
        if (cancelled) break;
        const results = await Promise.allSettled(batch.map((m) => api.getDMReactions(m.id)));
        if (cancelled) break;
        const updates: Record<string, ReactionGroup[]> = {};
        results.forEach((r, idx) => {
          updates[batch[idx].id] = r.status === "fulfilled" && Array.isArray(r.value) ? r.value : [];
        });
        setMessageReactions((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => { cancelled = true; };
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for DM reaction WS events
  useEffect(() => {
    function handleReactionEvent(e: Event) {
      const { messageId, channelId, emoji, userId, type } = (e as CustomEvent).detail;
      if (channelId !== activeChannelId) return;
      setMessageReactions((prev) => {
        const groups = [...(prev[messageId] || [])];
        const idx = groups.findIndex((g) => g.emoji === emoji);
        if (type === "add") {
          if (idx >= 0) {
            if (!groups[idx].users.includes(userId)) {
              groups[idx] = { ...groups[idx], count: groups[idx].count + 1, users: [...groups[idx].users, userId] };
            }
          } else {
            groups.push({ emoji, count: 1, users: [userId] });
          }
        } else {
          if (idx >= 0) {
            const users = groups[idx].users.filter((u: string) => u !== userId);
            if (users.length === 0) groups.splice(idx, 1);
            else groups[idx] = { ...groups[idx], count: users.length, users };
          }
        }
        return { ...prev, [messageId]: groups };
      });
    }
    window.addEventListener("nexe:dm-reaction", handleReactionEvent);
    return () => window.removeEventListener("nexe:dm-reaction", handleReactionEvent);
  }, [activeChannelId]);

  // Close menus on click
  useEffect(() => {
    const close = () => setPlusMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  async function toggleReaction(messageId: string, emoji: string) {
    const groups = messageReactions[messageId] || [];
    const existing = groups.find((g) => g.emoji === emoji);
    try {
      if (existing?.users.includes(myId)) {
        await api.removeDMReaction(messageId, emoji);
      } else {
        await api.addDMReaction(messageId, emoji);
      }
    } catch {
      toast.error("Failed to toggle reaction");
    }
  }

  function handleEmojiPickerClick(e: React.MouseEvent, messageId: string) {
    e.stopPropagation();
    setEmojiPicker({ messageId, x: e.clientX, y: e.clientY });
  }

  // Mention detection in input
  function handleInputChange(value: string) {
    setInput(value);
    if (!isGroup) { setMentionQuery(null); return; }
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
    setInput(newValue);
    setMentionQuery(null);
    mentionMapRef.current.set(username, userId);
    inputRef.current?.focus();
  }

  function resolveContentMentions(text: string): string {
    let result = text;
    for (const [username, userId] of mentionMapRef.current) {
      result = result.replace(new RegExp(`@${username}\\b`, "g"), `<@${userId}>`);
    }
    return result;
  }

  const handleSend = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    let content = resolveContentMentions(input.trim());
    if (!content && !pendingFile) return;
    if (!activeChannelId) return;

    try {
      // Upload file first if pending
      if (pendingFile) {
        setUploading(true);
        const result = await api.uploadAttachment(pendingFile);
        content = content ? `${content}\n${result.url}` : result.url;
        setPendingFile(null);
        if (pendingPreview) URL.revokeObjectURL(pendingPreview);
        setPendingPreview(null);
        setUploading(false);
      }
      if (!content) return;

      setInput("");
      mentionMapRef.current.clear();
      await sendMessage(activeChannelId, content, replyTo?.id);
      setReplyTo(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    }
  }, [input, activeChannelId, sendMessage, replyTo, pendingFile, pendingPreview]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Mention navigation
    if (mentionQuery !== null && mentionSuggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, mentionSuggestions.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        const s = mentionSuggestions[mentionIndex];
        if (s) insertMention(s.userId, usernames[s.userId] || "User");
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
    // Typing indicator
    if (activeChannelId && !typingTimeout.current) {
      api.dmTyping(activeChannelId).catch(() => {});
      typingTimeout.current = setTimeout(() => { typingTimeout.current = null; }, 3000);
    }
  }

  async function handleEdit(msgId: string) {
    if (!editContent.trim()) return;
    try {
      await editMessage(msgId, editContent.trim());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to edit");
    }
    setEditingId(null);
  }

  async function handleDelete(msgId: string) {
    try {
      await deleteMessage(msgId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  if (!activeChannelId) return null;

  const STATUS_DOT: Record<string, string> = {
    online: "bg-green-500", idle: "bg-yellow-500", dnd: "bg-red-500", offline: "bg-slate-500",
  };

  return (
    <div className="flex h-full flex-1 flex-col bg-dark-900">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-dark-700 px-4">
        <span className="text-slate-400">{isGroup ? "#" : "@"}</span>
        <span className="font-semibold text-sm text-white">{channelName}</span>
        {isGroup ? (
          <>
            <span className="text-xs text-slate-500">{channel?.participants?.length ?? 0} members</span>
            <button
              onClick={() => setShowMembers(!showMembers)}
              className={`ml-auto flex h-7 w-7 items-center justify-center rounded transition-colors ${
                showMembers ? "text-white bg-dark-700" : "text-slate-400 hover:text-slate-200"
              }`}
              title="Toggle member list"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                <path d="M16.5 13c1.3 0 2.4.4 3.2 1.1A5.5 5.5 0 0 1 22 18.5V20h-4v-1.5a4 4 0 0 0-1.5-3.1zm-9 0C4.6 13 2 14.6 2 18.5V20h12v-1.5C14 14.6 11.4 13 7.5 13zM7.5 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm9-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
              </svg>
            </button>
          </>
        ) : (
          <button
            onClick={() => setShowMembers(!showMembers)}
            className={`ml-auto flex h-7 w-7 items-center justify-center rounded transition-colors ${
              showMembers ? "text-white bg-dark-700" : "text-slate-400 hover:text-slate-200"
            }`}
            title="Toggle user info"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          </button>
        )}
      </div>

      {/* Content row: messages+input | optional member sidebar */}
      <div className="flex flex-1 min-h-0">
      {/* Messages column */}
      <div className="flex flex-1 flex-col min-w-0">
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500 animate-fade-in">
            <div
              className="mb-5 flex h-20 w-20 items-center justify-center rounded-full text-3xl font-bold text-white shadow-lg shadow-nexe-500/10"
              style={{ backgroundColor: otherUser ? userColor(otherUser.userId) : "#4f46e5" }}
            >
              {channelName.charAt(0).toUpperCase()}
            </div>
            <p className="text-xl font-bold text-white">{channelName}</p>
            <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-slate-500">
              This is the very beginning of your direct message history with <strong className="text-slate-300">{channelName}</strong>.
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const authorName = usernames[msg.authorId] || "Unknown";
            const authorAvatar = avatarMap[msg.authorId];
            const color = userColor(msg.authorId);
            const isOwn = msg.authorId === myId;
            const reactions = messageReactions[msg.id] || [];
            const replyRef = msg.replyToId ? messages.find((m) => m.id === msg.replyToId) : null;

            // Group messages by same author within 5 min
            const prev = idx > 0 ? messages[idx - 1] : null;
            const isGrouped = prev &&
              prev.authorId === msg.authorId &&
              !msg.replyToId &&
              new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < 300000;

            return (
              <div
                key={msg.id}
                id={`dm-msg-${msg.id}`}
                className={`group relative flex gap-3 rounded-md px-2 transition-colors hover:bg-dark-800/40 ${isGrouped ? "py-0.5" : "py-2.5 mt-0.5"}`}
              >
                {/* Avatar or spacer */}
                <div className="w-10 shrink-0">
                  {!isGrouped && (
                    authorAvatar ? (
                      <img src={authorAvatar} alt={authorName} className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white select-none"
                        style={{ backgroundColor: color }}
                      >
                        {authorName.charAt(0).toUpperCase()}
                      </div>
                    )
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Reply reference */}
                  {replyRef && (
                    <button
                      onClick={() => {
                        const el = document.getElementById(`dm-msg-${replyRef.id}`);
                        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      className="mb-0.5 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                    >
                      <svg className="h-3 w-3 rotate-180 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v4M3 10l6 6m-6-6l6-6" />
                      </svg>
                      <span className="font-medium" style={{ color: userColor(replyRef.authorId) }}>
                        {usernames[replyRef.authorId] || "Unknown"}
                      </span>
                      <span className="truncate max-w-xs">{replyRef.content}</span>
                    </button>
                  )}

                  {!isGrouped && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-white">{authorName}</span>
                      <span className="text-[11px] text-slate-500">{formatTimestamp(msg.createdAt)}</span>
                    </div>
                  )}

                  {editingId === msg.id ? (
                    <div className="mt-1">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEdit(msg.id); }
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="w-full rounded bg-dark-800 px-3 py-1.5 text-sm text-slate-200 outline-none resize-none ring-1 ring-nexe-500/50 focus:ring-nexe-500"
                        rows={1}
                        autoFocus
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        Enter to save &middot; Escape to cancel
                      </p>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-300 break-words">
                      <MessageContent content={msg.content} usernames={usernames} currentUserId={myId} />
                      {msg.editedAt && (
                        <span className="ml-1 text-[10px] text-slate-600">(edited)</span>
                      )}
                    </div>
                  )}

                  {/* Reactions row */}
                  {reactions.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {reactions.map((r) => (
                        <button
                          key={r.emoji}
                          onClick={() => toggleReaction(msg.id, r.emoji)}
                          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border transition-colors ${
                            r.users?.includes(myId)
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

                {/* Floating action toolbar (Discord style) */}
                {editingId !== msg.id && (
                  <div className="absolute -top-3 right-2 hidden group-hover:flex items-center gap-0.5 rounded-lg border border-dark-600 bg-dark-800 px-1 py-0.5 shadow-xl shadow-black/20">
                    <ActionBtn onClick={(e) => handleEmojiPickerClick(e, msg.id)} title="Add Reaction">
                      <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </ActionBtn>
                    <ActionBtn onClick={() => setReplyTo(msg)} title="Reply">
                      <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v4M3 10l6 6m-6-6l6-6" />
                      </svg>
                    </ActionBtn>
                    {isOwn && (
                      <ActionBtn onClick={() => { setEditingId(msg.id); setEditContent(msg.content); }} title="Edit">
                        <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </ActionBtn>
                    )}
                    {isOwn && (
                      <ActionBtn onClick={() => handleDelete(msg.id)} title="Delete" danger>
                        <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </ActionBtn>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing indicator */}
      {typingState && (
        <div className="shrink-0 px-6 py-1 animate-fade-in">
          <div className="flex items-center gap-1.5">
            <div className="flex gap-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
            </div>
            <span className="text-xs text-slate-500">
              <strong className="text-slate-400">{usernames[typingState.userId] || "Someone"}</strong> is typing
            </span>
          </div>
        </div>
      )}

      {/* Reply bar */}
      {replyTo && (
        <div className="mx-4 flex items-center gap-2 rounded-t-lg border border-b-0 border-dark-700 bg-dark-800/50 px-3 py-2 animate-slide-up">
          <span className="text-xs text-slate-400">Replying to</span>
          <span className="text-xs font-medium" style={{ color: userColor(replyTo.authorId) }}>
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

      {/* Message Input */}
      <div className="shrink-0 px-4 pb-4">
        {/* Mention autocomplete */}
        {mentionQuery !== null && mentionSuggestions.length > 0 && (
          <div className="mb-1 overflow-hidden rounded-lg border border-dark-700 bg-dark-800 shadow-xl animate-slide-up">
            {mentionSuggestions.map((p, i) => {
              const name = usernames[p.userId] || "User";
              return (
                <button
                  key={p.userId}
                  onClick={() => insertMention(p.userId, name)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors ${i === mentionIndex ? "bg-nexe-500/20 text-white" : "text-slate-300 hover:bg-dark-700"}`}
                >
                  {avatarMap[p.userId] ? (
                    <img src={avatarMap[p.userId]} alt={name} className="h-6 w-6 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-dark-600 text-xs font-semibold">
                      {name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span>{name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Pending file preview */}
        {pendingFile && (
          <div className={`flex items-center gap-3 border border-b-0 border-dark-700 bg-dark-800/80 px-3 py-2 ${replyTo ? "" : "rounded-t-lg"}`}>
            {pendingPreview ? (
              <img src={pendingPreview} alt="" className="h-16 w-16 rounded object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded bg-dark-700 text-slate-400">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-slate-200">{pendingFile.name}</p>
              <p className="text-xs text-slate-500">{(pendingFile.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            {uploading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-dark-600 border-t-nexe-500" />
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (pendingPreview) URL.revokeObjectURL(pendingPreview);
                  setPendingFile(null);
                  setPendingPreview(null);
                }}
                className="rounded p-1 text-slate-500 hover:bg-dark-700 hover:text-white"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSend}>
          <div className={`bg-dark-800 px-4 ring-1 ring-dark-700 transition-all focus-within:ring-nexe-500/40 ${replyTo || pendingFile ? "rounded-b-xl" : "rounded-xl"}`}>
            <div className="flex items-end">
              {/* Hidden file input */}
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*,video/*,.pdf,.txt,.zip,.json,.mp3,.ogg,.wav"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  e.target.value = "";
                  setPendingFile(file);
                  if (file.type.startsWith("image/")) setPendingPreview(URL.createObjectURL(file));
                  else setPendingPreview(null);
                  setPlusMenuOpen(false);
                  inputRef.current?.focus();
                }}
              />
              {/* Plus menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setPlusMenuOpen((v) => !v); }}
                  className="mr-1 rounded p-1.5 text-slate-400 transition-colors hover:bg-dark-700 hover:text-white"
                  title="Actions"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
                {plusMenuOpen && (
                  <div className="absolute bottom-full left-0 mb-1 w-44 rounded-lg border border-dark-700 bg-dark-800 py-1 shadow-xl animate-slide-up">
                    <button
                      type="button"
                      onClick={() => { fileInputRef.current?.click(); setPlusMenuOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-slate-300 hover:bg-dark-700 hover:text-white"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                      Upload File
                    </button>
                  </div>
                )}
              </div>

              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Message ${isGroup ? channelName : "@" + channelName}`}
                className="flex-1 resize-none bg-transparent py-3 text-sm text-slate-200 outline-none placeholder:text-slate-500 max-h-36"
                rows={1}
                maxLength={2000}
                style={{ height: "auto", minHeight: "20px" }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 144) + "px";
                }}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (dmGifPicker) { setDmGifPicker(null); } else {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setDmGifPicker({ x: rect.right, y: rect.top - 4 });
                  }
                }}
                className="ml-1 rounded p-1.5 text-slate-400 transition-colors hover:bg-dark-700 hover:text-white"
                title="GIF"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.5 9H13v6h-1.5zM9 9H6c-.6 0-1 .5-1 1v4c0 .5.4 1 1 1h3c.6 0 1-.5 1-1V9zm-.5 4.5h-2v-3h2zm8.5-3c-.3 0-.5.2-.5.5v3c0 .3.2.5.5.5h2c.3 0 .5-.2.5-.5v-1h-1v.5h-1v-2h1v.5h1v-1c0-.6-.5-1-1-1zM2 5v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2zm18 14H4V5h16z"/>
                </svg>
              </button>
            </div>
          </div>
          {input.length > 1800 && (
            <span className={`block mt-1 text-right text-[10px] font-medium ${input.length > 1950 ? "text-red-400" : "text-slate-500"}`}>
              {2000 - input.length}
            </span>
          )}
        </form>
      </div>
      </div>{/* end messages column */}

      {/* Group DM Member Sidebar */}
      {isGroup && showMembers && channel?.participants && (
        <div className="w-52 shrink-0 border-l border-dark-700 overflow-y-auto p-3">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Members — {channel.participants.length}
          </h4>
          <div className="space-y-0.5">
            {channel.participants.map((p) => {
              const name = usernames[p.userId] || "User";
              const avatar = avatarMap[p.userId];
              const status = presenceMap[p.userId] || "offline";
              const color = userColor(p.userId);
              const isOwner = channel.ownerId === p.userId;
              return (
                <div key={p.userId} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-dark-800/50">
                  <div className="relative shrink-0">
                    {avatar ? (
                      <img src={avatar} alt={name} className="h-7 w-7 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: color }}>
                        {name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-dark-900 ${STATUS_DOT[status] || STATUS_DOT.offline}`} />
                  </div>
                  <span className="flex-1 truncate text-xs text-slate-300">{name}</span>
                  {isOwner && (
                    <span title="Owner">
                      <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 fill-yellow-500">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 1-on-1 DM User Info Panel */}
      {!isGroup && showMembers && otherUser && (
        <DMUserPanel userId={otherUser.userId} />
      )}
      </div>{/* end content row */}

      {/* Emoji Picker for reactions */}
      {emojiPicker && (
        <EmotePicker
          x={emojiPicker.x}
          y={emojiPicker.y}
          onSelect={async (emoji) => {
            await api.addDMReaction(emojiPicker.messageId, emoji).catch(() => {});
            setEmojiPicker(null);
          }}
          onClose={() => setEmojiPicker(null)}
        />
      )}
      {dmGifPicker && (
        <GifPicker
          x={dmGifPicker.x}
          y={dmGifPicker.y}
          onSelect={(gif) => {
            const url = gif.images.original?.url || gif.images.fixed_height?.url;
            if (url && activeChannelId) {
              sendMessage(activeChannelId, url);
            }
          }}
          onClose={() => setDmGifPicker(null)}
        />
      )}
    </div>
  );
}

function ActionBtn({ onClick, title, danger, children }: {
  onClick: (e: React.MouseEvent) => void;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-all duration-100 ${
        danger
          ? "text-slate-400 hover:bg-red-500/15 hover:text-red-400"
          : "text-slate-400 hover:bg-dark-600 hover:text-white"
      }`}
      title={title}
    >
      {children}
    </button>
  );
}
