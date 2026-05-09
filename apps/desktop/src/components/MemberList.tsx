interface Member {
  id: string;
  username: string;
  status: "online" | "idle" | "dnd" | "offline";
  role?: string;
}

interface MemberListProps {
  members: Member[];
}

const statusColors: Record<string, string> = {
  online: "bg-green-500",
  idle: "bg-yellow-500",
  dnd: "bg-red-500",
  offline: "bg-slate-500",
};

const statusLabels: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  offline: "Offline",
};

export default function MemberList({ members }: MemberListProps) {
  const online = members.filter((m) => m.status !== "offline");
  const offline = members.filter((m) => m.status === "offline");

  function renderGroup(title: string, list: Member[]) {
    if (list.length === 0) return null;
    return (
      <div className="mb-4">
        <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title} - {list.length}
        </h3>
        {list.map((member) => (
          <button
            key={member.id}
            className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-dark-800"
          >
            <div className="relative">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white ${
                  member.status === "offline"
                    ? "bg-dark-700 text-slate-400"
                    : "bg-nexe-700"
                }`}
              >
                {member.username.charAt(0).toUpperCase()}
              </div>
              <div
                className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-dark-850 ${statusColors[member.status]}`}
                title={statusLabels[member.status]}
              />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p
                className={`truncate text-sm font-medium ${
                  member.status === "offline"
                    ? "text-slate-500"
                    : "text-slate-200"
                }`}
              >
                {member.username}
              </p>
              {member.role && (
                <p className="truncate text-xs text-slate-500">{member.role}</p>
              )}
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full w-60 shrink-0 flex-col bg-dark-850 border-l border-dark-900">
      <div className="flex-1 overflow-y-auto px-2 py-4">
        {renderGroup("Online", online)}
        {renderGroup("Offline", offline)}
      </div>
    </div>
  );
}
