//! Audio engine shared by the call and the microphone test on Linux.
//!
//! Capture and playback talk to the sound server (PulseAudio, which PipeWire also speaks) in 10 ms
//! blocks of 48 kHz mono. The microphone goes through WebRTC's processor (echo cancellation, high
//! pass, optional standard noise suppression) and, when chosen, DeepFilterNet, then on to the call.
//! Remote voices are mixed here with a per-user gain, played, and fed back to the echo canceller
//! as its reference.

use deep_filter_net::tract::{DfParams, DfTract, RuntimeParams};
use libpulse_binding as pulse;
use libpulse_simple_binding::Simple;
use livekit::webrtc::native::apm::AudioProcessingModule;
use ndarray::{Array2, ArrayView2};
use pulse::def::BufferAttr;
use pulse::sample::{Format, Spec};
use pulse::stream::Direction;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

pub const RATE: u32 = 48_000;
/// 10 ms of mono audio: the block the processor and DeepFilterNet both work on.
pub const BLOCK: usize = (RATE / 100) as usize;

pub fn spec() -> Spec {
    Spec { format: Format::S16le, channels: 1, rate: RATE }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NoiseMode {
    Off,
    Standard,
    DeepFilterNet,
}

impl NoiseMode {
    pub fn parse(s: &str) -> Self {
        match s {
            "off" => Self::Off,
            "dfn" => Self::DeepFilterNet,
            _ => Self::Standard,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Processing {
    pub echo: bool,
    pub gain: bool,
    pub noise: NoiseMode,
}

fn build_apm(cfg: Processing) -> AudioProcessingModule {
    // With DeepFilterNet the gain control runs after it (see MicProcessor), not here.
    let gain_here = cfg.gain && cfg.noise != NoiseMode::DeepFilterNet;
    AudioProcessingModule::new(cfg.echo, gain_here, true, cfg.noise == NoiseMode::Standard)
}

pub type SharedApm = Arc<Mutex<AudioProcessingModule>>;

pub fn new_shared_apm(cfg: Processing) -> SharedApm {
    Arc::new(Mutex::new(build_apm(cfg)))
}

/// The microphone chain. Order matters: echo cancellation needs the raw signal, DeepFilterNet
/// should clean it before the gain control raises the level, otherwise noise gets amplified first.
pub struct MicProcessor {
    cfg: Processing,
    apm: SharedApm,
    gain_only: Option<AudioProcessingModule>,
    dfn: Option<Box<DfTract>>,
    dfn_in: Array2<f32>,
    dfn_out: Array2<f32>,
}

impl MicProcessor {
    pub fn new(cfg: Processing, apm: SharedApm) -> Self {
        let mut p = Self {
            cfg,
            apm,
            gain_only: None,
            dfn: None,
            dfn_in: Array2::zeros((1, BLOCK)),
            dfn_out: Array2::zeros((1, BLOCK)),
        };
        p.reconfigure(cfg);
        p
    }

    pub fn reconfigure(&mut self, cfg: Processing) {
        self.cfg = cfg;
        *self.apm.lock().unwrap() = build_apm(cfg);
        if cfg.noise == NoiseMode::DeepFilterNet {
            if self.dfn.is_none() {
                match DfTract::new(DfParams::default(), &RuntimeParams::default_with_ch(1)) {
                    Ok(m) => self.dfn = Some(Box::new(m)),
                    Err(e) => log::warn!("DeepFilterNet could not start, using standard suppression: {e}"),
                }
            }
            self.gain_only = cfg.gain.then(|| AudioProcessingModule::new(false, true, false, false));
        } else {
            self.dfn = None;
            self.gain_only = None;
        }
    }

    /// Cleans one 10 ms block in place.
    pub fn process(&mut self, block: &mut [i16]) {
        debug_assert_eq!(block.len(), BLOCK);
        let _ = self.apm.lock().unwrap().process_stream(block, RATE as i32, 1);
        if let Some(dfn) = self.dfn.as_mut() {
            for (f, s) in self.dfn_in.as_slice_mut().unwrap().iter_mut().zip(block.iter()) {
                *f = *s as f32 / 32768.0;
            }
            let input: ArrayView2<f32> = self.dfn_in.view();
            if dfn.process(input, self.dfn_out.view_mut()).is_ok() {
                for (s, f) in block.iter_mut().zip(self.dfn_out.as_slice().unwrap().iter()) {
                    *s = (f.clamp(-1.0, 1.0) * 32767.0) as i16;
                }
            }
            if let Some(g) = self.gain_only.as_mut() {
                let _ = g.process_stream(block, RATE as i32, 1);
            }
        }
    }
}

// ── Mixer ────────────────────────────────────────────────────────────────────────────────────

struct Source {
    identity: String,
    queue: VecDeque<i16>,
    /// Starts playing once a little audio is queued, so network jitter does not chop the voice.
    primed: bool,
}

#[derive(Default)]
pub struct Mixer {
    sources: HashMap<String, Source>,
    gains: HashMap<String, f32>,
}

const MAX_QUEUED: usize = BLOCK * 20; // 200 ms, anything older is dropped to keep the delay low
const PRIME: usize = BLOCK * 2; // 20 ms

impl Mixer {
    pub fn push(&mut self, key: &str, identity: &str, samples: &[i16]) {
        let src = self.sources.entry(key.to_string()).or_insert_with(|| Source {
            identity: identity.to_string(),
            queue: VecDeque::new(),
            primed: false,
        });
        src.queue.extend(samples.iter().copied());
        while src.queue.len() > MAX_QUEUED {
            src.queue.pop_front();
        }
        if src.queue.len() >= PRIME {
            src.primed = true;
        }
    }

    pub fn remove(&mut self, key: &str) {
        self.sources.remove(key);
    }

    pub fn set_gain(&mut self, identity: &str, gain: f32) {
        self.gains.insert(identity.to_string(), gain.clamp(0.0, 2.0));
    }

    /// Mixes the next 10 ms of everybody into `out`.
    pub fn pull(&mut self, out: &mut [i16]) {
        let mut acc = [0i32; BLOCK];
        for src in self.sources.values_mut() {
            if !src.primed {
                continue;
            }
            let gain = self.gains.get(&src.identity).copied().unwrap_or(1.0);
            for slot in acc.iter_mut() {
                match src.queue.pop_front() {
                    Some(s) => *slot += (s as f32 * gain) as i32,
                    None => {
                        src.primed = false; // underrun: wait to refill
                        break;
                    }
                }
            }
        }
        for (o, a) in out.iter_mut().zip(acc.iter()) {
            *o = (*a).clamp(i16::MIN as i32, i16::MAX as i32) as i16;
        }
    }
}

// ── Call audio ───────────────────────────────────────────────────────────────────────────────

pub struct Shared {
    pub mic_on: AtomicBool,
    pub deafened: AtomicBool,
    pub cfg: Mutex<Processing>,
    cfg_gen: AtomicU32,
    pub input: Mutex<Option<String>>,
    pub output: Mutex<Option<String>>,
    in_gen: AtomicU32,
    out_gen: AtomicU32,
    /// Latency of the playback stream in ms, used to tell the echo canceller how late the echo is.
    play_latency_ms: AtomicU32,
    pub mixer: Mutex<Mixer>,
    apm: SharedApm,
}

pub struct CallAudio {
    pub shared: Arc<Shared>,
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

fn nonempty(s: Option<String>) -> Option<String> {
    s.filter(|v| !v.is_empty())
}

impl CallAudio {
    /// Starts capture and playback. Processed microphone blocks are sent on `mic_tx`.
    pub fn start(
        cfg: Processing,
        input: Option<String>,
        output: Option<String>,
        mic_tx: tokio::sync::mpsc::UnboundedSender<Vec<i16>>,
    ) -> Self {
        let shared = Arc::new(Shared {
            mic_on: AtomicBool::new(false),
            deafened: AtomicBool::new(false),
            cfg: Mutex::new(cfg),
            cfg_gen: AtomicU32::new(0),
            input: Mutex::new(nonempty(input)),
            output: Mutex::new(nonempty(output)),
            in_gen: AtomicU32::new(0),
            out_gen: AtomicU32::new(0),
            play_latency_ms: AtomicU32::new(40),
            mixer: Mutex::new(Mixer::default()),
            apm: new_shared_apm(cfg),
        });
        let stop = Arc::new(AtomicBool::new(false));
        let mut threads = Vec::new();
        {
            let (sh, st) = (shared.clone(), stop.clone());
            threads.push(
                std::thread::Builder::new()
                    .name("call-capture".into())
                    .spawn(move || capture_loop(sh, st, mic_tx))
                    .expect("spawn capture thread"),
            );
        }
        {
            let (sh, st) = (shared.clone(), stop.clone());
            threads.push(
                std::thread::Builder::new()
                    .name("call-playout".into())
                    .spawn(move || playout_loop(sh, st))
                    .expect("spawn playout thread"),
            );
        }
        Self { shared, stop, threads }
    }

    pub fn set_processing(&self, cfg: Processing) {
        *self.shared.cfg.lock().unwrap() = cfg;
        self.shared.cfg_gen.fetch_add(1, Ordering::SeqCst);
    }

    pub fn set_input(&self, device: Option<String>) {
        *self.shared.input.lock().unwrap() = nonempty(device);
        self.shared.in_gen.fetch_add(1, Ordering::SeqCst);
    }

    pub fn set_output(&self, device: Option<String>) {
        *self.shared.output.lock().unwrap() = nonempty(device);
        self.shared.out_gen.fetch_add(1, Ordering::SeqCst);
    }

    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        for t in self.threads.drain(..) {
            let _ = t.join();
        }
    }
}

fn block_attr(blocks: u32) -> BufferAttr {
    let bytes = (BLOCK * 2) as u32;
    BufferAttr { maxlength: u32::MAX, tlength: bytes * blocks, prebuf: u32::MAX, minreq: u32::MAX, fragsize: bytes }
}

fn capture_loop(sh: Arc<Shared>, stop: Arc<AtomicBool>, tx: tokio::sync::mpsc::UnboundedSender<Vec<i16>>) {
    let mut proc = MicProcessor::new(*sh.cfg.lock().unwrap(), sh.apm.clone());
    let mut cfg_gen = sh.cfg_gen.load(Ordering::SeqCst);
    let mut bytes = vec![0u8; BLOCK * 2];
    let mut samples = vec![0i16; BLOCK];
    // NEXE_AUDIO_DEBUG=1 prints the level at each stage, to find where a silence starts.
    let debug = std::env::var_os("NEXE_AUDIO_DEBUG").is_some();

    while !stop.load(Ordering::SeqCst) {
        let dev = sh.input.lock().unwrap().clone();
        let in_gen = sh.in_gen.load(Ordering::SeqCst);
        let rec = match Simple::new(None, "Nexe", Direction::Record, dev.as_deref(), "Voice call", &spec(), None, Some(&block_attr(0))) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("audio: microphone unavailable: {e}");
                std::thread::sleep(Duration::from_secs(1));
                continue;
            }
        };
        let mut blocks = 0u32;
        while !stop.load(Ordering::SeqCst) && in_gen == sh.in_gen.load(Ordering::SeqCst) {
            if rec.read(&mut bytes).is_err() {
                std::thread::sleep(Duration::from_millis(200));
                break;
            }
            let g = sh.cfg_gen.load(Ordering::SeqCst);
            if g != cfg_gen {
                cfg_gen = g;
                proc.reconfigure(*sh.cfg.lock().unwrap());
            }
            // Keep reading while muted so the stream stays in step, but send nothing.
            if !sh.mic_on.load(Ordering::SeqCst) {
                continue;
            }
            for (s, b) in samples.iter_mut().zip(bytes.chunks_exact(2)) {
                *s = i16::from_le_bytes([b[0], b[1]]);
            }
            // Tell the echo canceller how long the sound takes from the speaker back to the mic.
            blocks += 1;
            if blocks % 100 == 1 {
                let rec_ms = rec.get_latency().map(|l| (l.0 / 1000) as u32).unwrap_or(10);
                let delay = (rec_ms + sh.play_latency_ms.load(Ordering::Relaxed)) as i32;
                let _ = sh.apm.lock().unwrap().set_stream_delay_ms(delay);
            }
            let raw_peak = samples.iter().map(|s| s.unsigned_abs()).max().unwrap_or(0);
            proc.process(&mut samples);
            if debug && blocks % 100 == 1 {
                let peak = samples.iter().map(|s| s.unsigned_abs()).max().unwrap_or(0);
                eprintln!("audio: capture peak {raw_peak} -> processed {peak}");
            }
            if tx.send(samples.clone()).is_err() {
                return;
            }
        }
    }
}

fn playout_loop(sh: Arc<Shared>, stop: Arc<AtomicBool>) {
    let mut block = vec![0i16; BLOCK];
    let mut bytes = vec![0u8; BLOCK * 2];

    while !stop.load(Ordering::SeqCst) {
        let dev = sh.output.lock().unwrap().clone();
        let out_gen = sh.out_gen.load(Ordering::SeqCst);
        let play = match Simple::new(None, "Nexe", Direction::Playback, dev.as_deref(), "Voice call", &spec(), None, Some(&block_attr(4))) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("audio: speakers unavailable: {e}");
                std::thread::sleep(Duration::from_secs(1));
                continue;
            }
        };
        let mut blocks = 0u32;
        while !stop.load(Ordering::SeqCst) && out_gen == sh.out_gen.load(Ordering::SeqCst) {
            sh.mixer.lock().unwrap().pull(&mut block);
            if sh.deafened.load(Ordering::SeqCst) {
                block.fill(0);
            }
            // What is about to play is the echo canceller's reference.
            let _ = sh.apm.lock().unwrap().process_reverse_stream(&mut block, RATE as i32, 1);
            for (s, b) in block.iter().zip(bytes.chunks_exact_mut(2)) {
                b.copy_from_slice(&s.to_le_bytes());
            }
            if play.write(&bytes).is_err() {
                std::thread::sleep(Duration::from_millis(200));
                break;
            }
            blocks += 1;
            if blocks % 100 == 1 {
                if let Ok(l) = play.get_latency() {
                    sh.play_latency_ms.store((l.0 / 1000) as u32, Ordering::Relaxed);
                }
            }
        }
    }
}
