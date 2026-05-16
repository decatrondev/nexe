import { useEffect, useState } from "react";
import { ConnectionQuality } from "livekit-client";
import { useVoiceStore } from "../stores/voice";
import { useGuildStore } from "../stores/guild";

export default function VoicePanel() {
  const connected = useVoiceStore((s) => s.connected);
  const connecting = useVoiceStore((s) => s.connecting);
  const channelId = useVoiceStore((s) => s.channelId);
  const selfMute = useVoiceStore((s) => s.selfMute);
  const selfDeaf = useVoiceStore((s) => s.selfDeaf);
  const room = useVoiceStore((s) => s.room);
  const cameraEnabled = useVoiceStore((s) => s.cameraEnabled);
  const screenShareEnabled = useVoiceStore((s) => s.screenShareEnabled);
  const leaveChannel = useVoiceStore((s) => s.leaveChannel);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const toggleCamera = useVoiceStore((s) => s.toggleCamera);
  const toggleScreenShare = useVoiceStore((s) => s.toggleScreenShare);

  const allChannels = useGuildStore((s) => s.channels);
  const activeGuildId = useGuildStore((s) => s.activeGuildId);

  const [showSettings, setShowSettings] = useState(false);
  const [quality, setQuality] = useState<"excellent" | "good" | "poor">("excellent");
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState("");
  const [selectedOutput, setSelectedOutput] = useState("");

  // Connection quality monitoring
  useEffect(() => {
    if (!connected || !room) return;
    const interval = setInterval(() => {
      const local = room.localParticipant;
      if (!local) return;
      const stats = local.connectionQuality;
      if (stats === ConnectionQuality.Excellent) setQuality("excellent");
      else if (stats === ConnectionQuality.Good) setQuality("good");
      else setQuality("poor");
    }, 3000);
    return () => clearInterval(interval);
  }, [connected, room]);

  // Load audio devices (request permission first to get labels)
  useEffect(() => {
    if (!showSettings) return;
    (async () => {
      try {
        // Briefly request mic access to unlock device labels
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch { /* permission denied — labels will be generic */ }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioDevices(devices.filter((d) => d.kind === "audioinput"));
      setOutputDevices(devices.filter((d) => d.kind === "audiooutput"));
    })();
  }, [showSettings]);

  if (!connected && !connecting) return null;

  const guildChannels = activeGuildId ? allChannels[activeGuildId] : undefined;
  const channel = guildChannels?.find((c) => c.id === channelId);
  const channelName = channel?.name || "Voice Channel";

  const qualityColor = quality === "excellent" ? "bg-green-500" : quality === "good" ? "bg-yellow-500" : "bg-red-500";
  const qualityLabel = quality === "excellent" ? "Excellent" : quality === "good" ? "Good" : "Poor";

  async function switchInput(deviceId: string) {
    setSelectedInput(deviceId);
    if (room?.localParticipant) {
      await room.localParticipant.setMicrophoneEnabled(false);
      await room.switchActiveDevice("audioinput", deviceId);
      if (!selfMute) {
        await room.localParticipant.setMicrophoneEnabled(true);
      }
    }
  }

  async function switchOutput(deviceId: string) {
    setSelectedOutput(deviceId);
    if (room) {
      await room.switchActiveDevice("audiooutput", deviceId);
    }
  }

  return (
    <div className="shrink-0 border-t border-dark-950 bg-dark-850 px-3 py-2">
      {/* Connection status + quality */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${connecting ? "animate-pulse bg-yellow-500" : qualityColor}`} />
          <span className="text-xs font-medium text-green-400">
            {connecting ? "Connecting..." : "Voice Connected"}
          </span>
          {connected && (
            <span className={`text-[10px] ${quality === "excellent" ? "text-green-600" : quality === "good" ? "text-yellow-600" : "text-red-500"}`}>
              {qualityLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Settings gear */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:text-slate-200 ${showSettings ? "text-nexe-400" : ""}`}
            title="Voice Settings"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
            </svg>
          </button>
          {/* Disconnect */}
          <button
            onClick={leaveChannel}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:text-red-400"
            title="Disconnect"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Channel name */}
      <div className="mb-2 flex items-center gap-1.5">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-current text-slate-500">
          <path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z" />
        </svg>
        <span className="truncate text-xs text-slate-300">{channelName}</span>
      </div>

      {/* Voice Settings Panel */}
      {showSettings && (
        <div className="mb-2 space-y-2 rounded-lg border border-dark-700 bg-dark-900 p-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Voice Settings</p>

          {/* Input device */}
          <div>
            <label className="mb-1 block text-[10px] text-slate-500">Input Device</label>
            <select
              value={selectedInput}
              onChange={(e) => switchInput(e.target.value)}
              className="w-full rounded border border-dark-700 bg-dark-800 px-2 py-1 text-[11px] text-slate-300 outline-none"
            >
              <option value="">Default</option>
              {audioDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 8)}`}</option>
              ))}
            </select>
          </div>

          {/* Output device */}
          <div>
            <label className="mb-1 block text-[10px] text-slate-500">Output Device</label>
            <select
              value={selectedOutput}
              onChange={(e) => switchOutput(e.target.value)}
              className="w-full rounded border border-dark-700 bg-dark-800 px-2 py-1 text-[11px] text-slate-300 outline-none"
            >
              <option value="">Default</option>
              {outputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 8)}`}</option>
              ))}
            </select>
          </div>
        </div>
      )}

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
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
            </svg>
          ) : (
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
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M4.34 2.93L2.93 4.34 7.29 8.7 7 9H3v6h4l5 5v-6.59l4.18 4.18c-.65.49-1.38.88-2.18 1.11v2.06a8.94 8.94 0 0 0 3.61-1.75l2.05 2.05 1.41-1.41L4.34 2.93zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zm-7-8l-1.88 1.88L12 7.76zm4.5 8A4.5 4.5 0 0 0 14 7.97v1.79l2.48 2.48c.01-.08.02-.16.02-.24z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z" />
            </svg>
          )}
        </button>

        {/* Camera toggle */}
        <button
          onClick={toggleCamera}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
            cameraEnabled
              ? "bg-nexe-500/20 text-nexe-400 hover:bg-nexe-500/30"
              : "bg-dark-700 text-slate-300 hover:bg-dark-600"
          }`}
          title={cameraEnabled ? "Turn off camera" : "Turn on camera"}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
            {cameraEnabled ? (
              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
            ) : (
              <path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z" />
            )}
          </svg>
        </button>

        {/* Screen share toggle */}
        <button
          onClick={toggleScreenShare}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
            screenShareEnabled
              ? "bg-nexe-500/20 text-nexe-400 hover:bg-nexe-500/30"
              : "bg-dark-700 text-slate-300 hover:bg-dark-600"
          }`}
          title={screenShareEnabled ? "Stop sharing" : "Share screen"}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
            <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
