import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ConnectionQuality, RoomEvent, type Room } from "livekit-client";

/**
 * Voice engine for webviews without WebRTC (WebKitGTK in the Linux Flatpak has no
 * RTCPeerConnection). The call itself runs in Rust (src-tauri/src/voice.rs); this class exposes
 * the small part of the livekit-client Room API that voice.ts and the voice components use, so the
 * rest of the UI does not care which engine is behind it. Windows and macOS never create it.
 */

/** True when the webview cannot do WebRTC but the Rust voice engine is there to take over. */
export function needsNativeVoice(): boolean {
  return (
    typeof RTCPeerConnection === "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export interface NativeDevice {
  deviceId: string;
  label: string;
}

export async function listNativeDevices(): Promise<{ inputs: NativeDevice[]; outputs: NativeDevice[] }> {
  try {
    return await invoke("voice_list_devices");
  } catch {
    return { inputs: [], outputs: [] };
  }
}

type Handler = (...args: any[]) => void;

interface NativeEvent {
  kind: "speakers" | "participant_connected" | "participant_disconnected" | "quality" | "disconnected";
  identities?: string[];
  identity?: string;
  quality?: "excellent" | "good" | "poor" | "lost";
}

const QUALITY: Record<string, ConnectionQuality> = {
  excellent: ConnectionQuality.Excellent,
  good: ConnectionQuality.Good,
  poor: ConnectionQuality.Poor,
  lost: ConnectionQuality.Lost,
};

export class NativeRoom {
  private handlers = new Map<string, Set<Handler>>();
  private unlisten: UnlistenFn | null = null;
  private connected = false;

  /** Same shape the UI reads from livekit-client; video is not available in this engine yet. */
  readonly remoteParticipants = new Map<string, never>();
  readonly localParticipant = {
    connectionQuality: ConnectionQuality.Excellent as ConnectionQuality,
    setMicrophoneEnabled: async (enabled: boolean) => {
      await invoke("voice_set_mic", { enabled });
    },
    setCameraEnabled: async (_enabled: boolean): Promise<void> => {
      throw new Error("Camera is not available in the Linux voice engine yet");
    },
    setScreenShareEnabled: async (_enabled: boolean, _opts?: unknown): Promise<void> => {
      throw new Error("Screen sharing is not available in the Linux voice engine yet");
    },
    getTrackPublication: (_source: unknown): undefined => undefined,
  };

  on(event: string, handler: Handler): this {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler);
    return this;
  }

  private emit(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.forEach((h) => h(...args));
  }

  async connect(url: string, token: string): Promise<void> {
    this.unlisten = await listen<NativeEvent>("voice://event", (e) => this.onNative(e.payload));
    try {
      const on = (key: string) => localStorage.getItem(key) !== "false";
      await invoke("voice_connect", {
        url,
        token,
        echoCancellation: on("nexe:voice:echoCancellation"),
        noiseSuppression: on("nexe:voice:noiseSuppression"),
        autoGain: on("nexe:voice:autoGain"),
      });
    } catch (err) {
      this.dispose();
      throw err;
    }
    this.connected = true;
  }

  disconnect(): void {
    if (!this.connected && !this.unlisten) return;
    this.connected = false;
    invoke("voice_disconnect").catch(() => {});
    this.dispose();
    this.emit(RoomEvent.Disconnected);
  }

  private dispose() {
    this.unlisten?.();
    this.unlisten = null;
  }

  private onNative(ev: NativeEvent) {
    switch (ev.kind) {
      case "speakers":
        this.emit(RoomEvent.ActiveSpeakersChanged, (ev.identities ?? []).map((identity) => ({ identity })));
        break;
      case "participant_connected":
        this.emit(RoomEvent.ParticipantConnected, { identity: ev.identity });
        break;
      case "participant_disconnected":
        this.emit(RoomEvent.ParticipantDisconnected, { identity: ev.identity });
        break;
      case "quality":
        this.localParticipant.connectionQuality = QUALITY[ev.quality ?? "excellent"] ?? ConnectionQuality.Excellent;
        break;
      case "disconnected":
        if (this.connected) {
          this.connected = false;
          this.dispose();
          this.emit(RoomEvent.Disconnected);
        }
        break;
    }
  }

  async switchActiveDevice(kind: "audioinput" | "audiooutput", deviceId: string): Promise<void> {
    await invoke(kind === "audioinput" ? "voice_set_input" : "voice_set_output", { deviceId });
  }

  /** Deafen: stop playing everybody. */
  setDeafened(deafened: boolean): void {
    invoke("voice_set_deafen", { deafened }).catch(() => {});
  }

  /** Per-user volume, 0..1 (used for "mute this user locally"). */
  setUserVolume(identity: string, volume: number): void {
    invoke("voice_set_volume", { identity, volume }).catch(() => {});
  }
}

export function isNativeRoom(room: Room | null): room is Room & { setDeafened(d: boolean): void; setUserVolume(id: string, v: number): void } {
  return (room as unknown) instanceof NativeRoom;
}

export function createNativeRoom(): Room {
  return new NativeRoom() as unknown as Room;
}
