import { useAuthStore } from "../stores/auth";
import { useGuildStore } from "../stores/guild";
import { useRelationshipStore } from "../stores/relationships";
import { userColor } from "../lib/utils";

const STATUS_DOT: Record<string, string> = {
  online: "bg-green-500", idle: "bg-yellow-500", dnd: "bg-red-500",
};

interface ActiveFriend {
  userId: string;
  status: string;
  streaming?: boolean;
  streamTitle?: string;
  streamGame?: string;
  voiceGuildName?: string;
  voiceChannelName?: string;
}

export default function ActiveNowPanel() {
  const myId = useAuthStore((s) => s.user?.id) ?? "";
  const relationships = useRelationshipStore((s) => s.relationships);
  const presenceMap = useGuildStore((s) => s.presenceMap);
  const usernames = useGuildStore((s) => s.usernames);
  const avatarMap = useGuildStore((s) => s.avatarMap);
  const streamStatusMap = useGuildStore((s) => s.streamStatusMap);
  // Get friend IDs
  const friendIds = relationships
    .filter((r) => r.type === "friend")
    .map((r) => r.userId === myId ? r.targetId : r.userId);

  // Build active friends list
  const activeFriends: ActiveFriend[] = [];

  for (const fid of friendIds) {
    const status = presenceMap[fid];
    if (!status || status === "offline") continue;

    const friend: ActiveFriend = { userId: fid, status };

    // Check if streaming
    const stream = streamStatusMap[fid];
    if (stream?.live) {
      friend.streaming = true;
      friend.streamTitle = stream.title;
      friend.streamGame = stream.game;
    }

    activeFriends.push(friend);
  }

  // Sort: streaming first, then by status (online > idle > dnd)
  const statusOrder: Record<string, number> = { online: 0, idle: 1, dnd: 2 };
  activeFriends.sort((a, b) => {
    if (a.streaming !== b.streaming) return a.streaming ? -1 : 1;
    return (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
  });

  return (
    <div className="flex h-full w-60 shrink-0 flex-col border-l border-dark-700 bg-dark-800 overflow-y-auto">
      <div className="px-4 pt-4 pb-2">
        <h3 className="text-sm font-bold text-white">Active Now</h3>
      </div>

      {activeFriends.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
          <p className="text-sm font-medium text-slate-400">It's quiet for now...</p>
          <p className="mt-1 text-xs text-slate-600">
            When your friends start an activity — like playing a game or streaming — we'll show it here!
          </p>
        </div>
      ) : (
        <div className="px-2 space-y-0.5">
          {activeFriends.map((f) => {
            const name = usernames[f.userId] || "User";
            const avatar = avatarMap[f.userId];
            const color = userColor(f.userId);

            return (
              <div
                key={f.userId}
                className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-dark-700/40 transition-colors"
              >
                {/* Avatar */}
                <div className="relative shrink-0 mt-0.5">
                  {avatar ? (
                    <img src={avatar} alt={name} className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-dark-800 ${STATUS_DOT[f.status] || "bg-slate-500"}`} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <span className="block truncate text-sm font-medium text-white">{name}</span>

                  {f.streaming ? (
                    <div className="mt-0.5">
                      <div className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-[10px] font-semibold uppercase text-red-400">Live</span>
                      </div>
                      {f.streamGame && (
                        <p className="truncate text-[11px] text-slate-500">{f.streamGame}</p>
                      )}
                    </div>
                  ) : f.voiceGuildName ? (
                    <div className="mt-0.5 flex items-center gap-1">
                      <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 fill-green-500">
                        <path d="M12 3a1 1 0 0 0-.707.293l-7 7a1 1 0 0 0 0 1.414l7 7A1 1 0 0 0 13 18v-4.28c3.526.36 5.47 2.03 6.136 3.636a1 1 0 0 0 1.864-.728C20.143 14.07 17.368 11 13 10.29V6a1 1 0 0 0-1-1z" />
                      </svg>
                      <span className="truncate text-[11px] text-slate-500">
                        {f.voiceChannelName} • {f.voiceGuildName}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-600">
                      {f.status === "idle" ? "Idle" : f.status === "dnd" ? "Do Not Disturb" : "Online"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
