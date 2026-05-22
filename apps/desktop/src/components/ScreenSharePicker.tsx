import { useState } from "react";
import { useVoiceStore } from "../stores/voice";

const RESOLUTIONS = [
  { value: "720", label: "720p", pixels: "1280 x 720", tier: "free" },
  { value: "1080", label: "1080p", pixels: "1920 x 1080", tier: "pro" },
];

const FPS_OPTIONS = [
  { value: 15, label: "15 FPS", tier: "free" },
  { value: 30, label: "30 FPS", tier: "free" },
  { value: 60, label: "60 FPS", tier: "ultra" },
];

const TIER_ORDER = ["free", "pro", "ultra"];

function tierUnlocked(userTier: string, requiredTier: string) {
  return TIER_ORDER.indexOf(userTier) >= TIER_ORDER.indexOf(requiredTier);
}

/**
 * ScreenSharePicker — Discord-style modal for screen share settings.
 * Resolution + FPS + Audio toggle before sharing.
 */
export default function ScreenSharePicker() {
  const pending = useVoiceStore((s) => s.screenSharePending);
  const tierLimits = useVoiceStore((s) => s.tierLimits);
  const startScreenShare = useVoiceStore((s) => s.startScreenShare);
  const cancelScreenShare = useVoiceStore((s) => s.cancelScreenShare);

  const userTier = tierLimits?.tier || "free";

  // Defaults based on tier
  const defaultRes = tierUnlocked(userTier, "pro") ? "1080" : "720";
  const defaultFps = tierUnlocked(userTier, "ultra") ? 60 : 30;

  const [resolution, setResolution] = useState(defaultRes);
  const [fps, setFps] = useState(defaultFps);
  const [audio, setAudio] = useState(true);

  if (!pending) return null;

  const qualityString = `${resolution === "1080" ? "1080p" : "720p"}${fps}`;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={cancelScreenShare}>
      <div
        className="w-[440px] overflow-hidden rounded-2xl border border-dark-700 bg-dark-900 shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-dark-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-nexe-500/10">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current text-nexe-400">
                <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Share Your Screen</h3>
              <p className="text-xs text-slate-500">Pick your stream quality, then select what to share.</p>
            </div>
          </div>
        </div>

        {/* Settings */}
        <div className="space-y-5 px-6 py-5">
          {/* Resolution */}
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Resolution</label>
            <div className="flex gap-2">
              {RESOLUTIONS.map((res) => {
                const locked = !tierUnlocked(userTier, res.tier);
                const active = resolution === res.value && !locked;
                return (
                  <button
                    key={res.value}
                    onClick={() => { if (!locked) setResolution(res.value); }}
                    disabled={locked}
                    className={`relative flex flex-1 flex-col items-center gap-1 rounded-xl border py-3 transition-all ${
                      locked ? "cursor-not-allowed border-dark-700 opacity-35" :
                      active ? "border-nexe-500 bg-nexe-500/5 shadow-sm shadow-nexe-500/10" : "border-dark-600 hover:border-dark-500"
                    }`}
                  >
                    <span className="text-sm font-bold text-white">{res.label}</span>
                    <span className="text-[10px] text-slate-500">{res.pixels}</span>
                    {locked && (
                      <div className="absolute right-2 top-2 flex items-center gap-1">
                        <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current text-slate-600">
                          <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                        </svg>
                        <TierBadge tier={res.tier} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Frame Rate */}
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Frame Rate</label>
            <div className="flex gap-2">
              {FPS_OPTIONS.map((opt) => {
                const locked = !tierUnlocked(userTier, opt.tier);
                const active = fps === opt.value && !locked;
                return (
                  <button
                    key={opt.value}
                    onClick={() => { if (!locked) setFps(opt.value); }}
                    disabled={locked}
                    className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 transition-all ${
                      locked ? "cursor-not-allowed border-dark-700 opacity-35" :
                      active ? "border-nexe-500 bg-nexe-500/5" : "border-dark-600 hover:border-dark-500"
                    }`}
                  >
                    <span className="text-sm font-medium text-white">{opt.label}</span>
                    {locked && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current text-slate-600">
                          <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                        </svg>
                        <TierBadge tier={opt.tier} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Audio toggle */}
          <div className="flex items-center justify-between rounded-xl border border-dark-700 bg-dark-800/50 px-4 py-3">
            <div className="flex items-center gap-3">
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current text-slate-400">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-slate-200">Share Audio</p>
                <p className="text-[11px] text-slate-500">Include system/app audio in your stream.</p>
              </div>
            </div>
            <button
              onClick={() => setAudio(!audio)}
              className={`relative h-6 w-11 rounded-full transition-colors ${audio ? "bg-nexe-500" : "bg-dark-600"}`}
            >
              <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${audio ? "translate-x-[22px]" : "translate-x-0.5"}`} />
            </button>
          </div>

          {/* Summary */}
          <div className="flex items-center justify-between rounded-xl bg-dark-800/30 px-4 py-2.5">
            <span className="text-xs text-slate-500">Stream settings</span>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-dark-700 px-2 py-0.5 text-xs font-medium text-white">
                {resolution}p {fps}fps
              </span>
              {audio && (
                <span className="rounded-md bg-dark-700 px-2 py-0.5 text-xs font-medium text-slate-400">
                  + Audio
                </span>
              )}
              <TierBadge tier={userTier} />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 border-t border-dark-800 bg-dark-950/50 px-6 py-4">
          <button
            onClick={cancelScreenShare}
            className="flex-1 rounded-lg bg-dark-800 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-dark-700"
          >
            Cancel
          </button>
          <button
            onClick={() => startScreenShare(qualityString, audio)}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-nexe-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-nexe-600"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" />
            </svg>
            Go Live
          </button>
        </div>
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide ${
      tier === "ultra" ? "bg-amber-500/15 text-amber-400" :
      tier === "pro" ? "bg-purple-500/15 text-purple-400" : "bg-slate-500/15 text-slate-400"
    }`}>{tier}</span>
  );
}
