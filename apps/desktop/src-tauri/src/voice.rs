//! Native voice engine for Linux.
//!
//! The WebKitGTK shipped in the GNOME Flatpak runtime has no WebRTC (`RTCPeerConnection` is
//! undefined), so livekit-client cannot run there. On Linux the call runs here instead, on the
//! LiveKit Rust SDK with its own libwebrtc; audio capture, playback, mixing and the microphone
//! processing (echo cancellation, noise suppression, DeepFilterNet) live in `audio_pipeline.rs`.
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
    use crate::audio_pipeline::{CallAudio, NoiseMode, Processing, RATE};
    use crate::video::imp::{read_track, FrameSink, VideoHub};
    use futures_util::StreamExt;
    use livekit::options::TrackPublishOptions;
    use livekit::prelude::*;
    use livekit::webrtc::audio_frame::AudioFrame;
    use livekit::webrtc::audio_source::native::NativeAudioSource;
    use livekit::webrtc::audio_source::{AudioSourceOptions, RtcAudioSource};
    use livekit::webrtc::audio_stream::native::NativeAudioStream;
    use serde_json::json;
    use std::borrow::Cow;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tauri::{AppHandle, Emitter, State};
    use tokio::sync::Mutex;

    const EVENT: &str = "voice://event";

    struct Session {
        room: Arc<Room>,
        audio: Arc<CallAudio>,
        mic: LocalAudioTrack,
        events: tauri::async_runtime::JoinHandle<()>,
        sender: tauri::async_runtime::JoinHandle<()>,
    }

    #[derive(Default)]
    pub struct VoiceState {
        session: Mutex<Option<Session>>,
        video: Arc<VideoHub>,
    }

    /// Where call events go: the UI in the app, stdout in the self-test.
    type Emit = Arc<dyn Fn(serde_json::Value) + Send + Sync>;

    fn quality_name(q: ConnectionQuality) -> &'static str {
        match q {
            ConnectionQuality::Excellent => "excellent",
            ConnectionQuality::Good => "good",
            ConnectionQuality::Poor => "poor",
            ConnectionQuality::Lost => "lost",
        }
    }

    fn processing(echo: Option<bool>, noise_mode: Option<String>, auto_gain: Option<bool>) -> Processing {
        Processing {
            echo: echo.unwrap_or(true),
            gain: auto_gain.unwrap_or(true),
            noise: NoiseMode::parse(noise_mode.as_deref().unwrap_or("standard")),
        }
    }

    async fn run_events(
        emit: Emit,
        room: Arc<Room>,
        audio: Arc<CallAudio>,
        video: Arc<VideoHub>,
        mut rx: tokio::sync::mpsc::UnboundedReceiver<RoomEvent>,
    ) {
        // One reader per remote audio track, feeding the mixer; aborted when the track goes away.
        let mut readers: HashMap<String, tauri::async_runtime::JoinHandle<()>> = HashMap::new();
        // The same for video, keyed `identity|source`.
        let mut video_readers: HashMap<String, tauri::async_runtime::JoinHandle<()>> = HashMap::new();

        while let Some(ev) = rx.recv().await {
            match ev {
                RoomEvent::ParticipantConnected(p) => {
                    emit(json!({ "kind": "participant_connected", "identity": p.identity().as_str() }));
                }
                RoomEvent::ParticipantDisconnected(p) => {
                    let id = p.identity().to_string();
                    let prefix = format!("{id}|");
                    video_readers.retain(|key, h| {
                        let drop_it = key.starts_with(&prefix);
                        if drop_it {
                            h.abort();
                            video.detach(key);
                        }
                        !drop_it
                    });
                    readers.retain(|key, h| {
                        let drop_it = key.starts_with(&prefix);
                        if drop_it {
                            h.abort();
                            audio.shared.mixer.lock().unwrap().remove(key);
                        }
                        !drop_it
                    });
                    emit(json!({ "kind": "participant_disconnected", "identity": id }));
                }
                RoomEvent::TrackSubscribed { track: RemoteTrack::Audio(t), publication, participant } => {
                    let identity = participant.identity().to_string();
                    let key = format!("{identity}|{}", publication.sid());
                    let shared = audio.clone();
                    let (k, id) = (key.clone(), identity);
                    let reader = tauri::async_runtime::spawn(async move {
                        let mut stream = NativeAudioStream::new(t.rtc_track(), RATE as i32, 1);
                        while let Some(frame) = stream.next().await {
                            shared.shared.mixer.lock().unwrap().push(&k, &id, &frame.data);
                        }
                        shared.shared.mixer.lock().unwrap().remove(&k);
                    });
                    if let Some(old) = readers.insert(key, reader) {
                        old.abort();
                    }
                }
                RoomEvent::TrackUnsubscribed { track: RemoteTrack::Audio(_), publication, participant } => {
                    let key = format!("{}|{}", participant.identity(), publication.sid());
                    if let Some(h) = readers.remove(&key) {
                        h.abort();
                    }
                    audio.shared.mixer.lock().unwrap().remove(&key);
                }
                RoomEvent::TrackSubscribed { track: RemoteTrack::Video(t), publication, participant } => {
                    let source = video_source_name(publication.source());
                    let identity = participant.identity().to_string();
                    let key = format!("{identity}|{source}");
                    let reader = tauri::async_runtime::spawn(read_track(video.clone(), key.clone(), t.rtc_track()));
                    if let Some(old) = video_readers.insert(key, reader) {
                        old.abort();
                    }
                    emit(json!({ "kind": "video_track", "identity": identity, "source": source, "present": true, "sid": publication.sid().to_string() }));
                }
                RoomEvent::TrackUnsubscribed { track: RemoteTrack::Video(_), publication, participant } => {
                    let source = video_source_name(publication.source());
                    let identity = participant.identity().to_string();
                    let key = format!("{identity}|{source}");
                    if let Some(h) = video_readers.remove(&key) {
                        h.abort();
                    }
                    video.detach(&key);
                    emit(json!({ "kind": "video_track", "identity": identity, "source": source, "present": false, "sid": publication.sid().to_string() }));
                }
                RoomEvent::ActiveSpeakersChanged { speakers } => {
                    let ids: Vec<String> = speakers.iter().map(|s| s.identity().to_string()).collect();
                    emit(json!({ "kind": "speakers", "identities": ids }));
                }
                RoomEvent::ConnectionQualityChanged { quality, participant } => {
                    if participant.identity() == room.local_participant().identity() {
                        emit(json!({ "kind": "quality", "quality": quality_name(quality) }));
                    }
                }
                RoomEvent::Disconnected { .. } => {
                    emit(json!({ "kind": "disconnected" }));
                    break;
                }
                _ => {}
            }
        }
        for (_, h) in readers.into_iter().chain(video_readers) {
            h.abort();
        }
        video.clear();
    }

    fn video_source_name(s: TrackSource) -> &'static str {
        if s == TrackSource::Screenshare { "screen" } else { "camera" }
    }

    struct ConnectArgs {
        url: String,
        token: String,
        echo_cancellation: Option<bool>,
        noise_mode: Option<String>,
        auto_gain: Option<bool>,
        input_device: Option<String>,
        output_device: Option<String>,
    }

    async fn connect_core(emit: Emit, video: Arc<VideoHub>, a: ConnectArgs) -> Result<Session, String> {
        // Microphone blocks flow from the capture thread to the call through this channel.
        let (mic_tx, mut mic_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<i16>>();
        let audio = Arc::new(CallAudio::start(
            processing(a.echo_cancellation, a.noise_mode, a.auto_gain),
            a.input_device,
            a.output_device,
            mic_tx,
        ));

        let (room, rx) = match Room::connect(&a.url, &a.token, RoomOptions::default()).await {
            Ok(r) => r,
            Err(e) => {
                stop_audio(audio);
                return Err(format!("Could not connect to the voice server: {e}"));
            }
        };
        let room = Arc::new(room);

        // The processing already happens in our chain, so the source must not process again.
        let source = NativeAudioSource::new(
            AudioSourceOptions { echo_cancellation: false, noise_suppression: false, auto_gain_control: false },
            RATE,
            1,
            100,
        );
        let mic = LocalAudioTrack::create_audio_track("microphone", RtcAudioSource::Native(source.clone()));
        // The microphone starts muted; the UI turns it on with voice_set_mic once connected.
        mic.mute();
        if let Err(e) = room
            .local_participant()
            .publish_track(
                LocalTrack::Audio(mic.clone()),
                TrackPublishOptions { source: TrackSource::Microphone, ..Default::default() },
            )
            .await
        {
            let _ = room.close().await;
            stop_audio(audio);
            return Err(format!("Could not publish the microphone: {e}"));
        }

        let sender = tauri::async_runtime::spawn(async move {
            while let Some(block) = mic_rx.recv().await {
                let frame = AudioFrame {
                    samples_per_channel: block.len() as u32,
                    data: Cow::Owned(block),
                    sample_rate: RATE,
                    num_channels: 1,
                };
                if let Err(e) = source.capture_frame(&frame).await {
                    if std::env::var_os("NEXE_AUDIO_DEBUG").is_some() {
                        eprintln!("audio: capture_frame failed: {e}");
                    }
                }
            }
        });
        let events = tauri::async_runtime::spawn(run_events(emit, room.clone(), audio.clone(), video, rx));
        Ok(Session { room, audio, mic, events, sender })
    }

    #[tauri::command]
    #[allow(clippy::too_many_arguments)]
    pub async fn voice_connect(
        app: AppHandle,
        state: State<'_, VoiceState>,
        url: String,
        token: String,
        echo_cancellation: Option<bool>,
        noise_mode: Option<String>,
        auto_gain: Option<bool>,
        input_device: Option<String>,
        output_device: Option<String>,
    ) -> Result<(), String> {
        let mut slot = state.session.lock().await;
        if let Some(old) = slot.take() {
            shutdown(old).await;
        }
        let emit: Emit = Arc::new(move |v| {
            let _ = app.emit(EVENT, v);
        });
        let args = ConnectArgs { url, token, echo_cancellation, noise_mode, auto_gain, input_device, output_device };
        *slot = Some(connect_core(emit, state.video.clone(), args).await?);
        Ok(())
    }

    /// `NEXE_CALL_SELFTEST="url|token|seconds|noise_mode" nexe`: joins a call with the real engine on
    /// this machine's default devices, unmutes, prints the events and leaves. For checking the call
    /// audio on a machine without a screen or a login.
    pub fn selftest() {
        let spec = std::env::var("NEXE_CALL_SELFTEST").unwrap_or_default();
        let mut parts = spec.splitn(4, '|');
        let (url, token) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string());
        let secs: u64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(15);
        let mode = parts.next().map(str::to_string);
        tauri::async_runtime::block_on(async move {
            let emit: Emit = Arc::new(|v| println!("event: {v}"));
            let args = ConnectArgs {
                url,
                token,
                echo_cancellation: Some(true),
                noise_mode: mode,
                auto_gain: Some(true),
                input_device: None,
                output_device: None,
            };
            match connect_core(emit, Arc::new(VideoHub::default()), args).await {
                Ok(s) => {
                    println!("selftest: connected");
                    s.audio.shared.mic_on.store(true, std::sync::atomic::Ordering::SeqCst);
                    s.mic.unmute();
                    tokio::time::sleep(std::time::Duration::from_secs(secs)).await;
                    shutdown(s).await;
                    println!("selftest: left");
                }
                Err(e) => println!("selftest: FAILED {e}"),
            }
        });
    }

    /// `NEXE_VIDEO_SELFTEST="url|token|seconds|pub|recv" nexe`: no screen needed. `pub` publishes a moving
    /// 1280x720 picture at 30 fps as a camera; `recv` joins, receives the video the way the app does
    /// (JPEG pictures) and prints how many arrive, how fast, how big, and the CPU it took. With
    /// `NEXE_VIDEO_OUT=dir` it also keeps the last picture as dir/last.jpg.
    pub fn video_selftest() {
        use livekit::webrtc::video_frame::{I420Buffer, VideoFrame, VideoRotation};
        use livekit::webrtc::video_source::native::NativeVideoSource;
        use livekit::webrtc::video_source::{RtcVideoSource, VideoResolution};
        use std::sync::atomic::{AtomicU64, Ordering};

        let spec = std::env::var("NEXE_VIDEO_SELFTEST").unwrap_or_default();
        let mut parts = spec.splitn(4, '|');
        let (url, token) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string());
        let secs: u64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(10);
        let role = parts.next().unwrap_or("recv").to_string();

        tauri::async_runtime::block_on(async move {
            let (room, mut rx) = match Room::connect(&url, &token, RoomOptions::default()).await {
                Ok(r) => r,
                Err(e) => return println!("video: FAILED to connect: {e}"),
            };
            println!("video: connected as {role}");
            if role == "pub" {
                let (w, h) = (1280u32, 720u32);
                let source = NativeVideoSource::new(VideoResolution { width: w, height: h }, false);
                let track = LocalVideoTrack::create_video_track("camera", RtcVideoSource::Native(source.clone()));
                if let Err(e) = room
                    .local_participant()
                    .publish_track(LocalTrack::Video(track), TrackPublishOptions { source: TrackSource::Camera, ..Default::default() })
                    .await
                {
                    return println!("video: FAILED to publish: {e}");
                }
                let started = std::time::Instant::now();
                let mut tick = tokio::time::interval(std::time::Duration::from_millis(33));
                let mut n: u32 = 0;
                while started.elapsed().as_secs() < secs {
                    tick.tick().await;
                    let mut buf = I420Buffer::new(w, h);
                    let (sy, su, sv) = buf.strides();
                    let (y, u, v) = buf.data_mut();
                    for row in 0..h as usize {
                        for col in 0..w as usize {
                            // A sliding gradient with a fine grid, so there is detail to compress.
                            let g = ((col + n as usize * 6) % 256) as u8;
                            let grid = if (col / 8 + row / 8) % 2 == 0 { 24 } else { 0 };
                            y[row * sy as usize + col] = g.saturating_add(grid);
                        }
                    }
                    for row in 0..(h / 2) as usize {
                        for col in 0..(w / 2) as usize {
                            u[row * su as usize + col] = ((col * 2 + n as usize) % 256) as u8;
                            v[row * sv as usize + col] = (row * 2 % 256) as u8;
                        }
                    }
                    source.capture_frame(&VideoFrame { rotation: VideoRotation::VideoRotation0, timestamp_us: n as i64 * 33_333, frame_metadata: None, buffer: buf });
                    n += 1;
                }
                println!("video: published {n} frames");
            } else {
                let hub = Arc::new(VideoHub::default());
                let frames = Arc::new(AtomicU64::new(0));
                let bytes = Arc::new(AtomicU64::new(0));
                let out = std::env::var("NEXE_VIDEO_OUT").ok();
                let (f2, b2) = (frames.clone(), bytes.clone());
                hub.attach("*".into(), Arc::new(move |jpeg: Vec<u8>| {
                    f2.fetch_add(1, Ordering::SeqCst);
                    b2.fetch_add(jpeg.len() as u64, Ordering::SeqCst);
                    if let Some(dir) = &out {
                        let _ = std::fs::write(format!("{dir}/last.jpg"), &jpeg);
                    }
                }));
                let cpu = || -> f64 {
                    let s = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
                    let f: Vec<&str> = s.rsplit(')').next().unwrap_or("").split_whitespace().collect();
                    (f.get(11).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0) + f.get(12).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0)) / 100.0
                };
                let started = std::time::Instant::now();
                let mut first = None;
                let mut cpu0 = 0.0;
                let mut readers = Vec::new();
                while started.elapsed().as_secs() < secs {
                    match tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv()).await {
                        Ok(Some(RoomEvent::TrackSubscribed { track: RemoteTrack::Video(t), participant, .. })) => {
                            println!("video: subscribed to {}", participant.identity());
                            first = Some(std::time::Instant::now());
                            cpu0 = cpu();
                            readers.push(tauri::async_runtime::spawn(read_track(hub.clone(), "x".into(), t.rtc_track())));
                        }
                        Ok(None) => break,
                        _ => {}
                    }
                }
                let n = frames.load(Ordering::SeqCst);
                let secs_rx = first.map(|f| f.elapsed().as_secs_f64()).unwrap_or(0.0);
                println!(
                    "video: received {n} pictures in {secs_rx:.1}s = {:.1} fps, avg {:.0} KB, cpu {:.0}% of one core",
                    n as f64 / secs_rx.max(0.001),
                    bytes.load(Ordering::SeqCst) as f64 / n.max(1) as f64 / 1024.0,
                    (cpu() - cpu0) / secs_rx.max(0.001) * 100.0
                );
                for r in readers { r.abort(); }
            }
            let _ = room.close().await;
        });
    }

    fn stop_audio(audio: Arc<CallAudio>) {
        // The reader tasks hold clones until they are aborted, so wait for the last one off-thread.
        std::thread::spawn(move || {
            while Arc::strong_count(&audio) > 1 {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            if let Ok(a) = Arc::try_unwrap(audio) {
                a.stop();
            }
        });
    }

    async fn shutdown(s: Session) {
        s.events.abort();
        s.sender.abort();
        let _ = s.room.close().await;
        stop_audio(s.audio);
    }

    #[tauri::command]
    pub async fn voice_disconnect(state: State<'_, VoiceState>) -> Result<(), String> {
        if let Some(s) = state.session.lock().await.take() {
            shutdown(s).await;
        }
        Ok(())
    }

    /// Starts sending the pictures of a remote camera or screen to the UI (`source`: camera or screen).
    #[tauri::command]
    pub fn voice_video_attach(
        state: State<'_, VoiceState>,
        identity: String,
        source: String,
        on_frame: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
    ) {
        let sink: FrameSink = Arc::new(move |bytes| {
            let _ = on_frame.send(tauri::ipc::InvokeResponseBody::Raw(bytes));
        });
        state.video.attach(format!("{identity}|{source}"), sink);
    }

    #[tauri::command]
    pub fn voice_video_detach(state: State<'_, VoiceState>, identity: String, source: String) {
        state.video.detach(&format!("{identity}|{source}"));
    }

    #[tauri::command]
    pub async fn voice_set_mic(state: State<'_, VoiceState>, enabled: bool) -> Result<(), String> {
        let slot = state.session.lock().await;
        let s = slot.as_ref().ok_or("Not in a call")?;
        s.audio.shared.mic_on.store(enabled, std::sync::atomic::Ordering::SeqCst);
        if enabled {
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
        s.audio.shared.deafened.store(deafened, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    /// Per-user volume, 0 (silent) to 1 (normal), applied while mixing.
    #[tauri::command]
    pub async fn voice_set_volume(state: State<'_, VoiceState>, identity: String, volume: f32) -> Result<(), String> {
        let slot = state.session.lock().await;
        let s = slot.as_ref().ok_or("Not in a call")?;
        s.audio.shared.mixer.lock().unwrap().set_gain(&identity, volume);
        Ok(())
    }

    #[tauri::command]
    pub async fn voice_set_input(
        state: State<'_, VoiceState>,
        device_id: String,
        _label: Option<String>,
    ) -> Result<(), String> {
        let slot = state.session.lock().await;
        let s = slot.as_ref().ok_or("Not in a call")?;
        s.audio.set_input(Some(device_id));
        Ok(())
    }

    #[tauri::command]
    pub async fn voice_set_output(
        state: State<'_, VoiceState>,
        device_id: String,
        _label: Option<String>,
    ) -> Result<(), String> {
        let slot = state.session.lock().await;
        let s = slot.as_ref().ok_or("Not in a call")?;
        s.audio.set_output(Some(device_id));
        Ok(())
    }

    /// Changes echo cancellation, noise suppression mode or gain control while in a call.
    #[tauri::command]
    pub async fn voice_set_processing(
        state: State<'_, VoiceState>,
        echo_cancellation: Option<bool>,
        noise_mode: Option<String>,
        auto_gain: Option<bool>,
    ) -> Result<(), String> {
        let slot = state.session.lock().await;
        let s = slot.as_ref().ok_or("Not in a call")?;
        s.audio.set_processing(processing(echo_cancellation, noise_mode, auto_gain));
        Ok(())
    }
}

/// Other platforms never create the native room (their webview has WebRTC); the commands exist so
/// the invoke handler is the same everywhere.
#[cfg(not(target_os = "linux"))]
mod imp {
    pub fn selftest() {}
    pub fn video_selftest() {}

    #[derive(Default)]
    pub struct VoiceState;

    const NO: &str = "The native voice engine is only used on Linux";

    #[tauri::command]
    #[allow(clippy::too_many_arguments)]
    pub async fn voice_connect(
        _url: String,
        _token: String,
        _echo_cancellation: Option<bool>,
        _noise_mode: Option<String>,
        _auto_gain: Option<bool>,
        _input_device: Option<String>,
        _output_device: Option<String>,
    ) -> Result<(), String> {
        Err(NO.into())
    }
    #[tauri::command]
    pub async fn voice_disconnect() -> Result<(), String> { Ok(()) }
    #[tauri::command]
    pub fn voice_video_attach(_identity: String, _source: String, _on_frame: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>) {}
    #[tauri::command]
    pub fn voice_video_detach(_identity: String, _source: String) {}
    #[tauri::command]
    pub async fn voice_set_mic(_enabled: bool) -> Result<(), String> { Err(NO.into()) }
    #[tauri::command]
    pub async fn voice_set_deafen(_deafened: bool) -> Result<(), String> { Err(NO.into()) }
    #[tauri::command]
    pub async fn voice_set_volume(_identity: String, _volume: f32) -> Result<(), String> { Err(NO.into()) }
    #[tauri::command]
    pub async fn voice_set_processing(
        _echo_cancellation: Option<bool>,
        _noise_mode: Option<String>,
        _auto_gain: Option<bool>,
    ) -> Result<(), String> { Err(NO.into()) }
    #[tauri::command]
    pub async fn voice_set_input(_device_id: String, _label: Option<String>) -> Result<(), String> { Err(NO.into()) }
    #[tauri::command]
    pub async fn voice_set_output(_device_id: String, _label: Option<String>) -> Result<(), String> { Err(NO.into()) }
}

pub use imp::*;
