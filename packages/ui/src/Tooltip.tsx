import { useState, useRef, useEffect, type ReactNode, type ReactElement, cloneElement } from "react";
import { createPortal } from "react-dom";

type TooltipSide = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  content: ReactNode;
  side?: TooltipSide;
  /** Delay before showing (ms) */
  delay?: number;
  children: ReactElement<Record<string, unknown>>;
  className?: string;
}

function Tooltip({ content, side = "top", delay = 200, children, className = "" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  function show() {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }

  function hide() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }

  useEffect(() => {
    if (!visible || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 8;

    // Calculate initial position, then adjust after tooltip renders
    const positions: Record<TooltipSide, { top: number; left: number }> = {
      top: { top: rect.top - gap, left: rect.left + rect.width / 2 },
      bottom: { top: rect.bottom + gap, left: rect.left + rect.width / 2 },
      left: { top: rect.top + rect.height / 2, left: rect.left - gap },
      right: { top: rect.top + rect.height / 2, left: rect.right + gap },
    };

    setPos(positions[side]);
  }, [visible, side]);

  // Adjust after tooltip element renders to account for its size
  useEffect(() => {
    if (!visible || !tooltipRef.current || !triggerRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tipRect = tooltipRef.current.getBoundingClientRect();
    const gap = 8;

    let top = pos.top;
    let left = pos.left;

    if (side === "top") {
      top = triggerRect.top - tipRect.height - gap;
      left = triggerRect.left + triggerRect.width / 2 - tipRect.width / 2;
    } else if (side === "bottom") {
      top = triggerRect.bottom + gap;
      left = triggerRect.left + triggerRect.width / 2 - tipRect.width / 2;
    } else if (side === "left") {
      top = triggerRect.top + triggerRect.height / 2 - tipRect.height / 2;
      left = triggerRect.left - tipRect.width - gap;
    } else if (side === "right") {
      top = triggerRect.top + triggerRect.height / 2 - tipRect.height / 2;
      left = triggerRect.right + gap;
    }

    // Clamp to viewport
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - tipRect.height - 8));

    setPos({ top, left });
  }, [visible, side]);

  const child = cloneElement(children, {
    ref: triggerRef,
    onMouseEnter: (e: MouseEvent) => {
      show();
      const orig = (children.props as Record<string, unknown>).onMouseEnter;
      if (typeof orig === "function") orig(e);
    },
    onMouseLeave: (e: MouseEvent) => {
      hide();
      const orig = (children.props as Record<string, unknown>).onMouseLeave;
      if (typeof orig === "function") orig(e);
    },
    onFocus: (e: FocusEvent) => {
      show();
      const orig = (children.props as Record<string, unknown>).onFocus;
      if (typeof orig === "function") orig(e);
    },
    onBlur: (e: FocusEvent) => {
      hide();
      const orig = (children.props as Record<string, unknown>).onBlur;
      if (typeof orig === "function") orig(e);
    },
  } as Record<string, unknown>);

  return (
    <>
      {child}
      {visible &&
        createPortal(
          <div
            ref={tooltipRef}
            role="tooltip"
            className={`fixed z-tooltip rounded-md bg-dark-950 px-3 py-1.5 text-sm font-medium text-white shadow-tooltip border border-dark-700 animate-fade-in pointer-events-none ${className}`}
            style={{ top: pos.top, left: pos.left }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

export { Tooltip };
export type { TooltipProps, TooltipSide };
