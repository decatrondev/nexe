import { useState, useEffect, useRef } from "react";
import { useAuthStore } from "../stores/auth";
import { useGuildStore } from "../stores/guild";
import { useVoiceStore } from "../stores/voice";
import { api } from "../lib/api";
import { statusColors } from "../lib/utils";
import UserSettingsModal from "./UserSettingsModal";

const STATUS_OPTIONS = [
  { value: "online", label: "Online", color: "bg-green-500", hasDuration: false },
  { value: "idle", label: "Idle", color: "bg-yellow-500", hasDuration: false },
  { value: "dnd", label: "Do Not Disturb", color: "bg-red-500", hasDuration: true },
  { value: "invisible", label: "Invisible", color: "bg-slate-500", hasDuration: true },
] as const;

const DURATION_OPTIONS = [
  { label: "Don't clear", value: 0 },
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "4 hours", value: 240 },
  { label: "8 hours", value: 480 },
  { label: "24 hours", value: 1440 },
] as const;

export default function UserBar() {
  const user = useAuthStore((s) => s.user);
  const presenceMap = useGuildStore((s) => s.presenceMap);
  const userStatus = (user?.id ? presenceMap[user.id] : null) || user?.status || "online";

  const connected = useVoiceStore((s) => s.connected);
  const selfMute = useVoiceStore((s) => s.selfMute);
  const selfDeaf = useVoiceStore((s) => s.selfDeaf);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);

  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);

  if (!user) return null;

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 border-t border-white/[0.04] bg-dark-950/80 px-2 py-2">
        {/* Avatar + status dot */}
        <div className="relative" ref={statusMenuRef}>
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-nexe-600 text-xs font-bold text-white">
              {(user.username || "U").charAt(0).toUpperCase()}
            </div>
          )}
          <button
            onClick={() => setShowStatusMenu((v) => !v)}
            className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-dark-950 transition-transform hover:scale-125 ${statusColors[userStatus] || statusColors.online}`}
            title="Change status"
          />
          {showStatusMenu && (
            <StatusMenu
              current={userStatus}
              onSelect={async (status, clearAfter) => {
                setShowStatusMenu(false);
                try {
                  await api.updatePresence(status, clearAfter);
                  useAuthStore.setState((s) => ({
                    user: s.user ? { ...s.user, status: status as "online" | "idle" | "dnd" | "offline" | "invisible" } : null,
                  }));
                  if (user.id) {
                    useGuildStore.setState((s) => ({
                      presenceMap: { ...s.presenceMap, [user.id]: status },
                    }));
                  }
                } catch { /* ignore */ }
              }}
              onClose={() => setShowStatusMenu(false)}
              anchorRef={statusMenuRef}
            />
          )}
        </div>

        {/* Name + status */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-slate-200">
            {user.displayName || user.username}
          </p>
          <p className="truncate text-[11px] text-slate-500">
            {userStatus === "dnd" ? "Do Not Disturb" : userStatus === "invisible" ? "Invisible" : userStatus.charAt(0).toUpperCase() + userStatus.slice(1)}
          </p>
        </div>

        {/* Voice controls (only when in voice) */}
        {connected && (
          <>
            <button
              onClick={() => toggleMute()}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                selfMute ? "bg-red-500/20 text-red-400" : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
              }`}
              title={selfMute ? "Unmute" : "Mute"}
            >
              {selfMute ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M19 11c0 1.19-.34 2.3-.9 3.28l-1.23-1.23c.27-.62.44-1.32.44-2.05h1.69zM14.98 11.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27 9.01 10.28V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5.01c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.55-.9l4.17 4.18L21 19.73 4.27 3z" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c0 3-2.54 5.1-5.91 5.1S6.09 14 6.09 11H4.5c0 3.41 2.72 6.23 6 6.72V21h3v-3.28c3.28-.48 6-3.3 6-6.72h-1.59z" /></svg>
              )}
            </button>
            <button
              onClick={() => toggleDeafen()}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                selfDeaf ? "bg-red-500/20 text-red-400" : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
              }`}
              title={selfDeaf ? "Undeafen" : "Deafen"}
            >
              {selfDeaf ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M4.34 2.93L2.93 4.34 7.29 8.7 7 9H3v6h4l5 5v-6.59l4.18 4.18c-.65.49-1.38.88-2.18 1.11v2.06c1.34-.3 2.57-.97 3.6-1.88l2.05 2.05 1.41-1.41L4.34 2.93zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zm-7-8l-1.88 1.88L12 7.76zm4.5 8A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63z" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-3.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
              )}
            </button>
          </>
        )}

        {/* Settings gear */}
        <button
          onClick={() => setShowSettings(true)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
          title="User Settings"
        >
          <svg viewBox="0 0 24 24" className="h-[15px] w-[15px] fill-current">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
          </svg>
        </button>
      </div>

      {showSettings && <UserSettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}

// ── Status Menu ──

function StatusMenu({
  current,
  onSelect,
  onClose,
  anchorRef,
}: {
  current: string;
  onSelect: (status: string, clearAfter?: number) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [durationFor, setDurationFor] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 10);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [onClose, anchorRef]);

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 mb-2 w-56 overflow-hidden rounded-xl border border-white/[0.06] bg-dark-800 py-1.5 shadow-2xl shadow-black/40 animate-slide-up"
      style={{ zIndex: 100 }}
    >
      {durationFor ? (
        <>
          <button
            onClick={() => setDurationFor(null)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 hover:text-slate-300"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg>
            Clear after
          </button>
          {DURATION_OPTIONS.map((dur) => (
            <button
              key={dur.value}
              onClick={() => onSelect(durationFor, dur.value || undefined)}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-[13px] text-slate-300 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current text-slate-500"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" /></svg>
              {dur.label}
            </button>
          ))}
        </>
      ) : (
        <>
          <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600">Set Status</p>
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => opt.hasDuration ? setDurationFor(opt.value) : onSelect(opt.value)}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition-colors hover:bg-white/[0.05] ${current === opt.value ? "text-white" : "text-slate-300"}`}
            >
              <div className={`h-2.5 w-2.5 rounded-full ${opt.color}`} />
              <span className="flex-1 text-left">{opt.label}</span>
              {current === opt.value && (
                <svg className="h-3.5 w-3.5 text-nexe-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              )}
              {opt.hasDuration && current !== opt.value && (
                <svg viewBox="0 0 24 24" className="h-3 w-3 text-slate-600 fill-current"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" /></svg>
              )}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
