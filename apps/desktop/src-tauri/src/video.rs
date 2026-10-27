//! Video for the Linux call engine: remote cameras and screens arrive here from LiveKit and are
//! handed to the UI as JPEG pictures over a binary channel; the UI paints them on a canvas. (The
//! Linux webview has no WebRTC, so it cannot receive video itself.) Frames are only encoded while
//! the UI is watching that track, and when the encoder is behind it drops the stale frames instead
//! of falling further behind, so what you see stays current.

#[cfg(target_os = "linux")]
pub mod imp {
    use futures_util::StreamExt;
    use livekit::webrtc::video_frame::{BoxVideoFrame, VideoBuffer};
    use livekit::webrtc::video_stream::native::NativeVideoStream;
    use livekit::webrtc::video_track::RtcVideoTrack;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    /// Pictures are never larger than this; bigger sources are scaled down before encoding.
    const MAX_WIDTH: u32 = 1920;
    const MAX_HEIGHT: u32 = 1080;
    /// The UI shows at most this many pictures a second, however fast the source is.
    const MAX_FPS: u64 = 30;
    const JPEG_QUALITY: u8 = 80;

    // libjpeg-turbo ships in the GNOME runtime. It compresses the planar video frame as it is, with
    // SIMD, several times faster than converting to RGB first and encoding that.
    #[link(name = "turbojpeg")]
    extern "C" {
        fn tjInitCompress() -> *mut std::ffi::c_void;
        fn tjDestroy(handle: *mut std::ffi::c_void) -> i32;
        fn tjFree(buffer: *mut u8);
        #[allow(clippy::too_many_arguments)]
        fn tjCompressFromYUVPlanes(
            handle: *mut std::ffi::c_void,
            src_planes: *const *const u8,
            width: i32,
            strides: *const i32,
            height: i32,
            subsamp: i32,
            jpeg_buf: *mut *mut u8,
            jpeg_size: *mut std::os::raw::c_ulong,
            jpeg_qual: i32,
            flags: i32,
        ) -> i32;
    }
    const TJSAMP_420: i32 = 2;
    const TJFLAG_FASTDCT: i32 = 2048;

    /// Where finished pictures go: a channel to the UI in the app, a counter in the self-test.
    pub type FrameSink = Arc<dyn Fn(Vec<u8>) + Send + Sync>;

    /// Who is watching which track. Keys are `identity|source` (source: camera or screen).
    #[derive(Default)]
    pub struct VideoHub {
        sinks: Mutex<HashMap<String, FrameSink>>,
    }

    impl VideoHub {
        pub fn attach(&self, key: String, sink: FrameSink) {
            self.sinks.lock().unwrap().insert(key, sink);
        }
        pub fn detach(&self, key: &str) {
            self.sinks.lock().unwrap().remove(key);
        }
        fn get(&self, key: &str) -> Option<FrameSink> {
            let sinks = self.sinks.lock().unwrap();
            // "*" watches every track (self-test).
            sinks.get(key).or_else(|| sinks.get("*")).cloned()
        }
        pub fn clear(&self) {
            self.sinks.lock().unwrap().clear();
        }
    }

    /// Turns one video frame into a JPEG, scaled down if it is bigger than the UI needs.
    pub fn encode(frame: &BoxVideoFrame) -> Option<Vec<u8>> {
        let mut i420 = frame.buffer.to_i420();
        let (w, h) = (i420.width(), i420.height());
        if w == 0 || h == 0 {
            return None;
        }
        if w > MAX_WIDTH || h > MAX_HEIGHT {
            let k = (MAX_WIDTH as f64 / w as f64).min(MAX_HEIGHT as f64 / h as f64);
            // Even sizes keep the chroma planes aligned.
            let (nw, nh) = (((w as f64 * k) as i32) & !1, ((h as f64 * k) as i32) & !1);
            i420 = i420.scale(nw.max(2), nh.max(2));
        }
        let (w, h) = (i420.width(), i420.height());
        let (y, u, v) = i420.data();
        let (sy, su, sv) = i420.strides();
        let planes = [y.as_ptr(), u.as_ptr(), v.as_ptr()];
        let strides = [sy as i32, su as i32, sv as i32];
        let mut out: *mut u8 = std::ptr::null_mut();
        let mut size: std::os::raw::c_ulong = 0;
        // SAFETY: the planes and strides come from one I420 buffer that outlives the call, and libjpeg-turbo
        // allocates the output (released with tjFree below).
        let bytes = unsafe {
            let handle = tjInitCompress();
            if handle.is_null() {
                return None;
            }
            let rc = tjCompressFromYUVPlanes(
                handle,
                planes.as_ptr(),
                w as i32,
                strides.as_ptr(),
                h as i32,
                TJSAMP_420,
                &mut out,
                &mut size,
                JPEG_QUALITY as i32,
                TJFLAG_FASTDCT,
            );
            let bytes = (rc == 0 && !out.is_null()).then(|| std::slice::from_raw_parts(out, size as usize).to_vec());
            if !out.is_null() {
                tjFree(out);
            }
            tjDestroy(handle);
            bytes
        };
        bytes
    }

    /// Reads one remote video track until it goes away, sending pictures to whoever is watching.
    pub async fn read_track(hub: Arc<VideoHub>, key: String, track: RtcVideoTrack) {
        let mut stream = NativeVideoStream::new(track);
        // A little under the frame time, so the jitter of a steady 30 fps source never costs a frame.
        let min_gap = Duration::from_millis(1000 / MAX_FPS - 6);
        let mut last = Instant::now() - min_gap;
        // NEXE_VIDEO_DEBUG=1 prints, once a second, frames in / pictures out / average encode time.
        let debug = std::env::var_os("NEXE_VIDEO_DEBUG").is_some();
        let (mut seen, mut sent, mut enc_ms, mut since) = (0u32, 0u32, 0f64, Instant::now());
        while let Some(frame) = stream.next().await {
            seen += 1;
            if debug && since.elapsed() >= Duration::from_secs(1) {
                eprintln!("video {key}: in {seen}/s, out {sent}/s, encode {:.1} ms", enc_ms / sent.max(1) as f64);
                (seen, sent, enc_ms, since) = (0, 0, 0.0, Instant::now());
            }
            let Some(sink) = hub.get(&key) else { continue };
            if last.elapsed() < min_gap {
                continue;
            }
            last = Instant::now();
            let started = Instant::now();
            let jpeg = tauri::async_runtime::spawn_blocking(move || encode(&frame)).await;
            if let Ok(Some(bytes)) = jpeg {
                enc_ms += started.elapsed().as_secs_f64() * 1000.0;
                sent += 1;
                sink(bytes);
            }
        }
    }
}
