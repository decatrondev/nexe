import { useState } from "react";

export interface Channel {
  id: string;
  name: string;
  type: "text" | "voice";
}

export interface Category {
  id: string;
  name: string;
  channels: Channel[];
}

interface ChannelListProps {
  serverName: string;
  categories: Category[];
  activeChannelId: string | null;
  onSelectChannel: (id: string) => void;
  username: string;
  userStatus: "online" | "idle" | "dnd" | "offline";
}

const statusColors: Record<string, string> = {
  online: "bg-green-500",
  idle: "bg-yellow-500",
  dnd: "bg-red-500",
  offline: "bg-slate-500",
};

export default function ChannelList({
  serverName,
  categories,
  activeChannelId,
  onSelectChannel,
  username,
  userStatus,
}: ChannelListProps) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );

  function toggleCategory(catId: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }

  return (
    <div className="flex h-full w-60 shrink-0 flex-col bg-dark-900">
      {/* Server header */}
      <div className="flex h-12 shrink-0 items-center border-b border-dark-950 px-4">
        <h2 className="truncate text-sm font-semibold text-slate-100">
          {serverName}
        </h2>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {categories.map((cat) => {
          const isCollapsed = collapsedCategories.has(cat.id);
          return (
            <div key={cat.id} className="mb-1">
              {/* Category header */}
              <button
                className="flex w-full items-center gap-0.5 px-1 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400 transition-colors hover:text-slate-200"
                onClick={() => toggleCategory(cat.id)}
              >
                <svg
                  viewBox="0 0 24 24"
                  className={`h-3 w-3 fill-current transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                >
                  <path d="M7 10l5 5 5-5z" />
                </svg>
                {cat.name}
              </button>

              {/* Channels */}
              {!isCollapsed &&
                cat.channels.map((ch) => (
                  <button
                    key={ch.id}
                    className={`group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                      activeChannelId === ch.id
                        ? "bg-dark-700/50 text-white"
                        : "text-slate-400 hover:bg-dark-800 hover:text-slate-200"
                    }`}
                    onClick={() => onSelectChannel(ch.id)}
                  >
                    {ch.type === "text" ? (
                      <span className="text-lg leading-none text-slate-500">#</span>
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4 shrink-0 fill-current text-slate-500"
                      >
                        <path d="M12 3a1 1 0 0 0-.707.293l-7 7a1 1 0 0 0 0 1.414l7 7A1 1 0 0 0 13 18v-4.28c3.526.36 5.47 2.03 6.136 3.636a1 1 0 0 0 1.864-.728C20.143 14.07 17.368 11 13 10.29V6a1 1 0 0 0-1-1z" />
                      </svg>
                    )}
                    <span className="truncate">{ch.name}</span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>

      {/* User info bar */}
      <div className="flex shrink-0 items-center gap-2 border-t border-dark-950 bg-dark-950/50 px-2 py-2">
        <div className="relative">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-nexe-600 text-xs font-semibold text-white">
            {username.charAt(0).toUpperCase()}
          </div>
          <div
            className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-dark-950 ${statusColors[userStatus]}`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-200">
            {username}
          </p>
          <p className="truncate text-xs text-slate-500">Online</p>
        </div>
      </div>
    </div>
  );
}
