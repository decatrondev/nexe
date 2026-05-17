import { useAuthStore } from "../stores/auth";
import { useGuildStore } from "../stores/guild";
import { useDMStore } from "../stores/dm";
import { userColor } from "../lib/utils";
import { toast } from "@nexe/ui";

export default function DMRequestsPage() {
  const myId = useAuthStore((s) => s.user?.id) ?? "";
  const requests = useDMStore((s) => s.requests);
  const acceptRequest = useDMStore((s) => s.acceptRequest);
  const rejectRequest = useDMStore((s) => s.rejectRequest);
  const usernames = useGuildStore((s) => s.usernames);
  const avatarMap = useGuildStore((s) => s.avatarMap);

  function getOtherUser(ch: typeof requests[0]) {
    return ch.participants?.find((p) => p.userId !== myId)?.userId ?? "";
  }

  async function handleAccept(channelId: string) {
    try {
      await acceptRequest(channelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to accept");
    }
  }

  async function handleReject(channelId: string) {
    try {
      await rejectRequest(channelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reject");
    }
  }

  return (
    <div className="flex h-full flex-1 flex-col bg-dark-900">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-dark-700 px-4">
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current text-slate-400">
          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
        </svg>
        <span className="font-semibold text-sm text-white">Message Requests</span>
        <span className="text-xs text-slate-500">{requests.length}</span>
      </div>

      <div className="px-6 pt-4 pb-2">
        <p className="text-sm text-slate-400">
          These are messages from people who aren't your friends and don't share a server with you.
          You can accept to start chatting or reject to dismiss.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4">
        {requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <svg viewBox="0 0 24 24" className="mb-3 h-16 w-16 fill-current opacity-20">
              <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
            </svg>
            <p className="text-sm font-medium text-slate-400">No message requests</p>
          </div>
        ) : (
          requests.map((ch) => {
            const otherId = getOtherUser(ch);
            const name = usernames[otherId] || "Unknown";
            const avatarUrl = avatarMap[otherId];
            const color = userColor(otherId);

            return (
              <div
                key={ch.id}
                className="flex items-center gap-3 rounded-lg border-t border-dark-800/50 px-2 py-3"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt={name} className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white select-none"
                    style={{ backgroundColor: color }}
                  >
                    {name.charAt(0).toUpperCase()}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-white">{name}</span>
                  <span className="text-xs text-slate-500">Wants to message you</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAccept(ch.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-dark-700 text-slate-300 transition-colors hover:text-green-400"
                    title="Accept"
                  >
                    <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 fill-current">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleReject(ch.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-dark-700 text-slate-300 transition-colors hover:text-red-400"
                    title="Reject"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
