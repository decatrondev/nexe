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

  // Actions
  joinChannel: (guildId: string, channelId: string) => Promise<void>;
  leaveChannel: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
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
          participants: [],
          speakingUsers: new Set(),
        });
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const speaking = new Set(speakers.map((s) => s.identity));
        set({ speakingUsers: speaking });
      });

      room.on(RoomEvent.ParticipantConnected, (_participant: RemoteParticipant) => {
        // Refresh participants from server
        api.getVoiceParticipants(channelId, guildId).then((states) => {
          if (states) set({ participants: states });
        });
      });

      room.on(RoomEvent.ParticipantDisconnected, (_participant: RemoteParticipant) => {
        api.getVoiceParticipants(channelId, guildId).then((states) => {
          if (states) set({ participants: states });
        });
      });

      room.on(
        RoomEvent.TrackSubscribed,
        (track, _pub: RemoteTrackPublication, _participant: RemoteParticipant) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach();
            el.id = `voice-audio-${_participant.identity}`;
            document.body.appendChild(el);
          }
        },
      );

      room.on(
        RoomEvent.TrackUnsubscribed,
        (track, _pub: RemoteTrackPublication, _participant: RemoteParticipant) => {
          track.detach().forEach((el) => el.remove());
        },
      );

      // Connect to LiveKit
      await room.connect(resp.url, resp.token);

      // Enable microphone
      await room.localParticipant.setMicrophoneEnabled(true);

      set({
        room,
        channelId,
        guildId,
        connected: true,
        connecting: false,
        participants: resp.participants || [],
      });
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
      participants: [],
      speakingUsers: new Set(),
    });
  },

  toggleMute: async () => {
    const { room, selfMute, selfDeaf } = get();
    const newMute = !selfMute;

    if (room) {
      await room.localParticipant.setMicrophoneEnabled(!newMute);
    }

    set({ selfMute: newMute });

    // If unmuting while deafened, also undeafen
    if (!newMute && selfDeaf) {
      set({ selfDeaf: false });
      // Re-enable audio playback
      document.querySelectorAll<HTMLAudioElement>("[id^='voice-audio-']").forEach((el) => {
        el.muted = false;
      });
    }

    try {
      await api.updateVoiceState(newMute, !newMute && selfDeaf ? false : undefined);
    } catch {
      // ignore
    }
  },

  toggleDeafen: async () => {
    const { room, selfDeaf } = get();
    const newDeaf = !selfDeaf;

    // Mute/unmute all remote audio
    document.querySelectorAll<HTMLAudioElement>("[id^='voice-audio-']").forEach((el) => {
      el.muted = newDeaf;
    });

    // Deafen implies mute
    if (newDeaf && room) {
      await room.localParticipant.setMicrophoneEnabled(false);
    } else if (!newDeaf && room) {
      // Undeafen: restore mic to previous state (unmuted)
      await room.localParticipant.setMicrophoneEnabled(true);
    }

    set({
      selfDeaf: newDeaf,
      selfMute: newDeaf ? true : false,
    });

    try {
      await api.updateVoiceState(newDeaf ? true : false, newDeaf);
    } catch {
      // ignore
    }
  },

  updateParticipants: (states: VoiceState[]) => {
    set({ participants: states });
  },

  handleVoiceStateUpdate: (state: VoiceState) => {
    const { channelId, guildId } = get();
    if (!channelId || !guildId) return;

    // User left voice (channelId is empty)
    if (!state.channelId) {
      set((s) => ({
        participants: s.participants.filter((p) => p.userId !== state.userId),
      }));
      return;
    }

    // User joined/updated in our channel
    if (state.channelId === channelId) {
      set((s) => {
        const existing = s.participants.findIndex((p) => p.userId === state.userId);
        if (existing >= 0) {
          const updated = [...s.participants];
          updated[existing] = state;
          return { participants: updated };
        }
        return { participants: [...s.participants, state] };
      });
    } else {
      // User moved to a different channel — remove from our list
      set((s) => ({
        participants: s.participants.filter((p) => p.userId !== state.userId),
      }));
    }
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
      participants: [],
      speakingUsers: new Set(),
    });
  },
}));
