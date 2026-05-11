import type { Role } from "./api";

// ── Status ──

export const statusColors: Record<string, string> = {
  online: "bg-green-500",
  idle: "bg-yellow-500",
  dnd: "bg-red-500",
  offline: "bg-slate-500",
  invisible: "bg-slate-500",
};

export const statusLabels: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  invisible: "Invisible",
  offline: "Offline",
};

// ── Colors ──

const USER_COLORS = [
  "#a78bfa", "#34d399", "#f472b6", "#60a5fa", "#fbbf24",
  "#fb923c", "#c084fc", "#2dd4bf", "#f87171", "#a3e635",
];

/** Deterministic color based on userId hash */
export function userColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

/** Returns the color of the user's highest-position role, or undefined if none */
export function getRoleColor(
  userId: string,
  memberRoles: Record<string, string[]>,
  roles: Role[],
): string | undefined {
  const userRoleIds = memberRoles[userId];
  if (!userRoleIds || userRoleIds.length === 0) return undefined;

  const colored = roles
    .filter((r) => userRoleIds.includes(r.id) && r.color)
    .sort((a, b) => b.position - a.position);

  return colored.length > 0 ? colored[0].color : undefined;
}

// ── Timestamps ──

export function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;

    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return `Today at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }

    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    }) + ` at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  } catch {
    return "";
  }
}

export function formatJoinDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Clipboard ──

function fallbackCopy(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

export function copyToClipboard(text: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
