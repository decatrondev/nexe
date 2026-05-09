import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useGuildStore } from "../stores/guild";

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHours < 24) {
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return `Today at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  }) + ` at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

// Generate a stable color from a user ID
function userColor(userId: string): string {
  const colors = [
    "#a78bfa", "#34d399", "#f472b6", "#60a5fa", "#fbbf24",
    "#fb923c", "#c084fc", "#2dd4bf", "#f87171", "#a3e635",
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

export default function ChatArea() {
  const activeChannelId = useGuildStore((s) => s.activeChannelId);
  const messages = useGuildStore((s) =>
    activeChannelId ? (s.messages[activeChannelId] || []) : [],
  );
  const channels = useGuildStore((s) => s.channels);
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const usernames = useGuildStore((s) => s.usernames);
  const sendMessage = useGuildStore((s) => s.sendMessage);
  const loadMoreMessages = useGuildStore((s) => s.loadMoreMessages);
  const hasMore = useGuildStore((s) =>
    activeChannelId ? (s.hasMoreMessages[activeChannelId] ?? false) : false,
  );

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // Find the channel name
  const guildChannels = activeGuildId ? (channels[activeGuildId] || []) : [];
  const activeChannel = guildChannels.find((c) => c.id === activeChannelId);
  const channelName = activeChannel?.name || "general";

  // Auto-scroll to bottom when new messages arrive at the end
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    const newCount = messages.length;
    prevMessageCountRef.current = newCount;

    // Only auto-scroll if messages were added at the end (not prepended via load more)
    if (newCount > prevCount && prevCount > 0) {
      const diff = newCount - prevCount;
      // If we added a small number, it's likely new messages at the bottom
      if (diff <= 5) {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } else if (prevCount === 0 && newCount > 0) {
      // Initial load
      messagesEndRef.current?.scrollIntoView();
    }
  }, [messages.length]);

  // Handle scroll to top for pagination
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el || loadingMore || !hasMore) return;
    if (el.scrollTop < 100) {
      setLoadingMore(true);
      const prevScrollHeight = el.scrollHeight;
      loadMoreMessages().finally(() => {
        setLoadingMore(false);
        // Preserve scroll position
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const newScrollHeight = scrollContainerRef.current.scrollHeight;
            scrollContainerRef.current.scrollTop = newScrollHeight - prevScrollHeight;
          }
        });
      });
    }
  }, [loadingMore, hasMore, loadMoreMessages]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const content = input.trim();
    if (!content || sending) return;
    setInput("");
    setSending(true);
    try {
      await sendMessage(content);
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      console.error("Failed to send message:", err);
      setInput(content); // Restore on failure
    } finally {
      setSending(false);
    }
  }

  if (!activeChannelId) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center bg-dark-850">
        <div className="text-center">
          <div className="mb-4 text-6xl text-slate-700">#</div>
          <h2 className="text-xl font-semibold text-slate-300">
            Select a channel
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Pick a channel from the sidebar to start chatting
          </p>
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
            <span className="truncate text-xs text-slate-500">
              {activeChannel.topic}
            </span>
          </>
        )}
      </div>

      {/* Messages */}
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
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="mb-3 text-5xl text-slate-700">#</div>
            <h3 className="text-lg font-semibold text-slate-300">
              Welcome to #{channelName}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              No messages yet. Be the first to say something!
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const prevMsg = idx > 0 ? messages[idx - 1] : null;
            const isGrouped = prevMsg?.authorId === msg.authorId;
            const authorName = usernames[msg.authorId] || "Unknown";
            const color = userColor(msg.authorId);

            return (
              <div
                key={msg.id}
                className={`group flex gap-4 rounded px-2 py-0.5 hover:bg-dark-800/30 ${!isGrouped ? "mt-3" : ""}`}
              >
                {/* Avatar column */}
                <div className="w-10 shrink-0">
                  {!isGrouped && (
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
                      style={{ backgroundColor: color + "33" }}
                    >
                      <span style={{ color }}>
                        {authorName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  {!isGrouped && (
                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-sm font-semibold"
                        style={{ color }}
                      >
                        {authorName}
                      </span>
                      <span className="text-xs text-slate-500">
                        {formatTimestamp(msg.createdAt)}
                      </span>
                    </div>
                  )}
                  <p className="text-sm leading-relaxed text-slate-200 break-words">
                    {msg.content}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message input */}
      <div className="shrink-0 px-4 pb-4">
        <form onSubmit={handleSubmit}>
          <div className="flex items-center rounded-lg bg-dark-800 px-4">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message #${channelName}`}
              className="flex-1 bg-transparent py-3 text-sm text-slate-200 outline-none placeholder:text-slate-500"
              disabled={sending}
            />
          </div>
        </form>
      </div>
    </div>
  );
}
