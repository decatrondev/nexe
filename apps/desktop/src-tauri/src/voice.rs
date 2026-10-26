//! Native voice engine for Linux.
//!
//! The WebKitGTK shipped in the GNOME Flatpak runtime has no WebRTC (`RTCPeerConnection` is
//! undefined), so livekit-client cannot run there. On Linux the call runs here instead, on the
//! LiveKit Rust SDK with its own libwebrtc; audio capture/playback, device selection and
//! echo-cancellation/noise-suppression come from the SDK's `PlatformAudio` (PulseAudio/ALSA).
//! `src/lib/nativeRoom.ts` exposes this to the UI. Windows and macOS keep using the webview.

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct AudioDevice {
    #[serde(rename = "deviceId")]
    pub device_id: String,
    pub label: String,
}

#[derive(Serialize, Default)]
pub struct AudioDevices {
    pub inputs: Vec<AudioDevice>,
    pub outputs: Vec<AudioDevice>,
}

#[cfg(target_os = "linux")]
mod imp {
    use super::{AudioDevice, AudioDevices};
    use livekit::prelude::*;
    use livekit::options::TrackPublishOptions;
    use livekit::{AudioProcessingOptions, PlatformAudio, PlayoutDeviceId, RecordingDeviceId};
    use serde_json::json;
    use std::collections::{HashMap, HashSet};
    use std::sync::Arc;
    use tauri::{AppHandle, Emitter, State};
    use tokio::sync::Mutex;

    const EVENT: &str = "voice://event";

    struct Session {
        room: Arc<Room>,
        audio: PlatformAudio,
        mic: LocalAudioTrack,
        remote: Arc<Mutex<Remote>>,
        events: tauri::async_runtime::JoinHandle<()>,
    }

    /// Remote audio tracks by participant identity, plus what the user asked to silence.
    #[derive(Default)]
    struct Remote {
        tracks: HashMap<String, Vec<RemoteAudioTrack>>,
        deafened: bool,
        muted_users: HashSet<String>,
    }

    impl Remote {
        fn apply(&self, identity: &str, track: &RemoteAudioTrack) {
            if self.deafened || self.muted_users.contains(identity) {
                track.disable();
            } else {
                track.enable();
            }
        }

        fn apply_all(&self) {
            for (identity, tracks) in &self.tracks {
                for t in tracks {
                    self.apply(identity, t);
                }
            }
        }
    }

    #[derive(Default)]
    pub struct VoiceState {
        session: Mutex<Option<Session>>,
    }

    fn emit(app: &AppHandle, payload: serde_json::Value) {
        let _ = app.emit(EVENT, payload);
    }

    fn quality_name(q: ConnectionQuality) -> &'static str {
        match q {
            ConnectionQuality::Excellent => "excellent",
            ConnectionQuality::Good => "good",
            ConnectionQuality::Poor => "poor",
            ConnectionQuality::Lost => "lost",
        }
    }

    async fn run_events(
        app: AppHandle,
        room: Arc<Room>,
        remote: Arc<Mutex<Remote>>,
        mut rx: tokio::sync::mpsc::UnboundedReceiver<RoomEvent>,
    ) {
        while let Some(ev) = rx.recv().await {
            match ev {
                RoomEvent::ParticipantConnected(p) => {
                    emit(&app, json!({ "kind": "participant_connected", "identity": p.identity().as_str() }));
                }
                RoomEvent::ParticipantDisconnected(p) => {
                    let id = p.identity().to_string();
                    remote.lock().await.tracks.remove(&id);
                    emit(&app, json!({ "kind": "participant_disconnected", "identity": id }));
                }
                RoomEvent::TrackSubscribed { track: RemoteTrack::Audio(t), participant, .. } => {
                    let id = participant.identity().to_string();
                    let mut r = remote.lock().await;
                    r.apply(&id, &t);
                    r.tracks.entry(id).or_default().push(t);
                }
                RoomEvent::TrackUnsubscribed { track: RemoteTrack::Audio(t), participant, .. } => {
                    let id = participant.identity().to_string();
                    if let Some(list) = remote.lock().await.tracks.get_mut(&id) {
                        list.retain(|x| x.sid() != t.sid());
                    }
                }
                RoomEvent::ActiveSpeakersChanged { speakers } => {
                    let ids: Vec<String> = speakers.iter().map(|s| s.identity().to_string()).collect();
                    emit(&app, json!({ "kind": "speakers", "identities": ids }));
                }
                RoomEvent::ConnectionQualityChanged { quality, participant } => {
                    if participant.identity() == room.local_participant().identity() {
                        emit(&app, json!({ "kind": "quality", "quality": quality_name(quality) }));
                    }
                }
                RoomEvent::Disconnected { .. } => {
                    emit(&app, json!({ "kind": "disconnected" }));
                    break;
                }
                _ => {}
            }
        }
    }

    #[tauri::command]
    pub async fn voice_connect(
        app: AppHandle,
        state: State<'_, VoiceState>,
        url: String,
        token: String,
        echo_cancellation: Option<bool>,
        noise_suppression: Option<bool>,
        auto_gain: Option<bool>,
    ) -> Result<(), String> {
        let mut slot = state.session.lock().await;
        if let Some(old) = slot.take() {
            old.events.abort();
            let _ = old.room.close().await;
        }

        let audio = PlatformAudio::new().map_err(|e| format!("No audio device: {e}"))?;
        audio
            .configure_audio_processing(AudioProcessingOptions {
                echo_cancellation: echo_cancellation.unwrap_or(true),
                noise_suppression: noise_suppression.unwrap_or(true),
                auto_gain_control: auto_gain.unwrap_or(true),
                prefer_hardware_processing: false,
            })
            .map_err(|e| format!("Audio processing: {e}"))?;

        let (room, rx) = Room::connect(&url, &token, RoomOptions::default())
            .await
            .map_err(|e| format!("Could not connect to the voice server: {e}"))?;
        let room = Arc::new(room);

        let mic = LocalAudioTrack::create_audio_track("microphone", audio.rtc_source());
        // The microphone starts muted; the UI turns it on with voice_set_mic once connected.
        mic.mute();
        room.local_participant()
            .publish_track(
                LocalTrack::Audio(mic.clone()),
                TrackPublishOptions { source: TrackSource::Microphone, ..Default::default() },
            )
            .await
            .map_err(|e| format!("Could not publish the microphone: {e}"))?;

        let remote = Arc::new(Mutex::new(Remote::default()));
        let events = tauri::async_runtime::spawn(run_events(app, room.clone(), remote.clone(), rx));

        *slot = Some(Session { room, audio, mic, remote, events });
        Ok(())
    }

    #[tauri::command]
    pub async fn voice_disconnect(state: State<'_, VoiceState>) -> Result<(), String> {
        if let Some(s) = state.session.lock().await.take() {
            s.events.abort();
            let _ = s.room.close().await;
            s.audio.release();
        }
        Ok(())
    }

    #[tauri::command]
    pub async fn voice_set_mic(state: State<'_, VoiceState>, enabled: bool) -> Result<(), String> {
        let slot = state.session.lock().await;
        let s = slot.as_ref().ok_or("Not in a call")?;
        if enabled {
            s.audio.start_recording().map_err(|e| format!("Microphone: {e}"))?;
            s.mic.unmute();
        } else {
            s.mic.mute();
        }
        Ok(())
    }

    #[tauri::command]
    pub async fn voice_set_deafen(state: State<'_, VoiceState>, deafened: bool) -> Result<(), String> {
        let slot = state.session.lock().await;
        let s = slot.as_ref().ok_or("Not in a call")?;
        let mut r = s.remote.lock().await;
        r.deafened = deafened;
        r.apply_all();
        Ok(())
    }

    /// Per-user volume. The engine has no gain control per remote track, so anything under 0.5
    /// silences that user and anything above restores them (the UI only uses 0 and 1).
    #[tauri::command]
    pub async fn voice_set_volume(state: State<'_, VoiceState>, identity: String, volume: f32) -> Result<(), String> {
        let slot = state.session.lock().await;
        let s = slot.as_ref().ok_or("Not in a call")?;
        let mut r = s.remote.lock().await;
        if volume < 0.5 {
            r.muted_users.insert(identity.clone());
        } else {
            r.muted_users.remove(&identity);
        }
        r.apply_all();
        Ok(())
    }

    fn list_with(audio: &PlatformAudio) -> AudioDevices {
        AudioDevices {
            inputs: audio
                .recording_devices()
                .map(|d| AudioDevice { device_id: d.id.as_str().to_string(), label: d.name })
                .collect(),
            outputs: audio
                .playout_devices()
                .map(|d| AudioDevice { device_id: d.id.as_str().to_string(), label: d.name })
                .collect(),
        }
    }

    #[tauri::command]
    pub async fn voice_list_devices(state: State<'_, VoiceState>) -> Result<AudioDevices, String> {
        if let Some(s) = state.session.lock().await.as_ref() {
            return Ok(list_with(&s.audio));
        }
        // Not in a call: a short-lived handle is enough to list the devices.
        Ok(PlatformAudio::new().map(|a| list_with(&a)).unwrap_or_default())
    }

    /// The settings list real sound-server devices; the call engine numbers them its own way, so
    /// match by name. An empty id means "system default", which is always the first entry.
    #[tauri::command]
    pub async fn voice_set_input(
        state: State<'_, VoiceState>,
        device_id: String,
        label: Option<String>,
    ) -> Result<(), String> {
        let slot = state.session.lock().await;
        let s = slot.as_ref().ok_or("Not in a call")?;
        let id = if device_id.is_empty() {
            RecordingDeviceId::from_index(0)
        } else {
            let label = label.unwrap_or_default();
            s.audio
                .recording_devices()
                .find(|d| d.name.contains(&device_id) || (!label.is_empty() && d.name.contains(&label)))
                .map(|d| d.id)
                .ok_or("That microphone is not available to the call engine")?
        };
        s.audio.switch_recording_device(&id).map_err(|e| format!("Input device: {e}"))
    }

    #[tauri::command]
    pub async fn voice_set_output(
        state: State<'_, VoiceState>,
        device_id: String,
        label: Option<String>,
    ) -> Result<(), String> {
        let slot = state.session.lock().await;
        let s = slot.as_ref().ok_or("Not in a call")?;
        let id = if device_id.is_empty() {
            PlayoutDeviceId::from_index(0)
        } else {
            let label = label.unwrap_or_default();
            s.audio
                .playout_devices()
                .find(|d| d.name.contains(&device_id) || (!label.is_empty() && d.name.contains(&label)))
                .map(|d| d.id)
                .ok_or("That speaker is not available to the call engine")?
        };
        s.audio.switch_playout_device(&id).map_err(|e| format!("Output device: {e}"))
    }
}

/// Other platforms never create the native room (their webview has WebRTC); the commands exist so
/// the invoke handler is the same everywhere.
#[cfg(not(target_os = "linux"))]
mod imp {
    use super::AudioDevices;

    #[derive(Default)]
    pub struct VoiceState;

    const NO: &str = "The native voice engine is only used on Linux";

    #[tauri::command]
    pub async fn voice_connect(
        _url: String,
        _token: String,
        _echo_cancellation: Option<bool>,
        _noise_suppression: Option<bool>,
        _auto_gain: Option<bool>,
    ) -> Result<(), String> {
        Err(NO.into())
    }
    #[tauri::command]
    pub async fn voice_disconnect() -> Result<(), String> { Ok(()) }
    #[tauri::command]
    pub async fn voice_set_mic(_enabled: bool) -> Result<(), String> { Err(NO.into()) }
    #[tauri::command]
    pub async fn voice_set_deafen(_deafened: bool) -> Result<(), String> { Err(NO.into()) }
    #[tauri::command]
    pub async fn voice_set_volume(_identity: String, _volume: f32) -> Result<(), String> { Err(NO.into()) }
    #[tauri::command]
    pub async fn voice_list_devices() -> Result<AudioDevices, String> { Ok(AudioDevices::default()) }
    #[tauri::command]
    pub async fn voice_set_input(_device_id: String, _label: Option<String>) -> Result<(), String> { Err(NO.into()) }
    #[tauri::command]
    pub async fn voice_set_output(_device_id: String, _label: Option<String>) -> Result<(), String> { Err(NO.into()) }
}

pub use imp::*;
