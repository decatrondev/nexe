import { useState, useRef, useEffect, cloneElement, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

// ── Types ──────────────────────────────────────────────

type PopoverSide = "top" | "bottom" | "left" | "right";
type PopoverAlign = "start" | "center" | "end";

interface PopoverProps {
  trigger: ReactElement<Record<string, unknown>>;
  content: ReactNode;
  side?: PopoverSide;
  align?: PopoverAlign;
  /** Close when clicking outside. Default: true */
  closeOnOutsideClick?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

// ── Component ──────────────────────────────────────────

function Popover({
  trigger,
  content,
  side = "bottom",
  align = "center",
  closeOnOutsideClick = true,
  open: controlledOpen,
  onOpenChange,
  className = "",
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const triggerRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  // Position the popover
  useEffect(() => {
    if (!isOpen || !triggerRef.current || !popoverRef.current) return;

    const tRect = triggerRef.current.getBoundingClientRect();
    const pRect = popoverRef.current.getBoundingClientRect();
    const gap = 8;

    let top = 0;
    let left = 0;

    // Side positioning
    switch (side) {
      case "top":
        top = tRect.top - pRect.height - gap;
        break;
      case "bottom":
        top = tRect.bottom + gap;
        break;
      case "left":
        left = tRect.left - pRect.width - gap;
        top = tRect.top;
        break;
      case "right":
        left = tRect.right + gap;
        top = tRect.top;
        break;
    }

    // Alignment
    if (side === "top" || side === "bottom") {
      switch (align) {
        case "start":
          left = tRect.left;
          break;
        case "center":
          left = tRect.left + tRect.width / 2 - pRect.width / 2;
          break;
        case "end":
          left = tRect.right - pRect.width;
          break;
      }
    } else {
      switch (align) {
        case "start":
          top = tRect.top;
          break;
        case "center":
          top = tRect.top + tRect.height / 2 - pRect.height / 2;
          break;
        case "end":
          top = tRect.bottom - pRect.height;
          break;
      }
    }

    // Clamp to viewport
    left = Math.max(8, Math.min(left, window.innerWidth - pRect.width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - pRect.height - 8));

    setPos({ top, left });
  }, [isOpen, side, align]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen || !closeOnOutsideClick) return;
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current?.contains(e.target as Node) ||
        triggerRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    const t = setTimeout(() => document.addEventListener("mousedown", handleClick), 10);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handleClick); };
  }, [isOpen, closeOnOutsideClick, setOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, setOpen]);

  const child = cloneElement(trigger, {
    ref: triggerRef,
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      setOpen(!isOpen);
      const orig = (trigger.props as Record<string, unknown>).onClick;
      if (typeof orig === "function") orig(e);
    },
  } as Record<string, unknown>);

  return (
    <>
      {child}
      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            className={`fixed z-[100] rounded-lg border border-dark-700 bg-dark-900 shadow-xl animate-fade-in ${className}`}
            style={{ top: pos.top, left: pos.left }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

export { Popover };
export type { PopoverProps, PopoverSide, PopoverAlign };
