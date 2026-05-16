import { create } from "zustand";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from "livekit-client";
import { api, type VoiceState } from "../lib/api";

interface VoiceStore {
  // Connection state
  room: Room | null;
  connected: boolean;
  connecting: boolean;
  channelId: string | null;
  guildId: string | null;

  // Local user state
  selfMute: boolean;
  selfDeaf: boolean;

  // Participants (voice states from server)
  participants: VoiceState[];

  // Speaking indicators (from LiveKit)
  speakingUsers: Set<string>;

  // Video state
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  videoTracks: Map<string, { participantId: string; source: "camera" | "screen" }>;

  // Actions
  joinChannel: (guildId: string, channelId: string) => Promise<void>;
  leaveChannel: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  updateParticipants: (states: VoiceState[]) => void;
  handleVoiceStateUpdate: (state: VoiceState) => void;
  reset: () => void;
}

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  room: null,
  connected: false,
  connecting: false,
  channelId: null,
  guildId: null,
  selfMute: false,
  selfDeaf: false,
  participants: [],
  speakingUsers: new Set(),
  cameraEnabled: false,
  screenShareEnabled: false,
  videoTracks: new Map(),

  joinChannel: async (guildId: string, channelId: string) => {
    const { room: existingRoom, channelId: currentChannel } = get();

    // Already in this channel
    if (currentChannel === channelId && existingRoom) return;

    // Leave current channel first
    if (existingRoom) {
      await get().leaveChannel();
    }

    set({ connecting: true });

    try {
      // Get LiveKit token from our voice service
      const resp = await api.joinVoice(guildId, channelId);
      if (!resp) throw new Error("Failed to join voice channel");

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Set up event listeners
      room.on(RoomEvent.Connected, () => {
        set({ connected: true, connecting: false });
      });

      room.on(RoomEvent.Disconnected, () => {
        set({
          room: null,
          connected: false,
          connecting: false,
          channelId: null,
          guildId: null,
          selfMute: false,
          selfDeaf: false,
          speakingUsers: new Set(),
        });
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const speaking = new Set(speakers.map((s) => s.identity));
        set({ speakingUsers: speaking });
      });

      room.on(RoomEvent.ParticipantConnected, (_participant: RemoteParticipant) => {
        // Only refresh if we're still connected
        if (!get().connected) return;
        api.getVoiceParticipants(channelId, guildId).then((states) => {
          if (states && get().connected) set({ participants: states });
        });
      });

      room.on(RoomEvent.ParticipantDisconnected, (_participant: RemoteParticipant) => {
        // Only refresh if we're still connected (ignore events during our own disconnect)
        if (!get().connected) return;
        api.getVoiceParticipants(channelId, guildId).then((states) => {
          if (states && get().connected) set({ participants: states });
        });
      });

      room.on(
        RoomEvent.TrackSubscribed,
        (track, pub: RemoteTrackPublication, _participant: RemoteParticipant) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach();
            el.id = `voice-audio-${_participant.identity}`;
            document.body.appendChild(el);
          } else if (track.kind === Track.Kind.Video) {
            const source = pub.source === Track.Source.ScreenShare ? "screen" : "camera";
            const sid = track.sid ?? `${_participant.identity}-${source}`;
            set((s) => {
              const newTracks = new Map(s.videoTracks);
              newTracks.set(sid, { participantId: _participant.identity, source });
              return { videoTracks: newTracks };
            });
          }
        },
      );

      room.on(
        RoomEvent.TrackUnsubscribed,
        (track, _pub: RemoteTrackPublication, _participant: RemoteParticipant) => {
          if (track.kind === Track.Kind.Video) {
            const sid = track.sid ?? `${_participant.identity}-unknown`;
            set((s) => {
              const newTracks = new Map(s.videoTracks);
              newTracks.delete(sid);
              return { videoTracks: newTracks };
            });
          }
          track.detach().forEach((el) => el.remove());
        },
      );

      // Connect to LiveKit
      await room.connect(resp.url, resp.token);

      set({
        room,
        channelId,
        guildId,
        connected: true,
        connecting: false,
        participants: resp.participants || [],
      });

      // Enable microphone (non-blocking — voice works even without mic)
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (micErr) {
        console.warn("Microphone unavailable on join:", micErr);
      }
    } catch (err) {
      console.error("Failed to join voice channel:", err);
      set({ connecting: false });
    }
  },

  leaveChannel: async () => {
    const { room } = get();

    // Tell server we're leaving
    try {
      await api.leaveVoice();
    } catch {
      // ignore
    }

    // Disconnect LiveKit
    if (room) {
      room.disconnect();
      // Clean up any attached audio elements
      document.querySelectorAll("[id^='voice-audio-']").forEach((el) => el.remove());
    }

    set({
      room: null,
      connected: false,
      connecting: false,
      channelId: null,
      guildId: null,
      selfMute: false,
      selfDeaf: false,
      speakingUsers: new Set(),
      cameraEnabled: false,
      screenShareEnabled: false,
      videoTracks: new Map(),
    });
  },

  toggleMute: async () => {
    const { room, selfMute, selfDeaf } = get();
    const newMute = !selfMute;

    // Update UI immediately
    set({ selfMute: newMute });

    if (room) {
      try {
        await room.localParticipant.setMicrophoneEnabled(!newMute);
      } catch (err) {
        console.warn("Mic toggle failed:", err);
      }
    }

    // If unmuting while deafened, also undeafen
    if (!newMute && selfDeaf) {
      set({ selfDeaf: false });
      document.querySelectorAll<HTMLAudioElement>("[id^='voice-audio-']").forEach((el) => {
        el.muted = false;
      });
    }

    try {
      await api.updateVoiceState(newMute, !newMute && selfDeaf ? false : undefined);
    } catch { /* ignore */ }
  },

  toggleDeafen: async () => {
    const { room, selfDeaf } = get();
    const newDeaf = !selfDeaf;

    // Mute/unmute all remote audio
    document.querySelectorAll<HTMLAudioElement>("[id^='voice-audio-']").forEach((el) => {
      el.muted = newDeaf;
    });

    if (room) {
      try {
        if (newDeaf) {
          await room.localParticipant.setMicrophoneEnabled(false);
        } else {
          await room.localParticipant.setMicrophoneEnabled(true);
        }
      } catch {
        // Mic unavailable — still allow deafen/undeafen for audio
      }
    }

    set({
      selfDeaf: newDeaf,
      selfMute: newDeaf ? true : false,
    });

    try {
      await api.updateVoiceState(newDeaf ? true : false, newDeaf);
    } catch { /* ignore */ }
  },

  toggleCamera: async () => {
    const { room, cameraEnabled } = get();
    if (!room) return;
    const newEnabled = !cameraEnabled;
    try {
      await room.localParticipant.setCameraEnabled(newEnabled);
      set({ cameraEnabled: newEnabled });
      // Notify backend so others see LIVE badge
      api.updateStreaming(newEnabled, "camera").catch(() => {});
    } catch { /* ignore */ }
  },

  toggleScreenShare: async () => {
    const { room, screenShareEnabled } = get();
    if (!room) return;
    const newEnabled = !screenShareEnabled;
    try {
      await room.localParticipant.setScreenShareEnabled(newEnabled, { audio: true });
      set({ screenShareEnabled: newEnabled });
      // Notify backend so others see LIVE badge
      api.updateStreaming(newEnabled, "screen").catch(() => {});
    } catch {
      // User cancelled screen share picker
      set({ screenShareEnabled: false });
    }
  },

  updateParticipants: (states: VoiceState[]) => {
    set({ participants: states });
  },

  handleVoiceStateUpdate: (state: VoiceState) => {
    // User left voice (channelId is empty)
    if (!state.channelId) {
      set((s) => ({
        participants: s.participants.filter((p) => p.userId !== state.userId),
      }));
      return;
    }

    // User joined or updated — add/update in participants list
    set((s) => {
      const existing = s.participants.findIndex((p) => p.userId === state.userId);
      if (existing >= 0) {
        const updated = [...s.participants];
        updated[existing] = state;
        return { participants: updated };
      }
      return { participants: [...s.participants, state] };
    });
  },

  reset: () => {
    const { room } = get();
    if (room) {
      room.disconnect();
      document.querySelectorAll("[id^='voice-audio-']").forEach((el) => el.remove());
    }
    set({
      room: null,
      connected: false,
      connecting: false,
      channelId: null,
      guildId: null,
      selfMute: false,
      selfDeaf: false,
      speakingUsers: new Set(),
      cameraEnabled: false,
      screenShareEnabled: false,
      videoTracks: new Map(),
    });
  },
}));
