import { useEffect, useRef, useState, useCallback } from "react";
import { Track, ConnectionQuality } from "livekit-client";
import { useVoiceStore } from "../stores/voice";
import { useGuildStore } from "../stores/guild";
import { useDMStore } from "../stores/dm";
import { useAuthStore } from "../stores/auth";
import type { VoiceState } from "../lib/api";

/**
 * VoiceView — Full Discord-style voice/video experience.
 * Features: spotlight/grid toggle, focus click, fullscreen, PiP,
 * auto-hide controls, hide sidebar, viewers count.
 */
export default function VoiceView() {
  const activeCall = useVoiceStore((s) => s.activeCall);
  const participants = useVoiceStore((s) => s.participants);
  useVoiceStore((s) => s.videoTracks); // subscribe for re-renders
  const speakingUsers = useVoiceStore((s) => s.speakingUsers);
  const selfMute = useVoiceStore((s) => s.selfMute);
  const selfDeaf = useVoiceStore((s) => s.selfDeaf);
  const cameraEnabled = useVoiceStore((s) => s.cameraEnabled);
  const screenShareEnabled = useVoiceStore((s) => s.screenShareEnabled);
  const room = useVoiceStore((s) => s.room);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const toggleCamera = useVoiceStore((s) => s.toggleCamera);
  const toggleScreenShare = useVoiceStore((s) => s.toggleScreenShare);
  const disconnect = useVoiceStore((s) => s.disconnect);
  const usernames = useGuildStore((s) => s.usernames);
  const channels = useGuildStore((s) => s.channels);
  // activeGuildId not needed — activeCall has it
  const setActiveChannel = useGuildStore((s) => s.setActiveChannel);
  const dmChannels = useDMStore((s) => s.channels);
  const myUserId = useAuthStore((s) => s.user?.id);
  const channelId = activeCall?.channelId || null;

  const [quality, setQuality] = useState<"excellent" | "good" | "poor">("excellent");
  const [layout, setLayout] = useState<"spotlight" | "grid">("spotlight");
  const [focusUserId, setFocusUserId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ userId: string; name: string; x: number; y: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);

  // Connection quality
  useEffect(() => {
    if (!activeCall || !room) return;
    const interval = setInterval(() => {
      const q = room.localParticipant?.connectionQuality;
      if (q === ConnectionQuality.Excellent) setQuality("excellent");
      else if (q === ConnectionQuality.Good) setQuality("good");
      else setQuality("poor");
    }, 3000);
    return () => clearInterval(interval);
  }, [activeCall, room]);

  // Auto-hide controls after 3s of no mouse movement
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  useEffect(() => {
    resetControlsTimer();
    return () => { if (controlsTimer.current) clearTimeout(controlsTimer.current); };
  }, [resetControlsTimer]);

  // Fullscreen handlers
  function toggleFullscreen() {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // PiP toggle
  async function togglePiP() {
    if (isPiP) {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
      setIsPiP(false);
    } else {
      // Find a video element to put in PiP
      const videoEl = containerRef.current?.querySelector("video");
      if (videoEl) {
        try {
          await videoEl.requestPictureInPicture();
          setIsPiP(true);
        } catch { /* PiP not supported or denied */ }
      }
    }
  }

  if (!activeCall || activeCall.status === "connecting") return null;

  // Resolve channel name for guild or DM
  let channelName = "Voice Channel";
  if (activeCall.type === "guild" && activeCall.guildId) {
    const guildChs = channels[activeCall.guildId];
    channelName = guildChs?.find((c) => c.id === channelId)?.name || "Voice Channel";
  } else if (activeCall.type === "dm") {
    const dmCh = dmChannels.find((c) => c.id === channelId);
    if (dmCh?.type === "group_dm") {
      channelName = dmCh.name || "Group Call";
    } else {
      const other = dmCh?.participants?.find((p) => p.userId !== myUserId);
      channelName = other ? (usernames[other.userId] || "DM Call") : "DM Call";
    }
  }

  // Build participant list
  const channelParticipants = participants.filter((p) => p.channelId === channelId);
  const allParticipants = channelParticipants.length > 0
    ? channelParticipants
    : [{ userId: myUserId || "", guildId: "", channelId: channelId || "", selfMute, selfDeaf, muted: false, deafened: false, speaking: false, streaming: false } as VoiceState];

  // Build "stream slots" from actual LiveKit video tracks + local state
  type StreamSlot = { id: string; userId: string; name: string; streamType: string; isLocal: boolean };
  const streamSlots: StreamSlot[] = [];

  // Remote streams: detect from LiveKit room directly
  if (room) {
    for (const [identity, participant] of room.remoteParticipants) {
      const hasScreen = participant.getTrackPublication(Track.Source.ScreenShare)?.track;
      const hasCam = participant.getTrackPublication(Track.Source.Camera)?.track;
      const pName = usernames[identity] || identity.slice(0, 8);
      if (hasScreen) {
        streamSlots.push({ id: `${identity}-screen`, userId: identity, name: pName, streamType: "screen", isLocal: false });
      }
      if (hasCam) {
        streamSlots.push({ id: `${identity}-camera`, userId: identity, name: pName, streamType: "camera", isLocal: false });
      }
    }
  }

  // Local streams
  if (myUserId && screenShareEnabled) {
    streamSlots.push({ id: `${myUserId}-screen`, userId: myUserId, name: "You", streamType: "screen", isLocal: true });
  }
  if (myUserId && cameraEnabled) {
    streamSlots.push({ id: `${myUserId}-camera`, userId: myUserId, name: "You", streamType: "camera", isLocal: true });
  }

  // Determine who's in focus
  // focusUserId can be a slot id ("userId-screen") or a plain participant userId
  const focusSlot = focusUserId
    ? streamSlots.find((s) => s.id === focusUserId)
    : streamSlots[0]; // default to first stream

  let focusId: string;
  let focusName: string;
  let focusIsStreaming: boolean;
  let focusStreamType: string;
  let focusIsLocal: boolean;

  if (focusSlot) {
    focusId = focusSlot.userId;
    focusName = focusSlot.name;
    focusIsStreaming = true;
    focusStreamType = focusSlot.streamType;
    focusIsLocal = focusSlot.isLocal;
  } else {
    // Focus on a participant (no specific stream slot)
    const participant = focusUserId
      ? allParticipants.find((p) => p.userId === focusUserId)
      : allParticipants.find((p) => speakingUsers.has(p.userId)) || allParticipants[0];
    focusId = participant?.userId || allParticipants[0]?.userId || "";
    focusName = usernames[focusId] || "User";
    focusIsStreaming = participant?.streaming || (focusId === myUserId && (cameraEnabled || screenShareEnabled));
    focusStreamType = participant?.streamType || (screenShareEnabled ? "screen" : "camera");
    focusIsLocal = focusId === myUserId;
  }

  // Viewers = everyone in the channel
  const viewerCount = allParticipants.length;


  return (
    <div
      ref={containerRef}
      className="voice-view-container flex flex-1 flex-col bg-dark-950 [&:fullscreen]:fixed [&:fullscreen]:inset-0 [&:fullscreen]:z-[9999]"
      onMouseMove={resetControlsTimer}
    >
      {/* Header */}
      <div className={`flex h-11 shrink-0 items-center gap-3 border-b border-dark-800 px-4 transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0"}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current text-slate-400">
          <path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z" />
        </svg>
        <span className="text-sm font-semibold text-white">{channelName}</span>
        <span className="text-xs text-slate-500">{viewerCount} watching</span>

        {/* Quality dot */}
        <div className="ml-1 flex items-center gap-1">
          <div className={`h-1.5 w-1.5 rounded-full ${quality === "excellent" ? "bg-green-500" : quality === "good" ? "bg-yellow-500" : "bg-red-500"}`} />
        </div>
        {screenShareEnabled && (
          <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
            LIVE &middot; {useVoiceStore.getState().screenShareQuality.replace("p", "p ")}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {/* Back to chat */}
          <button
            onClick={() => {
              if (activeCall?.type === "guild" && activeCall.guildId) {
                const guildChs = channels[activeCall.guildId] || [];
                const firstText = guildChs.find((c) => c.type === "text");
                if (firstText) setActiveChannel(firstText.id);
              }
              // For DM calls, just close the view (user navigates normally)
            }}
            className="mr-2 flex items-center gap-1.5 rounded-md bg-dark-700 px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-dark-600 hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
            </svg>
            Back to Chat
          </button>
          {/* Layout toggle */}
          <button
            onClick={() => setLayout(layout === "spotlight" ? "grid" : "spotlight")}
            className={`flex h-7 w-7 items-center justify-center rounded text-slate-400 transition-colors hover:bg-dark-700 hover:text-white ${layout === "grid" ? "text-nexe-400" : ""}`}
            title={layout === "spotlight" ? "Grid view" : "Spotlight view"}
          >
            {layout === "spotlight" ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M4 5v13h17V5H4zm10 2v9h-3V7h3zM6 7h3v9H6V7zm13 9h-3V7h3v9z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M3 5v14h18V5H3zm4 2v10H5V7h2zm10 10h-8V7h8v10zm4 0h-2V7h2v10z" /></svg>
            )}
          </button>

          {/* PiP */}
          <button
            onClick={togglePiP}
            className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition-colors hover:bg-dark-700 hover:text-white"
            title="Picture in Picture"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z" /></svg>
          </button>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition-colors hover:bg-dark-700 hover:text-white"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>
            )}
          </button>

          {/* Hide sidebar toggle */}
          {layout === "spotlight" && (
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className={`flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-dark-700 ${showSidebar ? "text-slate-400 hover:text-white" : "text-nexe-400"}`}
              title={showSidebar ? "Hide participants" : "Show participants"}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {layout === "spotlight" ? (
          /* ─── Spotlight Layout ─── */
          <>
            {/* Main video/avatar area — fills all available space */}
            <div className="flex flex-1 items-center justify-center bg-black">
              <div className="relative h-full w-full overflow-hidden bg-dark-900">
                {focusIsStreaming ? (
                  <SpotlightVideo key={`${focusId}-${focusStreamType}`} userId={focusId || ""} streamType={focusStreamType} isLocal={focusIsLocal} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                      {useGuildStore.getState().avatarMap[focusId || ""] ? (
                        <img
                          src={useGuildStore.getState().avatarMap[focusId || ""]}
                          alt={focusName}
                          className={`h-24 w-24 rounded-full object-cover transition-all ${
                            speakingUsers.has(focusId || "") ? "ring-4 ring-green-500 shadow-lg shadow-green-500/20" : ""
                          }`}
                        />
                      ) : (
                        <div
                          className={`flex h-24 w-24 items-center justify-center rounded-full text-3xl font-bold text-white transition-all ${
                            speakingUsers.has(focusId || "") ? "ring-4 ring-green-500 shadow-lg shadow-green-500/20" : ""
                          }`}
                          style={{ backgroundColor: stringToColor(focusId || "") }}
                        >
                          {focusName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-sm font-medium text-white">{focusName}</span>
                      {speakingUsers.has(focusId || "") && (
                        <div className="flex gap-0.5">
                          <div className="h-3 w-1 animate-pulse rounded-full bg-green-500" />
                          <div className="h-3 w-1 animate-pulse rounded-full bg-green-500" style={{ animationDelay: "0.15s" }} />
                          <div className="h-3 w-1 animate-pulse rounded-full bg-green-500" style={{ animationDelay: "0.3s" }} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {/* Stream label overlay + volume */}
                {focusIsStreaming && (
                  <StreamOverlay name={focusName} streamType={focusStreamType} userId={focusId || ""} isLocal={focusIsLocal} />
                )}
              </div>
            </div>

            {/* Sidebar — stream slots + participants */}
            {showSidebar && (
              <div className="flex w-52 shrink-0 flex-col gap-1 overflow-y-auto border-l border-dark-800 bg-dark-900/50 p-3">
                {/* Stream slots (switchable streams) */}
                {streamSlots.length > 1 && (
                  <>
                    <p className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-wider text-slate-600">Streams</p>
                    {streamSlots.map((slot) => (
                      <button
                        key={slot.id}
                        onClick={() => setFocusUserId(slot.id)}
                        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                          focusSlot?.id === slot.id ? "bg-nexe-500/10 border border-nexe-500/30" : "hover:bg-dark-800 border border-transparent"
                        }`}
                      >
                        <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-xs text-slate-300">{slot.name}</span>
                        <span className="text-[9px] text-slate-500">{slot.streamType === "screen" ? "Screen" : "Cam"}</span>
                      </button>
                    ))}
                    <div className="my-1 border-t border-dark-700" />
                  </>
                )}
                {/* Participants */}
                <p className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-wider text-slate-600">Participants</p>
                {allParticipants.map((p) => (
                  <SidebarTile
                    key={p.userId}
                    participant={p}
                    name={usernames[p.userId] || p.userId.slice(0, 8)}
                    speaking={speakingUsers.has(p.userId)}
                    isLocal={p.userId === myUserId}
                    isFocused={p.userId === focusId && !focusSlot}
                    onClick={() => setFocusUserId(p.userId)}
                    hasCam={p.streaming || (p.userId === myUserId && cameraEnabled)}
                    onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ userId: p.userId, name: usernames[p.userId] || p.userId.slice(0, 8), x: e.clientX, y: e.clientY }); }}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          /* ─── Grid Layout ─── */
          <div className="flex flex-1 flex-wrap content-center items-center justify-center gap-3 p-4">
            {allParticipants.map((p) => (
              <GridTile
                key={p.userId}
                participant={p}
                name={usernames[p.userId] || p.userId.slice(0, 8)}
                speaking={speakingUsers.has(p.userId)}
                isLocal={p.userId === myUserId}
                onClick={() => { setFocusUserId(p.userId); setLayout("spotlight"); }}
                hasCam={p.streaming || (p.userId === myUserId && cameraEnabled)}
                totalCount={allParticipants.length}
              />
            ))}
          </div>
        )}
      </div>

      {/* Controls bar — auto-hide */}
      <div
        className={`flex h-14 shrink-0 items-center justify-center gap-2 border-t border-dark-800 bg-dark-900 transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <CtrlBtn active={selfMute} danger={selfMute} onClick={toggleMute} label={selfMute ? "Unmute" : "Mute"}>
          {selfMute
            ? <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
            : <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />}
        </CtrlBtn>
        <CtrlBtn active={selfDeaf} danger={selfDeaf} onClick={toggleDeafen} label={selfDeaf ? "Undeafen" : "Deafen"}>
          {selfDeaf
            ? <path d="M4.34 2.93L2.93 4.34 7.29 8.7 7 9H3v6h4l5 5v-6.59l4.18 4.18c-.65.49-1.38.88-2.18 1.11v2.06a8.94 8.94 0 0 0 3.61-1.75l2.05 2.05 1.41-1.41L4.34 2.93z" />
            : <path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z" />}
        </CtrlBtn>
        <div className="mx-1 h-5 w-px bg-dark-700" />
        <CtrlBtn active={cameraEnabled} onClick={toggleCamera} label={cameraEnabled ? "Stop Camera" : "Camera"}>
          {cameraEnabled
            ? <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
            : <path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z" />}
        </CtrlBtn>
        <CtrlBtn active={screenShareEnabled} onClick={toggleScreenShare} label={screenShareEnabled ? "Stop Share" : "Share Screen"}>
          <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" />
        </CtrlBtn>
        {screenShareEnabled && (
          <CtrlBtn onClick={() => useVoiceStore.getState().switchScreenShare()} label="Switch Source">
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
          </CtrlBtn>
        )}
        <div className="mx-1 h-5 w-px bg-dark-700" />
        <CtrlBtn danger onClick={disconnect} label="Disconnect">
          <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
        </CtrlBtn>
      </div>

      {/* Hidden PiP video element */}
      <video ref={pipVideoRef} className="hidden" />

      {/* Right-click context menu */}
      {ctxMenu && (
        <ParticipantContextMenu
          userId={ctxMenu.userId}
          name={ctxMenu.name}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}

/* ─── Control Button ─── */
function CtrlBtn({ children, active, danger, onClick, label }: {
  children: React.ReactNode; active?: boolean; danger?: boolean; onClick: () => void; label: string;
}) {
  const bg = danger
    ? "bg-red-500/15 hover:bg-red-500/25 text-red-400"
    : active
      ? "bg-white/10 hover:bg-white/15 text-white"
      : "bg-dark-700 hover:bg-dark-600 text-slate-300 hover:text-white";
  return (
    <button onClick={onClick} title={label} className={`group relative flex h-11 w-11 items-center justify-center rounded-full transition-all ${bg}`}>
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">{children}</svg>
      <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-dark-800 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">{label}</span>
    </button>
  );
}

/* ─── Sidebar Tile (clickable to focus + inline volume) ─── */
function SidebarTile({ participant: p, name, speaking, isLocal, isFocused, onClick, hasCam, onContextMenu }: {
  participant: VoiceState; name: string; speaking: boolean; isLocal: boolean; isFocused: boolean; onClick: () => void; hasCam: boolean; onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const avatarMap = useGuildStore((s) => s.avatarMap);
  const avatarUrl = avatarMap[p.userId];
  const [showVolume, setShowVolume] = useState(false);
  const [volume, setVolume] = useState(100);

  function handleVolumeChange(val: number) {
    setVolume(val);
    document.querySelectorAll<HTMLAudioElement>(`.voice-audio-user-${p.userId}`).forEach((el) => { el.volume = Math.min(val / 100, 1); });
  }

  return (
    <div onContextMenu={onContextMenu}>
      <div className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${isFocused ? "bg-nexe-500/10 border border-nexe-500/30" : "hover:bg-dark-800 border border-transparent"}`}>
        <button onClick={onClick} className="flex shrink-0 items-center">
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} className={`h-8 w-8 rounded-full object-cover transition-all ${speaking ? "ring-2 ring-green-500" : ""}`} />
          ) : (
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white transition-all ${speaking ? "ring-2 ring-green-500" : ""}`} style={{ backgroundColor: stringToColor(p.userId) }}>
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </button>
        <button onClick={onClick} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1">
            <span className="truncate text-xs font-medium text-slate-300">{isLocal ? "You" : name}</span>
            {p.streaming && <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />}
          </div>
          <div className="flex items-center gap-1">
            {p.selfMute && <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 fill-current text-red-400"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99z" /></svg>}
            {p.selfDeaf && <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 fill-current text-red-400"><path d="M4.34 2.93L2.93 4.34 7.29 8.7 7 9H3v6h4l5 5v-6.59l4.18 4.18c-.65.49-1.38.88-2.18 1.11v2.06a8.94 8.94 0 0 0 3.61-1.75l2.05 2.05 1.41-1.41z" /></svg>}
            {hasCam && <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 fill-current text-slate-500"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" /></svg>}
          </div>
        </button>
        {/* Volume toggle button (remote users only) */}
        {!isLocal && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowVolume(!showVolume); }}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors ${showVolume ? "text-nexe-400" : "text-slate-600 hover:text-slate-400"}`}
            title="Volume"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current">
              {volume === 0
                ? <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                : <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />}
            </svg>
          </button>
        )}
      </div>
      {/* Inline volume slider (click to toggle) */}
      {showVolume && !isLocal && (
        <div className="mx-2 mb-1 mt-0.5 flex items-center gap-2 rounded-md bg-dark-800/80 px-2 py-1.5">
          <input
            type="range"
            min={0}
            max={200}
            value={volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-dark-600 accent-nexe-500 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-nexe-400"
          />
          <span className="w-8 text-right text-[9px] font-medium text-slate-400">{volume}%</span>
        </div>
      )}
    </div>
  );
}

/* ─── Grid Tile (medium, equal size) ─── */
function GridTile({ participant: p, name, speaking, isLocal, onClick, totalCount }: {
  participant: VoiceState; name: string; speaking: boolean; isLocal: boolean; onClick: () => void; hasCam: boolean; totalCount: number;
}) {
  const size = totalCount <= 2 ? "w-64 h-64" : totalCount <= 4 ? "w-48 h-48" : "w-36 h-36";
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center gap-2 rounded-2xl bg-dark-800 transition-all hover:bg-dark-750 ${size} ${
        speaking ? "ring-[3px] ring-green-500" : "ring-1 ring-dark-700"
      }`}
      title="Click to focus"
    >
      <div
        className={`flex items-center justify-center rounded-full text-white font-bold ${totalCount <= 2 ? "h-20 w-20 text-3xl" : totalCount <= 4 ? "h-14 w-14 text-xl" : "h-10 w-10 text-sm"}`}
        style={{ backgroundColor: stringToColor(p.userId) }}
      >
        {name.charAt(0).toUpperCase()}
      </div>
      <div className="flex items-center gap-1.5">
        {speaking && <div className="h-2 w-2 rounded-full bg-green-500" />}
        <span className="text-xs font-medium text-slate-300">{isLocal ? "You" : name}</span>
      </div>
      {/* Indicators */}
      <div className="absolute bottom-2 right-2 flex gap-1">
        {p.selfMute && <div className="flex h-5 w-5 items-center justify-center rounded-full bg-dark-900/80"><svg viewBox="0 0 24 24" className="h-3 w-3 fill-current text-red-400"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28z" /></svg></div>}
        {p.streaming && <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20"><div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" /></div>}
      </div>
    </button>
  );
}

/* ─── Spotlight Video ─── */
function SpotlightVideo({ userId, streamType, isLocal }: { userId: string; streamType: string; isLocal: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const room = useVoiceStore((s) => s.room);

  useEffect(() => {
    if (!room || !ref.current) return;

    if (isLocal) {
      const source = streamType === "screen" ? Track.Source.ScreenShare : Track.Source.Camera;
      const pub = room.localParticipant.getTrackPublication(source);
      if (pub?.track) {
        pub.track.attach(ref.current);
        return () => { if (pub.track && ref.current) pub.track.detach(ref.current); };
      }
    } else {
      const participant = room.remoteParticipants.get(userId);
      if (participant) {
        const wantScreen = streamType === "screen";
        const targetSource = wantScreen ? Track.Source.ScreenShare : Track.Source.Camera;
        const pub = participant.getTrackPublication(targetSource);
        if (pub?.track) {
          pub.track.attach(ref.current);
          return () => { if (pub.track && ref.current) pub.track.detach(ref.current); };
        }
        // Fallback: try any video track
        for (const p of participant.trackPublications.values()) {
          if (p.track && p.track.kind === Track.Kind.Video) {
            p.track.attach(ref.current);
            return () => { if (p.track && ref.current) p.track.detach(ref.current); };
          }
        }
      }
    }
  }, [room, userId, streamType, isLocal]);

  return (
    <video
      ref={ref}
      autoPlay
      muted={isLocal}
      playsInline
      className={`h-full w-full ${streamType === "screen" ? "object-contain" : "object-cover"}`}
    />
  );
}

/* ─── Stream Overlay (volume control on the video) ─── */
function StreamOverlay({ name, streamType, userId, isLocal }: { name: string; streamType: string; userId: string; isLocal: boolean }) {
  const [volume, setVolume] = useState(100);
  const [showSlider, setShowSlider] = useState(false);

  function handleVolume(val: number) {
    setVolume(val);
    document.querySelectorAll<HTMLAudioElement>(`.voice-audio-user-${userId}`).forEach((el) => { el.volume = Math.min(val / 100, 1); });
  }

  return (
    <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-black/70 px-3 py-1.5 backdrop-blur-sm">
      <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
      <span className="text-xs font-medium text-white">{name}</span>
      <span className="text-[10px] text-slate-400">{streamType === "screen" ? "Screen" : "Camera"}</span>
      {!isLocal && (
        <>
          <div className="mx-1 h-3 w-px bg-white/20" />
          <button onClick={() => setShowSlider(!showSlider)} className="flex items-center text-slate-400 hover:text-white" title="Stream Volume">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            </svg>
          </button>
          {showSlider && (
            <div className="flex items-center gap-1.5">
              <input
                type="range" min={0} max={200} value={volume}
                onChange={(e) => handleVolume(Number(e.target.value))}
                className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/20 accent-nexe-500 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
              />
              <span className="text-[9px] text-slate-400">{volume}%</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Participant Context Menu (right-click) ─── */
function ParticipantContextMenu({ userId, name, x, y, onClose }: {
  userId: string; name: string; x: number; y: number; onClose: () => void;
}) {
  const [volume, setVolume] = useState(100);
  const myId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener("click", handler);
    window.addEventListener("contextmenu", handler);
    return () => { window.removeEventListener("click", handler); window.removeEventListener("contextmenu", handler); };
  }, [onClose]);

  function handleVolume(val: number) {
    setVolume(val);
    document.querySelectorAll<HTMLAudioElement>(`.voice-audio-user-${userId}`).forEach((el) => { el.volume = Math.min(val / 100, 1); });
  }

  function muteForMe() {
    handleVolume(0);
    onClose();
  }

  if (userId === myId) return null;

  // Position: ensure menu stays on screen
  const menuStyle: React.CSSProperties = {
    position: "fixed", left: x, top: y, zIndex: 9999,
  };

  return (
    <div style={menuStyle} className="w-52 rounded-lg border border-dark-700 bg-dark-900 py-1.5 shadow-2xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
      <p className="mb-1 truncate px-3 text-xs font-semibold text-white">{name}</p>
      <div className="my-1 border-t border-dark-700" />

      {/* Volume slider */}
      <div className="px-3 py-1.5">
        <p className="mb-1.5 text-[10px] font-medium uppercase text-slate-500">User Volume</p>
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 fill-current text-slate-500">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
          </svg>
          <input
            type="range" min={0} max={200} value={volume}
            onChange={(e) => handleVolume(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-dark-600 accent-nexe-500 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-nexe-400"
          />
          <span className="w-8 text-right text-[9px] font-medium text-slate-400">{volume}%</span>
        </div>
      </div>

      <div className="my-1 border-t border-dark-700" />

      {/* Actions */}
      <button onClick={muteForMe} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-dark-800">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current text-slate-500"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
        Mute for me
      </button>
      <button
        onClick={() => { window.dispatchEvent(new CustomEvent("nexe:open-profile", { detail: { userId } })); onClose(); }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-dark-800"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current text-slate-500"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>
        View Profile
      </button>
    </div>
  );
}

/* ─── Helpers ─── */
function stringToColor(str: string): string {
  const colors = ["#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
