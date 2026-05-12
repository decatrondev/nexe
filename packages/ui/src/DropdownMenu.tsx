import { useState, useRef, useEffect, cloneElement, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

// ── Types ──────────────────────────────────────────────

interface DropdownMenuItem {
  label: string;
  onClick: () => void;
  color?: string;
  icon?: ReactNode;
  disabled?: boolean;
  separator?: boolean;
}

type DropdownAlign = "left" | "right";
type DropdownSide = "top" | "bottom";

interface DropdownMenuProps {
  trigger: ReactElement<Record<string, unknown>>;
  items: DropdownMenuItem[];
  align?: DropdownAlign;
  side?: DropdownSide;
  className?: string;
}

// ── Component ──────────────────────────────────────────

function DropdownMenu({ trigger, items, align = "left", side = "bottom", className = "" }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  // Position menu relative to trigger
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 4;

    let top = side === "bottom" ? rect.bottom + gap : rect.top - gap;
    let left = align === "left" ? rect.left : rect.right;

    setPos({ top, left });
  }, [open, align, side]);

  // Adjust after menu renders
  useEffect(() => {
    if (!open || !menuRef.current || !triggerRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();
    const gap = 4;

    let top = side === "bottom" ? triggerRect.bottom + gap : triggerRect.top - menuRect.height - gap;
    let left = align === "left" ? triggerRect.left : triggerRect.right - menuRect.width;

    // Clamp to viewport
    if (left + menuRect.width > window.innerWidth - 8) left = window.innerWidth - menuRect.width - 8;
    if (left < 8) left = 8;
    if (top + menuRect.height > window.innerHeight - 8) top = triggerRect.top - menuRect.height - gap;
    if (top < 8) top = triggerRect.bottom + gap;

    setPos({ top, left });
  }, [open, align, side]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current?.contains(e.target as Node) ||
        triggerRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const child = cloneElement(trigger, {
    ref: triggerRef,
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      setOpen(!open);
      const orig = (trigger.props as Record<string, unknown>).onClick;
      if (typeof orig === "function") orig(e);
    },
  } as Record<string, unknown>);

  return (
    <>
      {child}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={`fixed z-[100] min-w-44 rounded-lg border border-dark-700 bg-dark-900 py-1 shadow-xl animate-fade-in ${className}`}
            style={{ top: pos.top, left: pos.left }}
          >
            {items.map((item, i) => (
              <div key={i}>
                {item.separator && <div className="my-1 h-px bg-dark-700" />}
                <button
                  onClick={() => {
                    if (!item.disabled) {
                      item.onClick();
                      setOpen(false);
                    }
                  }}
                  disabled={item.disabled}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
                    item.disabled
                      ? "cursor-not-allowed text-slate-600"
                      : `${item.color ?? "text-slate-300"} hover:bg-dark-800`
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

export { DropdownMenu };
export type { DropdownMenuProps, DropdownMenuItem, DropdownAlign, DropdownSide };
