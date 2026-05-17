import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useDMStore } from "../stores/dm";
import { useAuthStore } from "../stores/auth";
import { useGuildStore } from "../stores/guild";
import { userColor, formatTimestamp } from "../lib/utils";
import { api } from "../lib/api";
import { toast } from "@nexe/ui";
import MessageContent from "./MessageContent";

export default function DMChat() {
  const activeChannelId = useDMStore((s) => s.activeChannelId);
  const allMessages = useDMStore((s) => s.messages);
  const channels = useDMStore((s) => s.channels);
  const sendMessage = useDMStore((s) => s.sendMessage);
  const editMessage = useDMStore((s) => s.editMessage);
  const deleteMessage = useDMStore((s) => s.deleteMessage);
  const myId = useAuthStore((s) => s.user?.id) ?? "";
  const usernames = useGuildStore((s) => s.usernames);
  const avatarMap = useGuildStore((s) => s.avatarMap);

  const messages = activeChannelId ? allMessages[activeChannelId] || [] : [];
  const channel = channels.find((c) => c.id === activeChannelId);
  const otherUser = channel?.participants?.find((p) => p.userId !== myId);
  const otherName = otherUser ? (usernames[otherUser.userId] || "Unknown") : "Unknown";

  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Focus input when channel changes
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeChannelId]);

  const handleSend = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    const content = input.trim();
    if (!content || !activeChannelId) return;
    setInput("");
    try {
      await sendMessage(activeChannelId, content);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    }
  }, [input, activeChannelId, sendMessage]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
    // Typing indicator
    if (activeChannelId && !typingTimeout.current) {
      api.dmTyping(activeChannelId).catch(() => {});
      typingTimeout.current = setTimeout(() => {
        typingTimeout.current = null;
      }, 3000);
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

  return (
    <div className="flex h-full flex-1 flex-col bg-dark-900">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-dark-700 px-4">
        <span className="text-slate-400">@</span>
        <span className="font-semibold text-sm text-white">{otherName}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <div
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-full text-2xl font-bold text-white"
              style={{ backgroundColor: otherUser ? userColor(otherUser.userId) : "#4f46e5" }}
            >
              {otherName.charAt(0).toUpperCase()}
            </div>
            <p className="text-lg font-semibold text-white">{otherName}</p>
            <p className="mt-1 text-sm">This is the beginning of your direct message history with <strong className="text-slate-300">{otherName}</strong>.</p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const authorName = usernames[msg.authorId] || "Unknown";
            const authorAvatar = avatarMap[msg.authorId];
            const color = userColor(msg.authorId);
            const isOwn = msg.authorId === myId;

            // Group messages by same author within 5 min
            const prev = idx > 0 ? messages[idx - 1] : null;
            const isGrouped = prev &&
              prev.authorId === msg.authorId &&
              new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < 300000;

            return (
              <div
                key={msg.id}
                className={`group flex gap-3 hover:bg-dark-800/30 rounded px-2 ${isGrouped ? "py-0.5" : "py-2 mt-1"}`}
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
                        className="w-full rounded bg-dark-800 px-3 py-1.5 text-sm text-slate-200 outline-none resize-none"
                        rows={1}
                        autoFocus
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        Enter to save, Escape to cancel
                      </p>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-300 break-words">
                      <MessageContent content={msg.content} />
                      {msg.editedAt && (
                        <span className="ml-1 text-[10px] text-slate-600">(edited)</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Hover actions */}
                {isOwn && editingId !== msg.id && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setEditingId(msg.id); setEditContent(msg.content); }}
                      className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:text-slate-300 hover:bg-dark-700"
                      title="Edit"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                        <path d="M16.474 5.408l2.118 2.117m-.756-3.982L12.109 9.27a2.118 2.118 0 0 0-.58 1.082L11 13l2.648-.53c.41-.082.786-.283 1.082-.579l5.727-5.727a1.853 1.853 0 1 0-2.621-2.621z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(msg.id)}
                      className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:text-red-400 hover:bg-dark-700"
                      title="Delete"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                        <path d="M9 3v1H4v2h1v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3H9zm0 5h2v9H9V8zm4 0h2v9h-2V8z" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="shrink-0 px-4 pb-4">
        <div className="flex items-end rounded-lg bg-dark-800 px-4 py-2.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message @${otherName}`}
            className="flex-1 resize-none bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
            rows={1}
            maxLength={2000}
          />
        </div>
      </form>
    </div>
  );
}
