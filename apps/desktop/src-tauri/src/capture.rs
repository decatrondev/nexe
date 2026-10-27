//! Screen sharing for the Linux call engine. The screen is captured with libwebrtc's own capturer
//! (X11, or Wayland through the desktop portal and PipeWire, which asks the user what to share),
//! converted to video frames and fed to a LiveKit video track. While the UI shows the local preview
//! the same frames also go to it as pictures (see video.rs).

#[cfg(target_os = "linux")]
pub mod imp {
    use crate::video::imp::{encode, VideoHub};
    use livekit::webrtc::desktop_capturer::{CaptureError, DesktopCaptureSourceType, DesktopCapturer, DesktopCapturerOptions, DesktopFrame};
    use livekit::webrtc::native::yuv_helper::argb_to_nv12;
    use livekit::webrtc::video_frame::{BoxVideoBuffer, BoxVideoFrame, NV12Buffer, VideoFrame, VideoRotation};
    use livekit::webrtc::video_source::native::NativeVideoSource;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    #[derive(Clone, Copy)]
    pub struct CaptureSettings {
        pub max_width: u32,
        pub max_height: u32,
        pub fps: u32,
    }

    pub struct ScreenCapture {
        stop: Arc<AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl ScreenCapture {
        /// Starts capturing on its own thread; `on_error` is told if the capture cannot start or dies.
        pub fn start(
            source: NativeVideoSource,
            settings: CaptureSettings,
            hub: Arc<VideoHub>,
            on_error: Arc<dyn Fn(String) + Send + Sync>,
        ) -> ScreenCapture {
            let stop = Arc::new(AtomicBool::new(false));
            let flag = stop.clone();
            let thread = std::thread::Builder::new()
                .name("screen-capture".into())
                .spawn(move || run(source, settings, hub, flag, on_error))
                .ok();
            ScreenCapture { stop, thread }
        }

        pub fn stop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
        }
    }

    impl Drop for ScreenCapture {
        fn drop(&mut self) {
            self.stop();
        }
    }

    /// Converts a captured screen picture to a video frame no bigger than the settings allow.
    fn make_frame(f: &DesktopFrame, s: &CaptureSettings) -> Option<BoxVideoFrame> {
        // Even sizes keep the chroma planes aligned.
        let (fw, fh) = ((f.width().max(0) as u32) & !1, (f.height().max(0) as u32) & !1);
        if fw < 2 || fh < 2 {
            return None;
        }
        let mut nv12 = NV12Buffer::new(fw, fh);
        let (sy, suv) = nv12.strides();
        let (y, uv) = nv12.data_mut();
        argb_to_nv12(f.data(), f.stride(), y, sy, uv, suv, fw as i32, fh as i32);

        // Never scale up; scale down to fit the chosen quality.
        let k = (s.max_width as f64 / fw as f64).min(s.max_height as f64 / fh as f64).min(1.0);
        let (ow, oh) = ((((fw as f64 * k) as u32) & !1).max(2), (((fh as f64 * k) as u32) & !1).max(2));
        let buffer: BoxVideoBuffer = if (ow, oh) == (fw, fh) {
            Box::new(nv12)
        } else {
            let boxed: BoxVideoBuffer = Box::new(nv12);
            let mut i420 = boxed.to_i420();
            Box::new(i420.scale(ow as i32, oh as i32))
        };
        Some(VideoFrame::new(VideoRotation::VideoRotation0, buffer))
    }

    fn run(
        source: NativeVideoSource,
        settings: CaptureSettings,
        hub: Arc<VideoHub>,
        stop: Arc<AtomicBool>,
        on_error: Arc<dyn Fn(String) + Send + Sync>,
    ) {
        let mut options = DesktopCapturerOptions::new(DesktopCaptureSourceType::Screen);
        options.set_include_cursor(true);
        let Some(mut capturer) = DesktopCapturer::new(options) else {
            on_error("Screen capture is not available in this session".into());
            return;
        };
        // On X11 the first screen; on Wayland the portal shows its own picker and the list is empty.
        let first = capturer.get_source_list().into_iter().next();

        let failed = Arc::new(AtomicBool::new(false));
        let (failed_cb, err_cb, hub_cb) = (failed.clone(), on_error.clone(), hub.clone());
        let mut count: u64 = 0;
        let mut ts: i64 = 0;
        capturer.start_capture(first, move |result| match result {
            Ok(frame) => {
                let Some(mut video) = make_frame(&frame, &settings) else { return };
                count += 1;
                ts += 1_000_000 / settings.fps.max(1) as i64;
                video.timestamp_us = ts;
                source.capture_frame(&video);
                // The local preview needs fewer pictures than the call does.
                if count % 2 == 0 {
                    if let Some(sink) = hub_cb.get("local|screen") {
                        if let Some(jpeg) = encode(&video) {
                            sink(jpeg);
                        }
                    }
                }
            }
            Err(CaptureError::Temporary) => {}
            Err(CaptureError::Permanent) => {
                if !failed_cb.swap(true, Ordering::SeqCst) {
                    err_cb("Screen capture stopped (permission denied or the screen went away)".into());
                }
            }
        });

        let gap = Duration::from_micros(1_000_000 / settings.fps.max(1) as u64);
        let mut next = Instant::now();
        while !stop.load(Ordering::SeqCst) && !failed.load(Ordering::SeqCst) {
            capturer.capture_frame();
            next += gap;
            let now = Instant::now();
            if next > now {
                std::thread::sleep(next - now);
            } else {
                // Behind: do not try to catch up with a burst.
                next = now;
            }
        }
    }
}
