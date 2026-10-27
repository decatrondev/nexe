import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ConnectionQuality, RoomEvent, Track, type Room } from "livekit-client";
import { getAutoGain, getEchoCancellation, getNoiseMode } from "./voicePrefs";

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

// Device names by id, so the call engine can match a device the settings picked (it numbers them differently).
const deviceLabels = new Map<string, string>();

export async function listNativeDevices(): Promise<{ inputs: NativeDevice[]; outputs: NativeDevice[] }> {
  try {
    const res = await invoke<{ inputs: NativeDevice[]; outputs: NativeDevice[] }>("mic_test_list_devices");
    for (const d of [...res.inputs, ...res.outputs]) deviceLabels.set(d.deviceId, d.label);
    return res;
  } catch {
    return { inputs: [], outputs: [] };
  }
}

type Handler = (...args: any[]) => void;

interface NativeEvent {
  kind: "speakers" | "participant_connected" | "participant_disconnected" | "quality" | "disconnected" | "video_track";
  identities?: string[];
  identity?: string;
  source?: "camera" | "screen";
  present?: boolean;
  sid?: string;
  quality?: "excellent" | "good" | "poor" | "lost";
}

const QUALITY: Record<string, ConnectionQuality> = {
  excellent: ConnectionQuality.Excellent,
  good: ConnectionQuality.Good,
  poor: ConnectionQuality.Poor,
  lost: ConnectionQuality.Lost,
};

/**
 * A remote camera or screen. The Rust engine sends JPEG pictures over a binary channel while at least
 * one element is attached; they are painted on a canvas that takes the place of the <video> element
 * the UI asked for (the Linux webview cannot play a WebRTC stream itself).
 */
class NativeVideoTrack {
  readonly kind = Track.Kind.Video;
  private views = new Map<HTMLVideoElement, HTMLCanvasElement>();
  private channel: Channel<ArrayBuffer> | null = null;
  private pending: ArrayBuffer | null = null;
  private decoding = false;

  readonly sid: string;
  private identity: string;
  private source: "camera" | "screen";

  constructor(sid: string, identity: string, source: "camera" | "screen") {
    this.sid = sid;
    this.identity = identity;
    this.source = source;
  }

  attach(el: HTMLVideoElement): HTMLVideoElement {
    if (this.views.has(el)) return el;
    const canvas = document.createElement("canvas");
    canvas.className = el.className;
    canvas.style.cssText = el.style.cssText;
    el.style.display = "none";
    el.after(canvas);
    this.views.set(el, canvas);
    if (!this.channel) {
      this.channel = new Channel<ArrayBuffer>();
      this.channel.onmessage = (buf) => this.onFrame(buf);
      invoke("voice_video_attach", { identity: this.identity, source: this.source, onFrame: this.channel }).catch(() => {});
    }
    return el;
  }

  detach(el?: HTMLVideoElement): HTMLVideoElement[] {
    const targets = el ? [el] : [...this.views.keys()];
    for (const t of targets) {
      this.views.get(t)?.remove();
      this.views.delete(t);
      t.style.display = "";
    }
    if (this.views.size === 0 && this.channel) {
      this.channel = null;
      invoke("voice_video_detach", { identity: this.identity, source: this.source }).catch(() => {});
    }
    return targets;
  }

  // Only the newest picture matters: if the decoder is busy, older ones are dropped.
  private onFrame(buf: ArrayBuffer) {
    this.pending = buf;
    if (!this.decoding) void this.drain();
  }

  private async drain() {
    this.decoding = true;
    try {
      while (this.pending) {
        const buf = this.pending;
        this.pending = null;
        const picture = await decodeJpeg(buf);
        for (const canvas of this.views.values()) {
          if (canvas.width !== picture.width || canvas.height !== picture.height) {
            canvas.width = picture.width;
            canvas.height = picture.height;
          }
          canvas.getContext("2d")?.drawImage(picture.source, 0, 0);
        }
        picture.release();
      }
    } catch {
      /* a damaged picture is skipped */
    } finally {
      this.decoding = false;
    }
  }
}

interface Picture {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/** Decodes a JPEG off the main thread when the webview can, otherwise through an image element. */
async function decodeJpeg(buf: ArrayBuffer): Promise<Picture> {
  const blob = new Blob([buf], { type: "image/jpeg" });
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

class NativePublication {
  readonly source: Track.Source;
  readonly track: NativeVideoTrack;
  constructor(source: Track.Source, track: NativeVideoTrack) {
    this.source = source;
    this.track = track;
  }
}

class NativeRemoteParticipant {
  readonly trackPublications = new Map<string, NativePublication>();
  readonly identity: string;
  constructor(identity: string) {
    this.identity = identity;
  }
  getTrackPublication(source: Track.Source): NativePublication | undefined {
    for (const p of this.trackPublications.values()) if (p.source === source) return p;
    return undefined;
  }
}

export class NativeRoom {
  private handlers = new Map<string, Set<Handler>>();
  private unlisten: UnlistenFn | null = null;
  private connected = false;

  /** Same shape the UI reads from livekit-client; only remote video is available so far. */
  readonly remoteParticipants = new Map<string, NativeRemoteParticipant>();
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
      await invoke("voice_connect", {
        url,
        token,
        echoCancellation: getEchoCancellation(),
        noiseMode: getNoiseMode(),
        autoGain: getAutoGain(),
        inputDevice: localStorage.getItem("nexe:voice:inputDevice") || null,
        outputDevice: localStorage.getItem("nexe:voice:outputDevice") || null,
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

  private onVideoTrack(ev: NativeEvent) {
    const identity = ev.identity ?? "";
    const source = ev.source ?? "camera";
    const sid = ev.sid ?? `${identity}-${source}`;
    let participant = this.remoteParticipants.get(identity);
    if (!participant) this.remoteParticipants.set(identity, (participant = new NativeRemoteParticipant(identity)));
    const trackSource = source === "screen" ? Track.Source.ScreenShare : Track.Source.Camera;
    if (ev.present) {
      const track = new NativeVideoTrack(sid, identity, source);
      participant.trackPublications.set(sid, new NativePublication(trackSource, track));
      this.emit(RoomEvent.TrackSubscribed, track, { source: trackSource, sid }, participant);
    } else {
      const gone = participant.trackPublications.get(sid);
      participant.trackPublications.delete(sid);
      if (gone) {
        gone.track.detach();
        this.emit(RoomEvent.TrackUnsubscribed, gone.track, { source: trackSource, sid }, participant);
      }
    }
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
        this.remoteParticipants.delete(ev.identity ?? "");
        this.emit(RoomEvent.ParticipantDisconnected, { identity: ev.identity });
        break;
      case "video_track":
        this.onVideoTrack(ev);
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
    await invoke(kind === "audioinput" ? "voice_set_input" : "voice_set_output", {
      deviceId,
      label: deviceLabels.get(deviceId) ?? null,
    });
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
