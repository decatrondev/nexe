import { useEffect, useRef, useState, type FormEvent } from "react";
import { useGuildStore } from "../stores/guild";
import { type Message } from "../lib/api";
import { userColor, formatTimestamp, getRoleColor } from "../lib/utils";
import MessageContent from "./MessageContent";
import { SkeletonMessage } from "@nexe/ui";

interface Props {
  parentMessageId: string;
  onClose: () => void;
}

export default function ThreadPanel({ parentMessageId, onClose }: Props) {
  const threadMessages = useGuildStore((s) => s.threadMessages[parentMessageId]) ?? [];
  const allMessages = useGuildStore((s) => s.messages);
  const usernames = useGuildStore((s) => s.usernames);
  const memberRoles = useGuildStore((s) => s.memberRoles);
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const roles = useGuildStore((s) => activeGuildId ? s.roles[activeGuildId] : undefined) ?? [];
  const sendThreadMessage = useGuildStore((s) => s.sendThreadMessage);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Find parent message across all channel messages
  const parentMessage = (() => {
    for (const channelMsgs of Object.values(allMessages)) {
      const found = channelMsgs.find((m) => m.id === parentMessageId);
      if (found) return found;
    }
    return null;
  })();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threadMessages.length]);

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      await sendThreadMessage(input.trim());
      setInput("");
    } catch (err) {
      console.error("Failed to send thread message:", err);
    } finally {
      setSending(false);
    }
  }

  function renderMessage(msg: Message, i: number) {
    const authorName = usernames[msg.authorId] || "User";
    const roleColor = getRoleColor(msg.authorId, memberRoles, roles);
    const color = roleColor || userColor(msg.authorId);
    // Group with previous message if same author within 5 min
    const prev = i > 0 ? threadMessages[i - 1] : null;
    const grouped = prev && prev.authorId === msg.authorId &&
      new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < 300000;

    if (grouped) {
      return (
        <div key={msg.id} className="group flex gap-3 px-4 py-0.5 hover:bg-dark-800/30">
          <div className="w-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <MessageContent content={msg.content} />
          </div>
        </div>
      );
    }

    return (
      <div key={msg.id} className="group flex gap-3 px-4 pt-2 pb-0.5 hover:bg-dark-800/30">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {authorName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold" style={{ color }}>{authorName}</span>
            <span className="text-[10px] text-slate-500">{formatTimestamp(msg.createdAt)}</span>
          </div>
          <MessageContent content={msg.content} />
        </div>
      </div>
    );
  }

  const parentAuthor = parentMessage ? (usernames[parentMessage.authorId] || "User") : "User";
  const loading = threadMessages.length === 0 && !parentMessage;

  return (
    <div className="flex h-full w-96 shrink-0 flex-col border-l border-dark-700 bg-dark-900">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-dark-700 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-white">Thread</h3>
          <p className="truncate text-xs text-slate-500">
            {parentMessage ? `Started by ${parentAuthor}` : "Loading..."}
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-dark-800 hover:text-white"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Parent message preview */}
      {parentMessage && (
        <div className="shrink-0 border-b border-dark-700 bg-dark-800/50 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-slate-300">{parentAuthor}</span>
            <span className="text-[10px] text-slate-500">{formatTimestamp(parentMessage.createdAt)}</span>
          </div>
          <p className="mt-0.5 line-clamp-3 text-xs text-slate-400">{parentMessage.content}</p>
        </div>
      )}

      {/* Thread messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="space-y-1 py-2">
            <SkeletonMessage />
            <SkeletonMessage />
          </div>
        ) : threadMessages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-slate-500">No replies yet. Start the conversation!</p>
          </div>
        ) : (
          threadMessages.map((msg, i) => renderMessage(msg, i))
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-dark-700 p-3">
        <div className="flex items-center gap-2 rounded-lg bg-dark-800 px-3 py-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Reply in thread..."
            className="flex-1 bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="flex h-7 w-7 items-center justify-center rounded-md text-nexe-400 transition-colors hover:text-nexe-300 disabled:text-slate-600"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
