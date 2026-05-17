import { useEffect, useRef, useState } from "react";
import { Track } from "livekit-client";
import { useVoiceStore } from "../stores/voice";
import { useGuildStore } from "../stores/guild";

/**
 * FloatingVoice — Persistent mini video player that shows when you navigate
 * away from the voice channel (like Discord's floating PiP).
 *
 * Lives outside the route tree so it never unmounts while connected.
 */
export default function FloatingVoice() {
  const connected = useVoiceStore((s) => s.connected);
  const room = useVoiceStore((s) => s.room);
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const voiceGuildId = useVoiceStore((s) => s.guildId);
  const activeChannelId = useGuildStore((s) => s.activeChannelId);
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const channels = useGuildStore((s) => s.channels);
  const setActiveGuild = useGuildStore((s) => s.setActiveGuild);
  const setActiveChannel = useGuildStore((s) => s.setActiveChannel);
  const leaveChannel = useVoiceStore((s) => s.leaveChannel);
  useVoiceStore((s) => s.videoTracks); // subscribe for track changes

  const videoRef = useRef<HTMLVideoElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState({ x: 16, y: 16 });
  const dragOffset = useRef({ x: 0, y: 0 });

  // Are we currently VIEWING the voice channel?
  const activeChannel = activeGuildId ? channels[activeGuildId]?.find((c) => c.id === activeChannelId) : null;
  const isViewingVoice = activeChannel?.type === "voice" && voiceChannelId === activeChannelId && voiceGuildId === activeGuildId;

  // Should we show the floating player?
  const shouldShow = connected && !isViewingVoice;

  // Attach the best available video track to the floating player
  useEffect(() => {
    if (!shouldShow || !room || !videoRef.current) return;

    // Find a screen share or camera from remote participants
    let trackToAttach: any = null;

    for (const [, participant] of room.remoteParticipants) {
      const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
      if (screenPub?.track) {
        trackToAttach = screenPub.track;
        break;
      }
      const camPub = participant.getTrackPublication(Track.Source.Camera);
      if (camPub?.track && !trackToAttach) {
        trackToAttach = camPub.track;
      }
    }

    if (trackToAttach && videoRef.current) {
      trackToAttach.attach(videoRef.current);
      return () => {
        if (videoRef.current) trackToAttach.detach(videoRef.current);
      };
    }
  }, [shouldShow, room, activeChannelId]);

  // Dragging
  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: MouseEvent) => {
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 320, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 200, e.clientY - dragOffset.current.y)),
      });
    };
    const onUp = () => setDragging(false);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  if (!shouldShow) return null;

  const hasVideo = room ? (() => {
    for (const [, p] of room.remoteParticipants) {
      if (p.getTrackPublication(Track.Source.ScreenShare)?.track) return true;
      if (p.getTrackPublication(Track.Source.Camera)?.track) return true;
    }
    return false;
  })() : false;

  // Only show floating player when there's active video (like Discord)
  // Audio-only voice doesn't show a popup
  if (!hasVideo) return null;

  const voiceGuildChannels = voiceGuildId ? channels[voiceGuildId] : [];
  const voiceChannel = voiceGuildChannels?.find((c) => c.id === voiceChannelId);
  const channelName = voiceChannel?.name || "Voice";

  return (
    <div
      className="fixed z-50 overflow-hidden rounded-xl border border-dark-700 bg-dark-900 shadow-2xl"
      style={{ left: pos.x, bottom: pos.y, width: 320 }}
    >
      {/* Drag handle + channel name */}
      <div
        className="flex h-8 cursor-move items-center gap-2 bg-dark-800 px-3"
        onMouseDown={(e) => {
          dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
          setDragging(true);
        }}
      >
        <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
        <span className="flex-1 truncate text-xs font-medium text-slate-300">{channelName}</span>

        {/* Go to channel */}
        <button
          onClick={() => {
            if (voiceGuildId) setActiveGuild(voiceGuildId);
            if (voiceChannelId) setActiveChannel(voiceChannelId);
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-white"
          title="Go to channel"
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current">
            <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" />
          </svg>
        </button>

        {/* Disconnect */}
        <button
          onClick={leaveChannel}
          className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-red-400"
          title="Disconnect"
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
          </svg>
        </button>
      </div>

      {/* Video stream */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="h-44 w-full bg-black object-contain"
      />
    </div>
  );
}
