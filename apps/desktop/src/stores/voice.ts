import { create } from "zustand";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from "livekit-client";
import { createNativeRoom, isNativeRoom, needsNativeVoice } from "../lib/nativeRoom";
import { api, type VoiceState, type TierLimits, type DMCallSignal } from "../lib/api";

// ── Screen share resolution presets ──
function getScreenShareOpts(quality: string): { width: number; height: number; frameRate: number } {
  switch (quality) {
    case "1080p60": return { width: 1920, height: 1080, frameRate: 60 };
    case "1080p30": return { width: 1920, height: 1080, frameRate: 30 };
    case "720p60": return { width: 1280, height: 720, frameRate: 60 };
    case "720p30":
    default: return { width: 1280, height: 720, frameRate: 30 };
  }
}

// ── Build screen share capture options ──
// Prefers screen/window over tab so switching tabs doesn't freeze the stream
function buildScreenShareConfig(quality: string, audio: boolean) {
  return {
    audio,
    contentHint: "detail" as const,
    resolution: getScreenShareOpts(quality),
    // Browser hints: prefer screen/window, not tabs (tabs pause when hidden)
    selfBrowserSurface: "exclude" as const,    // don't show current tab
    surfaceSwitching: "include" as const,       // allow switching source mid-stream
    preferCurrentTab: false,                    // don't default to current tab
    systemAudio: "include" as const,            // include system audio option
  };
}

// ── Unified call type ──
export interface ActiveCall {
  type: "guild" | "dm";
  channelId: string;
  guildId?: string;       // guild voice only
  callId?: string;        // DM call only
  callerId?: string;      // DM call only (who initiated)
  video?: boolean;        // DM call only (started as video?)
  status: "connecting" | "ringing" | "active";
}

interface VoiceStore {
  // ── Unified call state ──
  room: Room | null;
  activeCall: ActiveCall | null;       // THE single source of truth
  participants: VoiceState[];          // works for both guild (many) and DM (2)
  speakingUsers: Set<string>;

  // ── Local user state ──
  localMutes: Set<string>;             // users muted locally (volume=0 by us)
  selfMute: boolean;
  selfDeaf: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  screenSharePending: boolean;
  screenShareQuality: string;
  screenShareAudio: boolean;
  videoTracks: Map<string, { participantId: string; source: "camera" | "screen" }>;

  // ── Tier ──
  tierLimits: TierLimits | null;

  // ── DM incoming call (separate from active call) ──
  incomingCall: DMCallSignal | null;

  // ── Actions ──
  joinChannel: (guildId: string, channelId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => void;
  startScreenShare: (quality: string, audio: boolean) => Promise<void>;
  switchScreenShare: () => Promise<void>;
  cancelScreenShare: () => void;
  toggleLocalMute: (userId: string) => void;
  updateParticipants: (states: VoiceState[]) => void;
  handleVoiceStateUpdate: (state: VoiceState) => void;
  fetchTierLimits: () => Promise<void>;

  // ── DM Call actions ──
  startDMCall: (channelId: string, video: boolean) => Promise<void>;
  acceptDMCall: (callId: string) => Promise<void>;
  rejectDMCall: (callId: string) => Promise<void>;
  handleDMCallRing: (signal: DMCallSignal) => void;
  handleDMCallAccept: (signal: DMCallSignal) => void;
  handleDMCallReject: (signal: DMCallSignal) => void;
  handleDMCallEnd: (signal: DMCallSignal) => void;

  reset: () => void;
}

// ── Shared LiveKit event setup (used by both guild join and DM calls) ──
function setupRoomEvents(room: Room, set: any, _get: any) {
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    set({ speakingUsers: new Set(speakers.map((s) => s.identity)) });
  });

  room.on(RoomEvent.TrackSubscribed, (track, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach();
      const source = pub.source === Track.Source.ScreenShareAudio ? "screen" : "mic";
      el.id = `voice-audio-${participant.identity}-${source}`;
      el.className = `voice-audio-user-${participant.identity}`;
      document.body.appendChild(el);
    } else if (track.kind === Track.Kind.Video) {
      const source = pub.source === Track.Source.ScreenShare ? "screen" : "camera";
      const sid = track.sid ?? `${participant.identity}-${source}`;
      set((s: VoiceStore) => {
        const newTracks = new Map(s.videoTracks);
        newTracks.set(sid, { participantId: participant.identity, source });
        return { videoTracks: newTracks };
      });
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    if (track.kind === Track.Kind.Video) {
      const sid = track.sid ?? "unknown";
      set((s: VoiceStore) => {
        const newTracks = new Map(s.videoTracks);
        newTracks.delete(sid);
        return { videoTracks: newTracks };
      });
    }
    track.detach().forEach((el: HTMLElement) => el.remove());
  });

  room.on(RoomEvent.Disconnected, () => {
    cleanupAudio();
    // Only clear local state — don't clear participants (server sends individual VOICE_STATE_UPDATE for each)
    set({
      room: null,
      activeCall: null,
      selfMute: false,
      selfDeaf: false,
      speakingUsers: new Set(),
      cameraEnabled: false,
      screenShareEnabled: false,
      videoTracks: new Map(),
      participants: [],
    });
  });
}

function cleanupAudio() {
  document.querySelectorAll("[id^='voice-audio-']").forEach((el) => el.remove());
}

function createRoom(): Room {
  // Webviews without WebRTC (Linux Flatpak) use the Rust voice engine; every other platform is unchanged.
  if (needsNativeVoice()) return createNativeRoom();

  const noiseSupp = localStorage.getItem("nexe:voice:noiseSuppression") !== "false";
  const echoCancellation = localStorage.getItem("nexe:voice:echoCancellation") !== "false";
  const autoGain = localStorage.getItem("nexe:voice:autoGain") !== "false";

  return new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: {
      echoCancellation,
      noiseSuppression: noiseSupp,
      autoGainControl: autoGain,
    },
  });
}

const INITIAL_STATE = {
  room: null as Room | null,
  activeCall: null as ActiveCall | null,
  participants: [] as VoiceState[],
  speakingUsers: new Set<string>(),
  localMutes: new Set<string>(),
  selfMute: false,
  selfDeaf: false,
  cameraEnabled: false,
  screenShareEnabled: false,
  screenSharePending: false,
  screenShareQuality: "720p30",
  screenShareAudio: true,
  videoTracks: new Map<string, { participantId: string; source: "camera" | "screen" }>(),
  tierLimits: null as TierLimits | null,
  incomingCall: null as DMCallSignal | null,
};

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  ...INITIAL_STATE,

  fetchTierLimits: async () => {
    try {
      const userJson = localStorage.getItem("user");
      if (!userJson) return;
      const user = JSON.parse(userJson);
      const profile = await api.getProfile(user.id);
      if (profile?.tierLimits) set({ tierLimits: profile.tierLimits });
    } catch { /* ignore */ }
  },

  // ══════════════════════════════════════════════════
  // GUILD VOICE — join a server voice channel
  // ══════════════════════════════════════════════════
  joinChannel: async (guildId: string, channelId: string) => {
    const { activeCall, room: existingRoom } = get();

    // Already in this channel
    if (activeCall?.type === "guild" && activeCall.channelId === channelId && existingRoom) return;

    // Leave any current call first
    if (activeCall) await get().disconnect();

    set({ activeCall: { type: "guild", channelId, guildId, status: "connecting" } });

    try {
      if (!get().tierLimits) await get().fetchTierLimits();

      const resp = await api.joinVoice(guildId, channelId);
      if (!resp) throw new Error("Failed to join voice channel");

      const room = createRoom();
      setupRoomEvents(room, set, get);

      // Guild-specific: refresh participants on join/leave
      room.on(RoomEvent.ParticipantConnected, () => {
        if (!get().activeCall) return;
        api.getVoiceParticipants(channelId, guildId).then((states) => {
          if (states && get().activeCall) set({ participants: states });
        });
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        if (!get().activeCall) return;
        api.getVoiceParticipants(channelId, guildId).then((states) => {
          if (states && get().activeCall) set({ participants: states });
        });
      });

      await room.connect(resp.url, resp.token);

      set({
        room,
        activeCall: { type: "guild", channelId, guildId, status: "active" },
        participants: resp.participants || [],
      });

      try { await room.localParticipant.setMicrophoneEnabled(true); }
      catch { console.warn("Microphone unavailable on join"); }
    } catch (err) {
      console.error("Failed to join voice channel:", err);
      set({ activeCall: null });
    }
  },

  // ══════════════════════════════════════════════════
  // DISCONNECT — universal, works for guild + DM
  // ══════════════════════════════════════════════════
  disconnect: async () => {
    const { room, activeCall } = get();

    if (activeCall?.type === "guild") {
      try { await api.leaveVoice(); } catch { /* */ }
    } else if (activeCall?.type === "dm" && activeCall.callId) {
      try { await api.endDMCall(activeCall.callId); } catch { /* */ }
    }

    if (room) {
      room.disconnect();
      cleanupAudio();
    }

    // Clear activeCall first (unmounts VideoGrid), then clear the rest
    set({ activeCall: null });
    set({
      room: null,
      participants: [],
      selfMute: false,
      selfDeaf: false,
      speakingUsers: new Set(),
      cameraEnabled: false,
      screenShareEnabled: false,
      screenSharePending: false,
      videoTracks: new Map(),
    });
  },

  // ══════════════════════════════════════════════════
  // CONTROLS — work for both guild + DM
  // ══════════════════════════════════════════════════
  toggleMute: async () => {
    const { room, selfMute, selfDeaf } = get();
    const newMute = !selfMute;
    set({ selfMute: newMute });

    if (room) {
      try { await room.localParticipant.setMicrophoneEnabled(!newMute); }
      catch { /* */ }
    }

    if (!newMute && selfDeaf) {
      set({ selfDeaf: false });
      document.querySelectorAll<HTMLAudioElement>("[id^='voice-audio-']").forEach((el) => { el.muted = false; });
      if (isNativeRoom(room)) room.setDeafened(false);
    }

    // Only report to guild voice API (DM calls don't track mute server-side)
    if (get().activeCall?.type === "guild") {
      try { await api.updateVoiceState(newMute, !newMute && selfDeaf ? false : undefined); } catch { /* */ }
    }
  },

  toggleDeafen: async () => {
    const { room, selfDeaf } = get();
    const newDeaf = !selfDeaf;

    document.querySelectorAll<HTMLAudioElement>("[id^='voice-audio-']").forEach((el) => { el.muted = newDeaf; });
    if (isNativeRoom(room)) room.setDeafened(newDeaf);

    if (room) {
      try { await room.localParticipant.setMicrophoneEnabled(!newDeaf); } catch { /* */ }
    }

    set({ selfDeaf: newDeaf, selfMute: newDeaf ? true : false });

    if (get().activeCall?.type === "guild") {
      try { await api.updateVoiceState(newDeaf, newDeaf); } catch { /* */ }
    }
  },

  toggleCamera: async () => {
    const { room, cameraEnabled } = get();
    if (!room) return;
    const newEnabled = !cameraEnabled;
    try {
      await room.localParticipant.setCameraEnabled(newEnabled);
      set({ cameraEnabled: newEnabled });
      if (get().activeCall?.type === "guild") {
        api.updateStreaming(newEnabled, "camera").catch(() => {});
      }
    } catch { /* */ }
  },

  toggleScreenShare: () => {
    const { screenShareEnabled, room } = get();
    if (!room) return;

    if (screenShareEnabled) {
      room.localParticipant.setScreenShareEnabled(false).catch(() => {});
      set({ screenShareEnabled: false, screenSharePending: false });
      if (get().activeCall?.type === "guild") {
        api.updateStreaming(false, "screen").catch(() => {});
      }
    } else {
      set({ screenSharePending: true });
    }
  },

  startScreenShare: async (quality: string, audio: boolean) => {
    const { room } = get();
    if (!room) { set({ screenSharePending: false }); return; }
    try {
      await room.localParticipant.setScreenShareEnabled(true, buildScreenShareConfig(quality, audio));
      set({ screenShareEnabled: true, screenSharePending: false, screenShareQuality: quality, screenShareAudio: audio });
      if (get().activeCall?.type === "guild") {
        api.updateStreaming(true, "screen").catch(() => {});
      }

      const screenPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      if (screenPub?.track?.mediaStreamTrack) {
        screenPub.track.mediaStreamTrack.onended = () => {
          set({ screenShareEnabled: false });
          if (get().activeCall?.type === "guild") api.updateStreaming(false, "screen").catch(() => {});
        };
      }
    } catch {
      set({ screenShareEnabled: false, screenSharePending: false });
    }
  },

  switchScreenShare: async () => {
    const { room, screenShareQuality, screenShareAudio } = get();
    if (!room) return;

    // Try to get new source FIRST — if user cancels, keep current share
    try {
      // Stop current share only after user picks new source
      await room.localParticipant.setScreenShareEnabled(false);
      await room.localParticipant.setScreenShareEnabled(true, buildScreenShareConfig(screenShareQuality, screenShareAudio));
      set({ screenShareEnabled: true });
      if (get().activeCall?.type === "guild") api.updateStreaming(true, "screen").catch(() => {});

      const screenPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      if (screenPub?.track?.mediaStreamTrack) {
        screenPub.track.mediaStreamTrack.onended = () => {
          set({ screenShareEnabled: false });
          if (get().activeCall?.type === "guild") api.updateStreaming(false, "screen").catch(() => {});
        };
      }
    } catch {
      // User cancelled the picker — re-enable the previous share if it was stopped
      if (!room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track) {
        try {
          await room.localParticipant.setScreenShareEnabled(true, buildScreenShareConfig(screenShareQuality, screenShareAudio));
        } catch {
          // Can't restore — share is gone
          set({ screenShareEnabled: false });
          if (get().activeCall?.type === "guild") api.updateStreaming(false, "screen").catch(() => {});
        }
      }
    }
  },

  cancelScreenShare: () => set({ screenSharePending: false }),

  toggleLocalMute: (userId: string) => {
    const nativeRoom = get().room;
    set((s) => {
      const next = new Set(s.localMutes);
      if (next.has(userId)) {
        next.delete(userId);
        if (isNativeRoom(nativeRoom)) nativeRoom.setUserVolume(userId, 1);
        // Restore volume
        document.querySelectorAll<HTMLAudioElement>(`.voice-audio-user-${userId}`).forEach((el) => { el.volume = 1; });
      } else {
        next.add(userId);
        if (isNativeRoom(nativeRoom)) nativeRoom.setUserVolume(userId, 0);
        // Mute
        document.querySelectorAll<HTMLAudioElement>(`.voice-audio-user-${userId}`).forEach((el) => { el.volume = 0; });
      }
      return { localMutes: next };
    });
  },

  updateParticipants: (states: VoiceState[]) => set({ participants: states }),

  handleVoiceStateUpdate: (state: VoiceState) => {
    if (!state.channelId) {
      set((s) => ({ participants: s.participants.filter((p) => p.userId !== state.userId) }));
      return;
    }
    set((s) => {
      const idx = s.participants.findIndex((p) => p.userId === state.userId);
      if (idx >= 0) {
        const updated = [...s.participants];
        updated[idx] = state;
        return { participants: updated };
      }
      return { participants: [...s.participants, state] };
    });
  },

  // ══════════════════════════════════════════════════
  // DM CALL — start / accept / reject
  // ══════════════════════════════════════════════════
  startDMCall: async (channelId: string, video: boolean) => {
    // Leave any current call first
    if (get().activeCall) await get().disconnect();

    try {
      const resp = await api.startDMCall(channelId, video);
      if (!resp) return;

      // Show "Calling..." UI immediately
      set({
        activeCall: { type: "dm", channelId, callId: resp.callId, callerId: "", video, status: "ringing" },
      });

      const room = createRoom();
      setupRoomEvents(room, set, get);

      // When other person joins → call is active
      room.on(RoomEvent.ParticipantConnected, () => {
        set((s: VoiceStore) => s.activeCall?.type === "dm" ? { activeCall: { ...s.activeCall, status: "active" } } : {});
      });

      await room.connect(resp.url, resp.token);
      set({ room });

      try { await room.localParticipant.setMicrophoneEnabled(true); } catch { /* */ }
      if (video) {
        try { await room.localParticipant.setCameraEnabled(true); set({ cameraEnabled: true }); } catch { /* */ }
      }
    } catch (err) {
      console.error("Failed to start DM call:", err);
      set({ activeCall: null });
    }
  },

  acceptDMCall: async (callId: string) => {
    const { incomingCall } = get();
    if (!incomingCall) return;

    // Leave any current call first
    if (get().activeCall) await get().disconnect();

    set({
      incomingCall: null,
      activeCall: { type: "dm", channelId: incomingCall.channelId, callId, callerId: incomingCall.callerId, video: incomingCall.video, status: "active" },
    });

    try {
      const resp = await api.acceptDMCall(callId);
      if (!resp) { set({ activeCall: null }); return; }

      const room = createRoom();
      setupRoomEvents(room, set, get);

      await room.connect(resp.url, resp.token);
      set({ room });

      try { await room.localParticipant.setMicrophoneEnabled(true); } catch { /* */ }
      if (incomingCall.video) {
        try { await room.localParticipant.setCameraEnabled(true); set({ cameraEnabled: true }); } catch { /* */ }
      }
    } catch (err) {
      console.error("Failed to accept DM call:", err);
      set({ activeCall: null });
    }
  },

  rejectDMCall: async (callId: string) => {
    try { await api.rejectDMCall(callId); } catch { /* */ }
    set({ incomingCall: null });
  },

  // ── DM Call WS Handlers ──
  handleDMCallRing: (signal: DMCallSignal) => {
    if (get().activeCall) return; // already in a call
    set({ incomingCall: signal });
    setTimeout(() => {
      if (get().incomingCall?.callId === signal.callId) set({ incomingCall: null });
    }, 30000);
  },

  handleDMCallAccept: () => {
    set((s: VoiceStore) => s.activeCall?.type === "dm" ? { activeCall: { ...s.activeCall, status: "active" } } : {});
  },

  handleDMCallReject: () => {
    const { room } = get();
    if (room) { room.disconnect(); cleanupAudio(); }
    set({ activeCall: null, room: null, incomingCall: null });
  },

  handleDMCallEnd: () => {
    const { room } = get();
    if (room) { room.disconnect(); cleanupAudio(); }
    set({
      activeCall: null, room: null, incomingCall: null,
      cameraEnabled: false, screenShareEnabled: false, videoTracks: new Map(),
    });
  },

  reset: () => {
    const { room } = get();
    if (room) { room.disconnect(); cleanupAudio(); }
    set({ ...INITIAL_STATE });
  },
}));

// ── Backward-compat getters (used by existing components) ──
// These read from activeCall so old components don't break immediately
export function getChannelId(state: VoiceStore): string | null {
  return state.activeCall?.channelId ?? null;
}
export function getGuildId(state: VoiceStore): string | null {
  return state.activeCall?.guildId ?? null;
}
export function isConnected(state: VoiceStore): boolean {
  return state.activeCall != null && state.activeCall.status !== "connecting";
}
export function isDMCall(state: VoiceStore): boolean {
  return state.activeCall?.type === "dm";
}
