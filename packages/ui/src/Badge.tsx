import { type ReactNode } from "react";

type BadgeVariant = "default" | "danger" | "success" | "warning" | "info" | "live";

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  /** Pill-style with number count */
  count?: number;
  /** Animate entrance */
  animated?: boolean;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-dark-700 text-slate-300",
  danger: "bg-red-500 text-white",
  success: "bg-green-600 text-white",
  warning: "bg-yellow-500 text-dark-900",
  info: "bg-nexe-500 text-white",
  live: "bg-red-600 text-white animate-pulse-subtle",
};

function Badge({
  variant = "default",
  children,
  count,
  animated = false,
  className = "",
}: BadgeProps) {
  if (count !== undefined) {
    if (count <= 0) return null;
    return (
      <span
        className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold ${variantStyles.danger} ${animated ? "animate-scale-in" : ""} ${className}`}
      >
        {count > 99 ? "99+" : count}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-bold uppercase ${variantStyles[variant]} ${animated ? "animate-scale-in" : ""} ${className}`}
    >
      {children}
    </span>
  );
}

export { Badge, type BadgeProps, type BadgeVariant };
