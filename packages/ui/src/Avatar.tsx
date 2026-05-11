type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
type StatusType = "online" | "idle" | "dnd" | "offline" | "invisible";

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  color?: string;
  status?: StatusType;
  /** Show status indicator */
  showStatus?: boolean;
  className?: string;
}

const sizeMap: Record<AvatarSize, { container: string; text: string; status: string; statusBorder: string }> = {
  xs: { container: "h-5 w-5", text: "text-[9px]", status: "h-2 w-2", statusBorder: "border" },
  sm: { container: "h-8 w-8", text: "text-xs", status: "h-3 w-3", statusBorder: "border-2" },
  md: { container: "h-10 w-10", text: "text-sm", status: "h-3.5 w-3.5", statusBorder: "border-2" },
  lg: { container: "h-16 w-16", text: "text-xl", status: "h-4 w-4", statusBorder: "border-[3px]" },
  xl: { container: "h-20 w-20", text: "text-2xl", status: "h-5 w-5", statusBorder: "border-[3px]" },
};

const statusColors: Record<StatusType, string> = {
  online: "bg-green-500",
  idle: "bg-yellow-500",
  dnd: "bg-red-500",
  offline: "bg-slate-500",
  invisible: "bg-slate-500",
};

function Avatar({
  name,
  src,
  size = "md",
  color,
  status,
  showStatus = false,
  className = "",
}: AvatarProps) {
  const s = sizeMap[size];
  const initial = (name || "?").charAt(0).toUpperCase();

  return (
    <div className={`relative inline-flex shrink-0 ${className}`}>
      {src ? (
        <img
          src={src}
          alt={name}
          className={`${s.container} rounded-full object-cover`}
        />
      ) : (
        <div
          className={`${s.container} flex items-center justify-center rounded-full ${s.text} font-semibold text-white`}
          style={{
            backgroundColor: color ? color + "33" : undefined,
            color: color || undefined,
          }}
        >
          {!color && (
            <span className={`flex ${s.container} items-center justify-center rounded-full bg-nexe-700 text-white`}>
              {initial}
            </span>
          )}
          {color && <span>{initial}</span>}
        </div>
      )}
      {showStatus && status && (
        <div
          className={`absolute -bottom-0.5 -right-0.5 ${s.status} rounded-full ${s.statusBorder} border-dark-850 transition-colors duration-300 ${statusColors[status]}`}
        />
      )}
    </div>
  );
}

export { Avatar, statusColors, type AvatarProps, type AvatarSize, type StatusType };
