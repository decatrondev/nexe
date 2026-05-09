import { useState } from "react";

interface Server {
  id: string;
  name: string;
  iconUrl?: string;
}

interface ServerSidebarProps {
  servers: Server[];
  activeServerId: string | null;
  onSelectServer: (id: string) => void;
}

export default function ServerSidebar({
  servers,
  activeServerId,
  onSelectServer,
}: ServerSidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="flex h-full w-[72px] shrink-0 flex-col items-center gap-2 bg-dark-950 py-3 overflow-y-auto">
      {/* Home / DM button */}
      <button
        className={`group flex h-12 w-12 items-center justify-center rounded-2xl transition-all duration-200 hover:rounded-xl ${
          activeServerId === null
            ? "rounded-xl bg-nexe-500 text-white"
            : "bg-dark-800 text-slate-300 hover:bg-nexe-500 hover:text-white"
        }`}
        onClick={() => onSelectServer("")}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
          <path d="M2.391 8.84a.5.5 0 0 1 .158-.457l9-8a.5.5 0 0 1 .662 0l9 8a.5.5 0 0 1 .158.457l-1.5 11a.5.5 0 0 1-.496.434H14.5v-5a2.5 2.5 0 1 0-5 0v5H4.73a.5.5 0 0 1-.497-.434z" />
        </svg>
      </button>

      {/* Divider */}
      <div className="mx-auto h-0.5 w-8 rounded-full bg-dark-800" />

      {/* Server list */}
      {servers.map((server) => {
        const isActive = activeServerId === server.id;
        const isHovered = hoveredId === server.id;
        return (
          <div key={server.id} className="relative">
            {/* Active / hover indicator pill */}
            <div
              className={`absolute -left-1 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-white transition-all duration-200 ${
                isActive ? "h-10" : isHovered ? "h-5" : "h-0"
              }`}
            />
            <button
              className={`flex h-12 w-12 items-center justify-center transition-all duration-200 ${
                isActive
                  ? "rounded-xl bg-nexe-500 text-white"
                  : "rounded-2xl bg-dark-800 text-slate-300 hover:rounded-xl hover:bg-nexe-500 hover:text-white"
              }`}
              onMouseEnter={() => setHoveredId(server.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelectServer(server.id)}
              title={server.name}
            >
              {server.iconUrl ? (
                <img
                  src={server.iconUrl}
                  alt={server.name}
                  className="h-12 w-12 rounded-[inherit] object-cover"
                />
              ) : (
                <span className="text-sm font-semibold">
                  {server.name.charAt(0).toUpperCase()}
                </span>
              )}
            </button>
          </div>
        );
      })}

      {/* Add server button */}
      <button className="flex h-12 w-12 items-center justify-center rounded-2xl bg-dark-800 text-green-500 transition-all duration-200 hover:rounded-xl hover:bg-green-600 hover:text-white">
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6 fill-current"
        >
          <path d="M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6z" />
        </svg>
      </button>
    </div>
  );
}
