import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// ── Types ──────────────────────────────────────────────

interface ContextMenuItem {
  label: string;
  onClick: () => void;
  /** Color class for the label. Default: text-slate-300 */
  color?: string;
  /** Hover background class. Default: hover:bg-dark-800 */
  hoverBg?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Show a separator line before this item */
  separator?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

// ── Component ──────────────────────────────────────────

function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Adjust position to stay in viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let left = x;
    let top = y;

    if (left + rect.width > window.innerWidth - 8) {
      left = window.innerWidth - rect.width - 8;
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = window.innerHeight - rect.height - 8;
    }
    if (left < 8) left = 8;
    if (top < 8) top = 8;

    setPos({ left, top });
  }, [x, y]);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Use setTimeout to avoid the triggering right-click from closing immediately
    const t = setTimeout(() => document.addEventListener("mousedown", handleClick), 10);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handleClick); };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Close on scroll
  useEffect(() => {
    function handleScroll() { onClose(); }
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-tooltip min-w-44 rounded-lg border border-dark-700 bg-dark-900 py-1 shadow-dropdown animate-scale-in"
      style={{ left: pos.left, top: pos.top, transformOrigin: "top left" }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.separator && <div className="my-1 h-px bg-dark-700" />}
          <button
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            disabled={item.disabled}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
              item.disabled
                ? "cursor-not-allowed text-slate-600"
                : `${item.color ?? "text-slate-300"} ${item.hoverBg ?? "hover:bg-dark-800"}`
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export { ContextMenu };
export type { ContextMenuProps, ContextMenuItem };
