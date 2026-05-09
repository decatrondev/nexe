import { useGuildStore } from "../stores/guild";

function formatJoinDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function MemberList() {
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const members = useGuildStore((s) =>
    activeGuildId ? (s.members[activeGuildId] || []) : [],
  );
  const usernames = useGuildStore((s) => s.usernames);

  if (!activeGuildId) {
    return (
      <div className="flex h-full w-60 shrink-0 flex-col bg-dark-850 border-l border-dark-900">
        <div className="flex-1 overflow-y-auto px-2 py-4">
          <p className="px-2 text-center text-sm text-slate-500">
            No server selected
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-60 shrink-0 flex-col bg-dark-850 border-l border-dark-900">
      <div className="flex-1 overflow-y-auto px-2 py-4">
        <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Members - {members.length}
        </h3>
        {members.map((member) => {
          const name = member.nickname || usernames[member.userId] || "Unknown";
          return (
            <button
              key={member.id}
              className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-dark-800"
            >
              <div className="relative">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-nexe-700 text-xs font-semibold text-white">
                  {name.charAt(0).toUpperCase()}
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-dark-850 bg-green-500" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium text-slate-200">
                  {name}
                </p>
                <p className="truncate text-xs text-slate-500">
                  Joined {formatJoinDate(member.joinedAt)}
                </p>
              </div>
            </button>
          );
        })}
        {members.length === 0 && (
          <p className="mt-4 px-2 text-center text-sm text-slate-500">
            No members yet
          </p>
        )}
      </div>
    </div>
  );
}
