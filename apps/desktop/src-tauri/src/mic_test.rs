//! Microphone test for Linux: lists the real PulseAudio/PipeWire devices, shows a live input level
//! and can play your own voice back so you can hear how you sound with the chosen processing.
//!
//! Linux only because the Linux webview has no WebRTC (see voice.rs); on Windows and macOS the
//! settings screen does the same with the webview's own audio. Capture and playback use the
//! PulseAudio API, which PipeWire also speaks, so it works on both.

use crate::voice::{AudioDevice, AudioDevices};

#[cfg(target_os = "linux")]
mod imp {
    use super::{AudioDevice, AudioDevices};
    use libpulse_binding as pulse;
    use libpulse_simple_binding::Simple;
    use crate::audio_pipeline::{new_shared_apm, MicProcessor, NoiseMode, Processing};
    use pulse::callbacks::ListResult;
    use pulse::context::{Context, FlagSet, State};
    use pulse::def::BufferAttr;
    use pulse::mainloop::standard::{IterateResult, Mainloop};
    use pulse::sample::{Format, Spec};
    use pulse::stream::Direction;
    use serde_json::json;
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use tauri::{AppHandle, Emitter, State as TauriState};

    const EVENT: &str = "voice://mic-level";
    const RATE: u32 = 48_000;
    /// 10 ms of mono 16-bit audio, the block the audio processor works on.
    const BLOCK_SAMPLES: usize = (RATE / 100) as usize;

    /// Lists input and output devices as the system sound server sees them.
    pub fn list_devices() -> Result<AudioDevices, String> {
        let mut ml = Mainloop::new().ok_or("Could not start the audio client")?;
        let mut ctx = Context::new(&ml, "Nexe").ok_or("Could not create the audio client")?;
        ctx.connect(None, FlagSet::NOFLAGS, None).map_err(|e| format!("No sound server: {e}"))?;
        loop {
            match ml.iterate(true) {
                IterateResult::Success(_) => {}
                _ => return Err("The sound server closed the connection".into()),
            }
            match ctx.get_state() {
                State::Ready => break,
                State::Failed | State::Terminated => return Err("No sound server".into()),
                _ => {}
            }
        }

        let inputs = Rc::new(RefCell::new(vec![AudioDevice { device_id: String::new(), label: "Default".into() }]));
        let outputs = Rc::new(RefCell::new(vec![AudioDevice { device_id: String::new(), label: "Default".into() }]));
        let done = Rc::new(Cell::new(0u8));

        let (i, d) = (inputs.clone(), done.clone());
        ctx.introspect().get_source_info_list(move |r| match r {
            ListResult::Item(s) => {
                // Monitors capture what a speaker plays; they are not microphones.
                if s.monitor_of_sink.is_none() {
                    if let Some(name) = &s.name {
                        let label = s.description.as_deref().unwrap_or(name.as_ref()).to_string();
                        i.borrow_mut().push(AudioDevice { device_id: name.to_string(), label });
                    }
                }
            }
            _ => d.set(d.get() + 1),
        });
        let (o, d) = (outputs.clone(), done.clone());
        ctx.introspect().get_sink_info_list(move |r| match r {
            ListResult::Item(s) => {
                if let Some(name) = &s.name {
                    let label = s.description.as_deref().unwrap_or(name.as_ref()).to_string();
                    o.borrow_mut().push(AudioDevice { device_id: name.to_string(), label });
                }
            }
            _ => d.set(d.get() + 1),
        });

        while done.get() < 2 {
            if !matches!(ml.iterate(true), IterateResult::Success(_)) {
                return Err("The sound server closed the connection".into());
            }
        }
        ctx.disconnect();
        let (inputs, outputs) = (inputs.borrow().clone(), outputs.borrow().clone());
        Ok(AudioDevices { inputs, outputs })
    }

    struct Running {
        stop: Arc<AtomicBool>,
        thread: std::thread::JoinHandle<()>,
    }

    #[derive(Default)]
    pub struct MicTestState {
        running: Mutex<Option<Running>>,
    }

    impl MicTestState {
        fn stop(&self) {
            if let Some(r) = self.running.lock().unwrap().take() {
                r.stop.store(true, Ordering::SeqCst);
                let _ = r.thread.join();
            }
        }
    }

    struct Settings {
        input: Option<String>,
        output: Option<String>,
        loopback: bool,
        noise: NoiseMode,
        gain: bool,
    }

    fn nonempty(s: Option<String>) -> Option<String> {
        s.filter(|v| !v.is_empty())
    }

    fn run(emit: &dyn Fn(serde_json::Value), stop: Arc<AtomicBool>, cfg: Settings) {
        let spec = Spec { format: Format::S16le, channels: 1, rate: RATE };
        let block_bytes = (BLOCK_SAMPLES * 2) as u32;
        let rec_attr = BufferAttr { maxlength: u32::MAX, tlength: u32::MAX, prebuf: u32::MAX, minreq: u32::MAX, fragsize: block_bytes };
        let rec = match Simple::new(None, "Nexe", Direction::Record, cfg.input.as_deref(), "Microphone test", &spec, None, Some(&rec_attr)) {
            Ok(s) => s,
            Err(e) => {
                emit(json!({ "error": format!("Could not open the microphone: {e}") }));
                return;
            }
        };
        // ~40 ms of playback buffer keeps the monitoring delay short without crackling.
        let play_attr = BufferAttr { maxlength: u32::MAX, tlength: block_bytes * 4, prebuf: u32::MAX, minreq: u32::MAX, fragsize: u32::MAX };
        let play = if cfg.loopback {
            match Simple::new(None, "Nexe", Direction::Playback, cfg.output.as_deref(), "Microphone test", &spec, None, Some(&play_attr)) {
                Ok(s) => Some(s),
                Err(e) => {
                    emit(json!({ "error": format!("Could not open the speakers: {e}") }));
                    return;
                }
            }
        } else {
            None
        };

        // No playback reference exists here, so echo cancellation has nothing to cancel in a test.
        let chain = Processing { echo: false, gain: cfg.gain, noise: cfg.noise };
        let mut proc = MicProcessor::new(chain, new_shared_apm(chain));
        let mut bytes = vec![0u8; BLOCK_SAMPLES * 2];
        let mut samples = vec![0i16; BLOCK_SAMPLES];
        let (mut rms_acc, mut peak, mut blocks) = (0f64, 0f64, 0u32);

        while !stop.load(Ordering::SeqCst) {
            if rec.read(&mut bytes).is_err() {
                break;
            }
            for (s, b) in samples.iter_mut().zip(bytes.chunks_exact(2)) {
                *s = i16::from_le_bytes([b[0], b[1]]);
            }
            proc.process(&mut samples);

            let mut sum = 0f64;
            for s in &samples {
                let v = (*s as f64 / 32768.0).abs();
                sum += v * v;
                peak = peak.max(v);
            }
            rms_acc = rms_acc.max((sum / samples.len() as f64).sqrt());
            blocks += 1;

            if let Some(play) = &play {
                for (s, b) in samples.iter().zip(bytes.chunks_exact_mut(2)) {
                    b.copy_from_slice(&s.to_le_bytes());
                }
                if play.write(&bytes).is_err() {
                    break;
                }
            }

            // ~20 updates a second is smooth for a level bar without flooding the UI.
            if blocks >= 5 {
                emit(json!({ "rms": rms_acc, "peak": peak }));
                (rms_acc, peak, blocks) = (0.0, 0.0, 0);
            }
        }
        emit(json!({ "rms": 0.0, "peak": 0.0, "stopped": true }));
    }

    /// `NEXE_MIC_SELFTEST=1 nexe`: lists the devices, runs a 4 s test with playback and prints the
    /// levels, so the audio path can be checked on a machine without a screen or a login.
    pub fn selftest() {
        println!("devices: {:?}", list_devices().map(|d| (
            d.inputs.iter().map(|x| format!("{}={}", x.device_id, x.label)).collect::<Vec<_>>(),
            d.outputs.iter().map(|x| format!("{}={}", x.device_id, x.label)).collect::<Vec<_>>(),
        )));
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let mode = NoiseMode::parse(&std::env::var("NEXE_MIC_SELFTEST").unwrap_or_default());
        let cfg = Settings { input: None, output: None, loopback: true, noise: mode, gain: true };
        let worker = std::thread::spawn(move || run(&|v| println!("level: {v}"), flag, cfg));
        std::thread::sleep(std::time::Duration::from_secs(4));
        stop.store(true, Ordering::SeqCst);
        let _ = worker.join();
    }

    #[tauri::command]
    pub async fn mic_test_list_devices() -> Result<AudioDevices, String> {
        tauri::async_runtime::spawn_blocking(list_devices).await.map_err(|e| e.to_string())?
    }

    #[tauri::command]
    #[allow(clippy::too_many_arguments)]
    pub fn mic_test_start(
        app: AppHandle,
        state: TauriState<'_, MicTestState>,
        input: Option<String>,
        output: Option<String>,
        loopback: bool,
        _echo_cancellation: bool,
        noise_mode: String,
        auto_gain: bool,
    ) -> Result<(), String> {
        state.stop();
        let stop = Arc::new(AtomicBool::new(false));
        let cfg = Settings {
            input: nonempty(input),
            output: nonempty(output),
            loopback,
            noise: NoiseMode::parse(&noise_mode),
            gain: auto_gain,
        };
        let flag = stop.clone();
        let thread = std::thread::Builder::new()
            .name("mic-test".into())
            .spawn(move || run(&|v| { let _ = app.emit(EVENT, v); }, flag, cfg))
            .map_err(|e| e.to_string())?;
        *state.running.lock().unwrap() = Some(Running { stop, thread });
        Ok(())
    }

    #[tauri::command]
    pub fn mic_test_stop(state: TauriState<'_, MicTestState>) {
        state.stop();
    }
}

#[cfg(not(target_os = "linux"))]
mod imp {
    use super::AudioDevices;

    pub fn selftest() {}

    #[derive(Default)]
    pub struct MicTestState;

    #[tauri::command]
    pub async fn mic_test_list_devices() -> Result<AudioDevices, String> {
        Ok(AudioDevices::default())
    }
    #[tauri::command]
    #[allow(clippy::too_many_arguments)]
    pub fn mic_test_start(
        _input: Option<String>,
        _output: Option<String>,
        _loopback: bool,
        _echo_cancellation: bool,
        _noise_mode: String,
        _auto_gain: bool,
    ) -> Result<(), String> {
        Err("The native microphone test is only used on Linux".into())
    }
    #[tauri::command]
    pub fn mic_test_stop() {}
}

pub use imp::*;
