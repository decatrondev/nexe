import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Height of the bar in px; index.css reserves the same space on Linux. */
export const TITLE_BAR_HEIGHT = 32;

/** The Linux window has no native frame (the system one ignores the dark theme), so we draw our own. */
export function usesCustomTitleBar(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Linux/i.test(navigator.userAgent) &&
    !/Android/i.test(navigator.userAgent) &&
    "__TAURI_INTERNALS__" in window
  );
}

type Edge = "North" | "South" | "East" | "West" | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest";

// Invisible grab areas on the window edges: without the system frame nothing else resizes the window.
const EDGES: { edge: Edge; className: string; cursor: string }[] = [
  { edge: "North", className: "inset-x-2 top-0 h-1", cursor: "ns-resize" },
  { edge: "South", className: "inset-x-2 bottom-0 h-1", cursor: "ns-resize" },
  { edge: "West", className: "inset-y-2 left-0 w-1", cursor: "ew-resize" },
  { edge: "East", className: "inset-y-2 right-0 w-1", cursor: "ew-resize" },
  { edge: "NorthWest", className: "left-0 top-0 h-2 w-2", cursor: "nwse-resize" },
  { edge: "NorthEast", className: "right-0 top-0 h-2 w-2", cursor: "nesw-resize" },
  { edge: "SouthWest", className: "bottom-0 left-0 h-2 w-2", cursor: "nesw-resize" },
  { edge: "SouthEast", className: "bottom-0 right-0 h-2 w-2", cursor: "nwse-resize" },
];

function ResizeHandles() {
  return (
    <>
      {EDGES.map(({ edge, className, cursor }) => (
        <div
          key={edge}
          className={`fixed z-[100001] ${className}`}
          style={{ cursor }}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            void getCurrentWindow().startResizeDragging(edge);
          }}
        />
      ))}
    </>
  );
}

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    const sync = () => { win.isMaximized().then(setMaximized).catch(() => {}); };
    sync();
    win.onResized(sync).then((u) => { unlisten = u; }).catch(() => {});
    return () => unlisten?.();
  }, []);

  const win = getCurrentWindow();

  return (
    <>
    {!maximized && <ResizeHandles />}
    <div
      className="fixed inset-x-0 top-0 z-[100000] flex select-none items-center bg-dark-950 text-slate-400"
      style={{ height: TITLE_BAR_HEIGHT }}
    >
      <div data-tauri-drag-region className="flex h-full flex-1 items-center gap-2 px-3">
        <img src="/favicon.png" alt="" className="pointer-events-none h-4 w-4" draggable={false} />
        <span className="pointer-events-none text-xs font-medium text-slate-300">Nexe</span>
      </div>
      <Button label="Minimize" onClick={() => void win.minimize()}>
        <path d="M5 11h14v2H5z" />
      </Button>
      <Button label={maximized ? "Restore" : "Maximize"} onClick={() => void win.toggleMaximize()}>
        {maximized
          ? <path d="M8 4h12v12h-3v-2h1V6H10v1H8V4zm-4 4h12v12H4V8zm2 2v8h8v-8H6z" />
          : <path d="M5 5h14v14H5V5zm2 2v10h10V7H7z" />}
      </Button>
      <Button label="Close" danger onClick={() => void win.close()}>
        <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5z" />
      </Button>
    </div>
    </>
  );
}

function Button({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-full w-11 items-center justify-center transition-colors ${
        danger ? "hover:bg-red-600 hover:text-white" : "hover:bg-dark-800 hover:text-slate-100"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">{children}</svg>
    </button>
  );
}
