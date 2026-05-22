import { useEffect, useRef, useState } from "react";
import { Track } from "livekit-client";
import { useVoiceStore } from "../stores/voice";
import { useGuildStore } from "../stores/guild";
import { useDMStore } from "../stores/dm";
import { useAuthStore } from "../stores/auth";

/**
 * FloatingVoice — Persistent mini video player that shows when you navigate
 * away from your active call (works for both guild voice and DM calls).
 */
export default function FloatingVoice() {
  const activeCall = useVoiceStore((s) => s.activeCall);
  const room = useVoiceStore((s) => s.room);
  const screenShareEnabled = useVoiceStore((s) => s.screenShareEnabled);
  const cameraEnabled = useVoiceStore((s) => s.cameraEnabled);
  const disconnect = useVoiceStore((s) => s.disconnect);
  useVoiceStore((s) => s.videoTracks);

  const activeChannelId = useGuildStore((s) => s.activeChannelId);
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const guildChannels = useGuildStore((s) => s.channels);
  const setActiveGuild = useGuildStore((s) => s.setActiveGuild);
  const setActiveChannel = useGuildStore((s) => s.setActiveChannel);
  const usernames = useGuildStore((s) => s.usernames);

  const activeDMChannelId = useDMStore((s) => s.activeChannelId);
  const dmChannels = useDMStore((s) => s.channels);
  const setDMActive = useDMStore((s) => s.setActive);
  const myId = useAuthStore((s) => s.user?.id);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [resizeDir, setResizeDir] = useState<string | null>(null);
  const [pos, setPos] = useState({ x: 16, y: 16 });
  const [size, setSize] = useState({ w: 320, h: 180 });
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0, px: 0, py: 0 });

  // Am I currently VIEWING the active call?
  const isViewingCall = (() => {
    if (!activeCall) return false;
    if (activeCall.type === "guild") {
      const ch = activeGuildId ? guildChannels[activeGuildId]?.find((c) => c.id === activeChannelId) : null;
      return ch?.type === "voice" && activeCall.channelId === activeChannelId && activeCall.guildId === activeGuildId;
    }
    // DM call: viewing if in DMs and this DM is active
    return !activeGuildId && activeDMChannelId === activeCall.channelId;
  })();

  // Check for ANY active video
  const hasVideo = (() => {
    if (!room) return false;
    if (screenShareEnabled || cameraEnabled) return true;
    for (const [, p] of room.remoteParticipants) {
      if (p.getTrackPublication(Track.Source.ScreenShare)?.track) return true;
      if (p.getTrackPublication(Track.Source.Camera)?.track) return true;
    }
    return false;
  })();

  const shouldShow = activeCall && activeCall.status !== "connecting" && !isViewingCall && hasVideo;

  // Attach best available video track
  useEffect(() => {
    if (!shouldShow || !room || !videoRef.current) return;
    let trackToAttach: any = null;

    for (const [, participant] of room.remoteParticipants) {
      const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
      if (screenPub?.track) { trackToAttach = screenPub.track; break; }
      const camPub = participant.getTrackPublication(Track.Source.Camera);
      if (camPub?.track && !trackToAttach) trackToAttach = camPub.track;
    }
    if (!trackToAttach) {
      const localScreen = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      if (localScreen?.track) trackToAttach = localScreen.track;
    }
    if (!trackToAttach) {
      const localCam = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (localCam?.track) trackToAttach = localCam.track;
    }

    if (trackToAttach && videoRef.current) {
      trackToAttach.attach(videoRef.current);
      return () => { if (videoRef.current) trackToAttach.detach(videoRef.current); };
    }
  }, [shouldShow, room, activeChannelId, activeDMChannelId, screenShareEnabled, cameraEnabled]);

  // Dragging
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - size.w, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - size.h - 40, e.clientY - dragOffset.current.y)),
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragging, size.w, size.h]);

  // Resizing
  useEffect(() => {
    if (!resizeDir) return;
    const MIN_W = 240, MAX_W = 640, MIN_H = 135, MAX_H = 480;
    const s = resizeStart.current;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      let newW = s.w, newH = s.h, newX = s.px, newY = s.py;
      if (resizeDir.includes("r")) newW = Math.max(MIN_W, Math.min(MAX_W, s.w + dx));
      if (resizeDir.includes("l")) { newW = Math.max(MIN_W, Math.min(MAX_W, s.w - dx)); newX = s.px + (s.w - newW); }
      if (resizeDir.includes("b")) newH = Math.max(MIN_H, Math.min(MAX_H, s.h + dy));
      if (resizeDir.includes("t")) { newH = Math.max(MIN_H, Math.min(MAX_H, s.h - dy)); newY = s.py + (s.h - newH); }
      setSize({ w: newW, h: newH });
      setPos({ x: newX, y: newY });
    };
    const onUp = () => setResizeDir(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [resizeDir]);

  if (!shouldShow) return null;

  // Resolve channel name
  let channelName = "Voice";
  if (activeCall!.type === "guild" && activeCall!.guildId) {
    const chs = guildChannels[activeCall!.guildId];
    channelName = chs?.find((c) => c.id === activeCall!.channelId)?.name || "Voice";
  } else if (activeCall!.type === "dm") {
    const dmCh = dmChannels.find((c) => c.id === activeCall!.channelId);
    if (dmCh?.type === "group_dm") {
      channelName = dmCh.name || "Group Call";
    } else {
      const other = dmCh?.participants?.find((p) => p.userId !== myId);
      channelName = other ? (usernames[other.userId] || "Call") : "Call";
    }
  }

  function goToCall() {
    if (!activeCall) return;
    if (activeCall.type === "guild" && activeCall.guildId) {
      setActiveGuild(activeCall.guildId);
      setActiveChannel(activeCall.channelId);
    } else if (activeCall.type === "dm") {
      // Navigate to DM
      setActiveGuild(""); // clear guild to go to DM view
      setDMActive(activeCall.channelId);
    }
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-50 overflow-hidden rounded-xl border border-dark-700 bg-dark-900 shadow-2xl"
      style={{ left: pos.x, top: pos.y, width: size.w }}
    >
      <div
        className="flex h-8 cursor-move items-center gap-2 bg-dark-800 px-3"
        onMouseDown={(e) => {
          dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
          setDragging(true);
        }}
      >
        <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
        <span className="flex-1 truncate text-xs font-medium text-slate-300">{channelName}</span>
        <button onClick={goToCall} className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-white" title="Go to call">
          <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" /></svg>
        </button>
        <button onClick={disconnect} className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-red-400" title="Disconnect">
          <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" /></svg>
        </button>
      </div>
      <video ref={videoRef} autoPlay muted playsInline className="w-full bg-black object-contain" style={{ height: size.h }} />
      {(["t","b","l","r","tl","tr","bl","br"] as const).map((dir) => {
        const cursor = { t:"n", b:"s", l:"w", r:"e", tl:"nw", tr:"ne", bl:"sw", br:"se" }[dir];
        const cls = { t:"top-0 left-2 right-2 h-1.5", b:"bottom-0 left-2 right-2 h-1.5", l:"left-0 top-2 bottom-2 w-1.5", r:"right-0 top-2 bottom-2 w-1.5", tl:"top-0 left-0 h-3 w-3", tr:"top-0 right-0 h-3 w-3", bl:"bottom-0 left-0 h-3 w-3", br:"bottom-0 right-0 h-3 w-3" }[dir];
        return (
          <div key={dir} className={`absolute ${cls}`} style={{ cursor: `${cursor}-resize` }}
            onMouseDown={(e) => { e.preventDefault(); resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h, px: pos.x, py: pos.y }; setResizeDir(dir); }}
          />
        );
      })}
    </div>
  );
}
