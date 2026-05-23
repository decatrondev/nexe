import { useEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuSection {
  items: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  sections: ContextMenuSection[];
  onClose: () => void;
  /** Optional header text */
  header?: string;
  /** Optional custom content before items (e.g. volume slider) */
  extra?: React.ReactNode;
}

/**
 * ContextMenu — Discord-style right-click context menu.
 * Positioned at mouse coordinates, auto-adjusts to stay on screen.
 * Closes on click outside, Escape, or scroll.
 */
export default function ContextMenu({ x, y, sections, onClose, header, extra }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside, right-click elsewhere, Escape, scroll
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Delay to avoid the opening right-click from closing it
    const t = setTimeout(() => {
      window.addEventListener("click", close);
      window.addEventListener("contextmenu", close);
      window.addEventListener("scroll", close, true);
    }, 10);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Auto-adjust position to stay on screen
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const pad = 8;
    if (rect.right > window.innerWidth - pad) {
      ref.current.style.left = `${window.innerWidth - rect.width - pad}px`;
    }
    if (rect.bottom > window.innerHeight - pad) {
      ref.current.style.top = `${window.innerHeight - rect.height - pad}px`;
    }
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[180px] max-w-[240px] overflow-hidden rounded-lg border border-dark-700 bg-dark-900 py-1 shadow-2xl animate-fade-in"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {header && (
        <p className="truncate px-2.5 pb-1 pt-0.5 text-[11px] font-semibold text-white">{header}</p>
      )}

      {extra && <div className="px-1">{extra}</div>}
      {(header || extra) && sections.length > 0 && <div className="my-1 border-t border-dark-700" />}

      {sections.map((section, si) => (
        <div key={si}>
          {si > 0 && <div className="my-1 border-t border-dark-700" />}
          {section.items.map((item, ii) => (
            <button
              key={ii}
              onClick={() => { item.onClick(); onClose(); }}
              disabled={item.disabled}
              className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                item.disabled ? "cursor-not-allowed opacity-40" :
                item.danger ? "text-red-400 hover:bg-red-500/10" : "text-slate-300 hover:bg-nexe-500/10 hover:text-white"
              }`}
            >
              {item.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center text-slate-500">{item.icon}</span>}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Common SVG icons for menu items ──
export const MenuIcons = {
  profile: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>,
  mute: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>,
  volume: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>,
  reply: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" /></svg>,
  edit: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>,
  delete: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>,
  copy: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg>,
  pin: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M14 4v5c0 1.12.37 2.16 1 3H9c.65-.86 1-1.9 1-3V4h4zm3-2H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3V4h1c.55 0 1-.45 1-1s-.45-1-1-1z" /></svg>,
  leave: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" /></svg>,
  settings: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" /></svg>,
  kick: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>,
  ban: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.902 7.902 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.902 7.902 0 0 1 20 12c0 4.42-3.58 8-8 8z" /></svg>,
  timeout: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" /></svg>,
  close: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>,
  link: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" /></svg>,
  message: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" /></svg>,
  addFriend: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>,
  notification: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" /></svg>,
  id: <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z" /></svg>,
};

// ── Volume slider for context menus ──
export function VolumeSlider({ userId }: { userId: string }) {
  const [volume, setVolume] = useState(100);

  function handleVolume(val: number) {
    setVolume(val);
    document.querySelectorAll<HTMLAudioElement>(`.voice-audio-user-${userId}`).forEach((el) => {
      el.volume = Math.min(val / 100, 1);
    });
  }

  return (
    <div className="px-2.5 py-1.5">
      <p className="mb-1.5 text-[10px] font-medium uppercase text-slate-500">User Volume</p>
      <div className="flex items-center gap-2">
        {MenuIcons.volume}
        <input
          type="range" min={0} max={200} value={volume}
          onChange={(e) => handleVolume(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-dark-600 accent-nexe-500 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-nexe-400"
          onClick={(e) => e.stopPropagation()}
        />
        <span className="w-8 text-right text-[9px] font-medium text-slate-400">{volume}%</span>
      </div>
    </div>
  );
}
