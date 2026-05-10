import { useVoiceStore } from "../stores/voice";
import { useGuildStore } from "../stores/guild";

export default function VoicePanel() {
  const connected = useVoiceStore((s) => s.connected);
  const connecting = useVoiceStore((s) => s.connecting);
  const channelId = useVoiceStore((s) => s.channelId);
  const selfMute = useVoiceStore((s) => s.selfMute);
  const selfDeaf = useVoiceStore((s) => s.selfDeaf);
  const leaveChannel = useVoiceStore((s) => s.leaveChannel);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);

  const allChannels = useGuildStore((s) => s.channels);
  const activeGuildId = useGuildStore((s) => s.activeGuildId);

  if (!connected && !connecting) return null;

  const guildChannels = activeGuildId ? allChannels[activeGuildId] : undefined;
  const channel = guildChannels?.find((c) => c.id === channelId);
  const channelName = channel?.name || "Voice Channel";

  return (
    <div className="shrink-0 border-t border-dark-950 bg-dark-850 px-3 py-2">
      {/* Connection status */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${connecting ? "animate-pulse bg-yellow-500" : "bg-green-500"}`} />
          <span className="text-xs font-medium text-green-400">
            {connecting ? "Connecting..." : "Voice Connected"}
          </span>
        </div>
        <button
          onClick={leaveChannel}
          className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:text-red-400"
          title="Disconnect"
        >
          {/* Phone hangup icon */}
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
          </svg>
        </button>
      </div>

      {/* Channel name */}
      <div className="mb-2 flex items-center gap-1.5">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-current text-slate-500">
          <path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z" />
        </svg>
        <span className="truncate text-xs text-slate-300">{channelName}</span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={toggleMute}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
            selfMute
              ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
              : "bg-dark-700 text-slate-300 hover:bg-dark-600"
          }`}
          title={selfMute ? "Unmute" : "Mute"}
        >
          {selfMute ? (
            // Mic off
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
            </svg>
          ) : (
            // Mic on
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
            </svg>
          )}
        </button>

        <button
          onClick={toggleDeafen}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
            selfDeaf
              ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
              : "bg-dark-700 text-slate-300 hover:bg-dark-600"
          }`}
          title={selfDeaf ? "Undeafen" : "Deafen"}
        >
          {selfDeaf ? (
            // Headphones off
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M4.34 2.93L2.93 4.34 7.29 8.7 7 9H3v6h4l5 5v-6.59l4.18 4.18c-.65.49-1.38.88-2.18 1.11v2.06a8.94 8.94 0 0 0 3.61-1.75l2.05 2.05 1.41-1.41L4.34 2.93zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zm-7-8l-1.88 1.88L12 7.76zm4.5 8A4.5 4.5 0 0 0 14 7.97v1.79l2.48 2.48c.01-.08.02-.16.02-.24z" />
            </svg>
          ) : (
            // Headphones on
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
