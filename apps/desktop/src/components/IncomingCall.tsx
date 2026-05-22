import { useEffect, useState } from "react";
import { useVoiceStore } from "../stores/voice";
import { useGuildStore } from "../stores/guild";
import { useDMStore } from "../stores/dm";
import { useAuthStore } from "../stores/auth";
import { userColor } from "../lib/utils";

/**
 * IncomingCall — Full-screen overlay for incoming DM voice/video calls.
 * Shows caller info, ringtone animation, accept/reject buttons.
 */
export default function IncomingCall() {
  const incomingCall = useVoiceStore((s) => s.incomingCall);
  const acceptDMCall = useVoiceStore((s) => s.acceptDMCall);
  const rejectDMCall = useVoiceStore((s) => s.rejectDMCall);
  const usernames = useGuildStore((s) => s.usernames);
  const avatarMap = useGuildStore((s) => s.avatarMap);
  const myId = useAuthStore((s) => s.user?.id);
  const channels = useDMStore((s) => s.channels);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!incomingCall) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [incomingCall]);

  if (!incomingCall || incomingCall.callerId === myId) return null;

  const callerName = usernames[incomingCall.callerId] || "Unknown";
  const callerAvatar = avatarMap[incomingCall.callerId];
  const channel = channels.find((c) => c.id === incomingCall.channelId);
  const isGroup = channel?.type === "group_dm";
  const channelName = isGroup
    ? (channel?.name || "Group Call")
    : callerName;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="flex flex-col items-center gap-6 rounded-2xl bg-dark-900 border border-dark-700 px-12 py-10 shadow-2xl">
        {/* Ringing animation + avatar */}
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-full bg-green-500/20" style={{ animationDuration: "1.5s" }} />
          <div className="absolute -inset-2 animate-pulse rounded-full border-2 border-green-500/30" style={{ animationDuration: "1.5s" }} />
          {callerAvatar ? (
            <img
              src={callerAvatar}
              alt={callerName}
              className="relative h-24 w-24 rounded-full object-cover ring-4 ring-green-500/40"
            />
          ) : (
            <div
              className="relative flex h-24 w-24 items-center justify-center rounded-full text-3xl font-bold text-white ring-4 ring-green-500/40"
              style={{ backgroundColor: userColor(incomingCall.callerId) }}
            >
              {callerName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Caller info */}
        <div className="text-center">
          <p className="text-lg font-semibold text-white">{channelName}</p>
          <p className="mt-1 text-sm text-slate-400">
            Incoming {incomingCall.video ? "Video" : "Voice"} Call...
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            Ringing {elapsed}s
          </p>
        </div>

        {/* Accept / Reject buttons */}
        <div className="flex items-center gap-6">
          <button
            onClick={() => rejectDMCall(incomingCall.callId)}
            className="group flex flex-col items-center gap-1.5"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition-transform hover:scale-110">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
                <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
              </svg>
            </div>
            <span className="text-[10px] font-medium text-slate-400">Decline</span>
          </button>

          <button
            onClick={() => acceptDMCall(incomingCall.callId)}
            className="group flex flex-col items-center gap-1.5"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition-transform hover:scale-110">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
                <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
              </svg>
            </div>
            <span className="text-[10px] font-medium text-slate-400">Accept</span>
          </button>
        </div>
      </div>
    </div>
  );
}
