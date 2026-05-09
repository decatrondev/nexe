import { type FormEvent, useState } from "react";

interface Message {
  id: string;
  author: string;
  authorColor: string;
  content: string;
  timestamp: string;
}

interface ChatAreaProps {
  channelName: string;
  messages: Message[];
}

export default function ChatArea({ channelName, messages }: ChatAreaProps) {
  const [input, setInput] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    // TODO: send message via API
    setInput("");
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-dark-850">
      {/* Channel header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-dark-900 px-4">
        <span className="text-lg text-slate-500">#</span>
        <span className="text-sm font-semibold text-white">{channelName}</span>
      </div>

      {/* Messages */}
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-4">
        {messages.map((msg, idx) => {
          const prevMsg = idx > 0 ? messages[idx - 1] : null;
          const isGrouped = prevMsg?.author === msg.author;

          return (
            <div
              key={msg.id}
              className={`group flex gap-4 rounded px-2 py-0.5 hover:bg-dark-800/30 ${!isGrouped ? "mt-3" : ""}`}
            >
              {/* Avatar column */}
              <div className="w-10 shrink-0">
                {!isGrouped && (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-dark-800 text-sm font-semibold text-slate-300">
                    {msg.author.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                {!isGrouped && (
                  <div className="flex items-baseline gap-2">
                    <span
                      className="text-sm font-semibold"
                      style={{ color: msg.authorColor }}
                    >
                      {msg.author}
                    </span>
                    <span className="text-xs text-slate-500">
                      {msg.timestamp}
                    </span>
                  </div>
                )}
                <p className="text-sm leading-relaxed text-slate-200">
                  {msg.content}
                </p>
              </div>
            </div>
          );
        })}
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
            />
          </div>
        </form>
      </div>
    </div>
  );
}
