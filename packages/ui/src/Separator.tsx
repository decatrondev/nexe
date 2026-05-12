// ── Separator ──────────────────────────────────────────
// Simple horizontal or vertical divider.

interface SeparatorProps {
  /** Default: "horizontal" */
  orientation?: "horizontal" | "vertical";
  className?: string;
}

function Separator({ orientation = "horizontal", className = "" }: SeparatorProps) {
  return orientation === "horizontal" ? (
    <div className={`h-px w-full bg-dark-700 ${className}`} role="separator" />
  ) : (
    <div className={`w-px self-stretch bg-dark-700 ${className}`} role="separator" />
  );
}

export { Separator };
export type { SeparatorProps };
