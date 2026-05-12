import { forwardRef, type HTMLAttributes } from "react";

// ── ScrollArea ─────────────────────────────────────────
// Semantic wrapper for scrollable regions.
// Scrollbar styling is handled globally via CSS (::-webkit-scrollbar).

interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  /** Scroll direction. Default: "vertical" */
  direction?: "vertical" | "horizontal" | "both";
  /** Max height CSS value (e.g. "300px", "60vh"). Only for vertical/both. */
  maxHeight?: string;
}

const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ direction = "vertical", maxHeight, className = "", style, children, ...props }, ref) => {
    const overflowClass =
      direction === "vertical"
        ? "overflow-y-auto overflow-x-hidden"
        : direction === "horizontal"
          ? "overflow-x-auto overflow-y-hidden"
          : "overflow-auto";

    return (
      <div
        ref={ref}
        className={`${overflowClass} ${className}`}
        style={{ maxHeight, ...style }}
        {...props}
      >
        {children}
      </div>
    );
  },
);

ScrollArea.displayName = "ScrollArea";

export { ScrollArea };
export type { ScrollAreaProps };
