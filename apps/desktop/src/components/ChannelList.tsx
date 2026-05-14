import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useGuildStore } from "../stores/guild";
import { useAuthStore } from "../stores/auth";
import { useVoiceStore } from "../stores/voice";
import { hasPermission, computePermissions, Permissions } from "../lib/permissions";
import { type Channel, type Category, api } from "../lib/api";
import { FREE_TIER_LIMITS } from "../lib/limits";
import { statusColors } from "../lib/utils";
import { DndContext, closestCenter, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import CreateChannelModal from "./CreateChannelModal";
import ServerSettingsModal from "./ServerSettingsModal";
import InviteModal from "./InviteModal";
import UserSettingsModal from "./UserSettingsModal";
import VoicePanel from "./VoicePanel";
import NotificationBell from "./NotificationBell";

const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_CATEGORIES: Category[] = [];

// ── Channel type icon helpers ──

function ChannelIcon({ type, isActive, hasUnread }: { type: string; isActive: boolean; hasUnread: boolean }) {
  const highlight = isActive || hasUnread;
  const cls = `shrink-0 transition-colors duration-150 ${highlight ? "text-white" : "text-slate-500 group-hover:text-slate-400"}`;

  switch (type) {
    case "voice":
      return (
        <svg viewBox="0 0 24 24" className={`h-4 w-4 fill-current ${cls}`}>
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-3.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
        </svg>
      );
    case "announcements":
      return <span className={`text-base leading-none ${cls}`}>&#128226;</span>;
    case "rules":
      return <span className={`text-base leading-none ${cls}`}>&#128203;</span>;
    default: // text
      return <span className={`text-lg leading-none ${cls}`}>#</span>;
  }
}

// ── Collapsed state persistence ──

function getCollapsedKey(guildId: string) {
  return `nexe_collapsed_${guildId}`;
}

function loadCollapsed(guildId: string): Set<string> {
  try {
    const raw = localStorage.getItem(getCollapsedKey(guildId));
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function saveCollapsed(guildId: string, collapsed: Set<string>) {
  localStorage.setItem(getCollapsedKey(guildId), JSON.stringify([...collapsed]));
}

// ── Sortable channel wrapper ──

function SortableChannel({ ch, isActive, unread, onClick, canDrag, children }: {
  ch: Channel;
  isActive: boolean;
  unread: number;
  onClick: () => void;
  canDrag: boolean;
  children?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ch.id,
    disabled: !canDrag,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(canDrag ? listeners : {})}
      className={`group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-all duration-150 ${
        isActive
          ? "bg-dark-700/60 text-white"
          : unread > 0
          ? "text-white font-semibold hover:bg-dark-800/80"
          : "text-slate-400 hover:bg-dark-800/60 hover:text-slate-200"
      } ${canDrag ? "cursor-grab active:cursor-grabbing" : ""}`}
      onClick={onClick}
    >
      <ChannelIcon type={ch.type} isActive={isActive} hasUnread={unread > 0} />
      <span className="truncate">{ch.name}</span>
      {ch.isLiveChannel && (
        <span className="ml-auto flex h-2 w-2 rounded-full bg-red-500 animate-pulse" title="Live channel" />
      )}
      {unread > 0 && !isActive && (
        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
      {children}
    </button>
  );
}

// ── Voice channel renderer ──

function VoiceChannel({ ch, isInThisChannel, voiceConnecting: connecting }: {
  ch: Channel;
  isInThisChannel: boolean;
  voiceConnecting: boolean;
}) {
  const voiceParticipants = useVoiceStore((s) => s.participants);
  const voiceSpeaking = useVoiceStore((s) => s.speakingUsers);
  const joinVoice = useVoiceStore((s) => s.joinChannel);
  const usernames = useGuildStore((s) => s.usernames);
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const channelParticipants = voiceParticipants.filter((p) => p.channelId === ch.id);

  return (
    <div>
      <button
        className={`group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
          isInThisChannel
            ? "bg-dark-700/50 text-white"
            : "text-slate-400 hover:bg-dark-800 hover:text-slate-200"
        }`}
        onClick={() => {
          if (!isInThisChannel && activeGuildId) {
            joinVoice(activeGuildId, ch.id);
          }
        }}
      >
        <ChannelIcon type="voice" isActive={isInThisChannel} hasUnread={false} />
        <span className="truncate">{ch.name}</span>
        {isInThisChannel && connecting && (
          <div className="ml-auto h-3 w-3 animate-spin rounded-full border border-slate-600 border-t-nexe-400" />
        )}
      </button>
      {channelParticipants.length > 0 && (
        <div className="ml-6 space-y-0.5 py-0.5">
          {channelParticipants.map((p) => {
            const isSpeaking = voiceSpeaking.has(p.userId);
            return (
              <div
                key={p.userId}
                className="flex items-center gap-1.5 rounded px-2 py-0.5 text-xs text-slate-400"
              >
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white transition-all ${
                    isSpeaking ? "ring-2 ring-green-500 bg-green-600" : "bg-dark-600"
                  }`}
                >
                  {(usernames[p.userId] || "U").charAt(0).toUpperCase()}
                </div>
                <span className={`truncate ${isSpeaking ? "text-slate-200" : ""}`}>
                  {usernames[p.userId] || "User"}
                </span>
                {p.selfMute && (
                  <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 fill-current text-red-400">
                    <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                  </svg>
                )}
                {p.selfDeaf && (
                  <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 fill-current text-red-400">
                    <path d="M4.34 2.93L2.93 4.34 7.29 8.7 7 9H3v6h4l5 5v-6.59l4.18 4.18c-.65.49-1.38.88-2.18 1.11v2.06a8.94 8.94 0 0 0 3.61-1.75l2.05 2.05 1.41-1.41L4.34 2.93zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zm-7-8l-1.88 1.88L12 7.76zm4.5 8A4.5 4.5 0 0 0 14 7.97v1.79l2.48 2.48c.01-.08.02-.16.02-.24z" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Context menu ──

function ContextMenu({ x, y, items, onClose }: {
  x: number;
  y: number;
  items: { label: string; danger?: boolean; onClick: () => void }[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 10);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] overflow-hidden rounded-lg border border-dark-700 bg-dark-800 py-1 shadow-xl animate-slide-up"
      style={{ top: y, left: x }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => { item.onClick(); onClose(); }}
          className={`flex w-full items-center px-3 py-1.5 text-sm transition-colors hover:bg-dark-700 ${
            item.danger ? "text-red-400 hover:text-red-300" : "text-slate-300 hover:text-white"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ── Category section component ──

function CategorySection({
  category,
  channels,
  isCollapsed,
  onToggle,
  canManageChannels,
  channelLimitReached,
  onCreateChannel,
  renderChannel,
  onContextMenu,
}: {
  category: Category | null; // null = uncategorized
  channels: Channel[];
  isCollapsed: boolean;
  onToggle: () => void;
  canManageChannels: boolean;
  channelLimitReached: boolean;
  onCreateChannel: (categoryId?: string) => void;
  renderChannel: (ch: Channel) => React.ReactNode;
  onContextMenu: (e: React.MouseEvent, category: Category) => void;
}) {
  if (channels.length === 0 && !category) return null;

  const label = category ? category.name.toUpperCase() : null;

  return (
    <div className="mb-0.5">
      {label && (
        <div
          className="group flex w-full items-center gap-0.5 px-1 py-1"
          onContextMenu={(e) => { if (category && canManageChannels) { e.preventDefault(); onContextMenu(e, category); } }}
        >
          <button
            className="flex flex-1 items-center gap-0.5 text-xs font-semibold uppercase tracking-wide text-slate-400 transition-colors hover:text-slate-200"
            onClick={onToggle}
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-3 w-3 fill-current transition-transform duration-200 ${isCollapsed ? "-rotate-90" : ""}`}
            >
              <path d="M7 10l5 5 5-5z" />
            </svg>
            <span className="truncate">{label}</span>
          </button>
          {canManageChannels && (
            <button
              onClick={() => !channelLimitReached && onCreateChannel(category?.id)}
              disabled={channelLimitReached}
              className={`invisible h-4 w-4 items-center justify-center rounded transition-colors group-hover:visible flex ${
                channelLimitReached ? "text-slate-600 cursor-not-allowed" : "text-slate-400 hover:text-slate-200"
              }`}
              title="Create channel"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                <path d="M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6z" />
              </svg>
            </button>
          )}
        </div>
      )}

      {(!isCollapsed || !label) && channels.map((ch) => renderChannel(ch))}
    </div>
  );
}

// ── Inline edit for category name ──

function CategoryEditModal({ category, onClose }: { category: Category; onClose: () => void }) {
  const [name, setName] = useState(category.name);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === category.name) { onClose(); return; }
    setLoading(true);
    try {
      const updated = await api.updateCategory(category.id, trimmed);
      const guildId = category.guildId;
      useGuildStore.setState((s) => ({
        categories: {
          ...s.categories,
          [guildId]: (s.categories[guildId] || []).map((c) =>
            c.id === category.id ? { ...c, ...updated } : c
          ),
        },
      }));
      onClose();
    } catch (err) {
      console.error("Failed to update category:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-dark-800 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-slate-100">Edit Category</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
          className="w-full rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-nexe-500"
          placeholder="Category name"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={handleSave} disabled={loading || !name.trim()} className="rounded-lg bg-nexe-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-nexe-500 disabled:opacity-50">
            {loading ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create Category Modal ──

function CreateCategoryModal({ guildId, onClose }: { guildId: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      await api.createCategory(guildId, trimmed);
      onClose();
    } catch (err) {
      console.error("Failed to create category:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-dark-800 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-slate-100">Create Category</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }}
          className="w-full rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-nexe-500"
          placeholder="Category name"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={handleCreate} disabled={loading || !name.trim()} className="rounded-lg bg-nexe-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-nexe-500 disabled:opacity-50">
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Main component
// ══════════════════════════════════════════════════════════════════════════════

export default function ChannelList() {
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const activeChannelId = useGuildStore((s) => s.activeChannelId);
  const setActiveChannel = useGuildStore((s) => s.setActiveChannel);
  const allChannels = useGuildStore((s) => s.channels);
  const allCategories = useGuildStore((s) => s.categories);
  const channels = (activeGuildId ? allChannels[activeGuildId] : undefined) ?? EMPTY_CHANNELS;
  const categories = (activeGuildId ? allCategories[activeGuildId] : undefined) ?? EMPTY_CATEGORIES;
  const guilds = useGuildStore((s) => s.guilds);
  const user = useAuthStore((s) => s.user);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [createChannelCategoryId, setCreateChannelCategoryId] = useState<string | undefined>(undefined);
  const [showSettings, setShowSettings] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; category: Category } | null>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);

  const allRoles = useGuildStore((s) => s.roles);
  const memberRolesMap = useGuildStore((s) => s.memberRoles);

  const activeGuild = guilds.find((g) => g.id === activeGuildId);
  const serverName = activeGuild?.name || "Nexe";
  const userStatus = user?.status || "online";

  // Permission computation
  const guildRoles = (activeGuildId ? allRoles[activeGuildId] : undefined) ?? [];
  const isOwner = activeGuild?.ownerId === user?.id;
  const myRoleIds = memberRolesMap[user?.id ?? ""] || [];
  const myPerms = computePermissions(myRoleIds, guildRoles);
  const canManageChannels = isOwner || hasPermission(myPerms, Permissions.MANAGE_CHANNELS);
  const channelLimitReached = channels.length >= FREE_TIER_LIMITS.MAX_CHANNELS_PER_GUILD;
  const unreadChannels = useGuildStore((s) => s.unreadChannels);

  const reorderChannels = useGuildStore((s) => s.reorderChannels);

  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const voiceConnected = useVoiceStore((s) => s.connected);
  const voiceConnecting = useVoiceStore((s) => s.connecting);
  // Collapsed state per guild, persisted in localStorage
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => activeGuildId ? loadCollapsed(activeGuildId) : new Set()
  );

  // Reload collapsed state when guild changes
  useEffect(() => {
    if (activeGuildId) {
      setCollapsedSections(loadCollapsed(activeGuildId));
    }
  }, [activeGuildId]);

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      if (activeGuildId) saveCollapsed(activeGuildId, next);
      return next;
    });
  }, [activeGuildId]);

  // Group channels by category
  const { sortedCategories, uncategorizedChannels, channelsByCategory } = useMemo(() => {
    const sorted = [...categories].sort((a, b) => a.position - b.position);
    const uncategorized: Channel[] = [];
    const byCategory: Record<string, Channel[]> = {};

    for (const cat of sorted) {
      byCategory[cat.id] = [];
    }

    for (const ch of channels) {
      if (ch.categoryId && byCategory[ch.categoryId]) {
        byCategory[ch.categoryId].push(ch);
      } else {
        uncategorized.push(ch);
      }
    }

    // Sort channels within each group by position
    uncategorized.sort((a, b) => a.position - b.position);
    for (const catId of Object.keys(byCategory)) {
      byCategory[catId].sort((a, b) => a.position - b.position);
    }

    return {
      sortedCategories: sorted,
      uncategorizedChannels: uncategorized,
      channelsByCategory: byCategory,
    };
  }, [channels, categories]);

  // Drag and drop for text channels
  const textChannelIds = useMemo(() =>
    channels.filter((c) => c.type === "text").map((c) => c.id),
  [channels]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !activeGuildId) return;

    const textChs = channels.filter((c) => c.type === "text");
    const oldIndex = textChs.findIndex((c) => c.id === active.id);
    const newIndex = textChs.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(textChs, oldIndex, newIndex);
    reorderChannels(activeGuildId, reordered.map((c) => c.id));
  }, [channels, activeGuildId, reorderChannels]);

  // Context menu for categories
  const handleCategoryContextMenu = useCallback((e: React.MouseEvent, category: Category) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, category });
  }, []);

  const handleDeleteCategory = useCallback(async (category: Category) => {
    try {
      await api.deleteCategory(category.id);
      useGuildStore.setState((s) => ({
        categories: {
          ...s.categories,
          [category.guildId]: (s.categories[category.guildId] || []).filter((c) => c.id !== category.id),
        },
        // Clear categoryId from channels that belonged to this category
        channels: {
          ...s.channels,
          [category.guildId]: (s.channels[category.guildId] || []).map((ch) =>
            ch.categoryId === category.id ? { ...ch, categoryId: undefined } : ch
          ),
        },
      }));
    } catch (err) {
      console.error("Failed to delete category:", err);
    }
  }, []);

  const handleCreateChannelInCategory = useCallback((categoryId?: string) => {
    setCreateChannelCategoryId(categoryId);
    setShowCreateChannel(true);
  }, []);

  // Render a single channel (text or voice)
  const renderChannel = useCallback((ch: Channel) => {
    if (ch.type === "voice") {
      const isInThisChannel = voiceChannelId === ch.id && (voiceConnected || voiceConnecting);
      return (
        <VoiceChannel
          key={ch.id}
          ch={ch}
          isInThisChannel={isInThisChannel}
          voiceConnecting={voiceConnecting}
        />
      );
    }

    // Text / announcements / rules channel
    const unread = unreadChannels[ch.id] || 0;
    return (
      <SortableChannel
        key={ch.id}
        ch={ch}
        isActive={activeChannelId === ch.id}
        unread={unread}
        onClick={() => setActiveChannel(ch.id)}
        canDrag={canManageChannels && ch.type === "text"}
      />
    );
  }, [activeChannelId, unreadChannels, canManageChannels, setActiveChannel, voiceChannelId, voiceConnected, voiceConnecting]);

  return (
    <>
      <div className="flex h-full w-60 shrink-0 flex-col bg-dark-900">
        {/* Server header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-dark-950 px-4 transition-colors">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
            {serverName}
          </h2>
          <div className="flex items-center gap-0.5">
          <NotificationBell />
          {activeGuildId && (
            <>
              <button
                onClick={() => setShowInvite(true)}
                className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:text-slate-200"
                title="Invite people"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                  <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:text-slate-200"
                title="Server settings"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                  <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
                </svg>
              </button>
              {canManageChannels && (
                <button
                  onClick={() => !channelLimitReached && handleCreateChannelInCategory(undefined)}
                  disabled={channelLimitReached}
                  className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                    channelLimitReached
                      ? "text-slate-600 cursor-not-allowed"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                  title={channelLimitReached ? `Channel limit reached (${channels.length}/${FREE_TIER_LIMITS.MAX_CHANNELS_PER_GUILD})` : "Create channel"}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                    <path d="M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6z" />
                  </svg>
                </button>
              )}
            </>
          )}
          </div>
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {!activeGuildId ? (
            <p className="px-2 py-4 text-center text-sm text-slate-500">
              Select a server to see channels
            </p>
          ) : channels.length === 0 && categories.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-slate-500">
              No channels yet
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={textChannelIds} strategy={verticalListSortingStrategy}>
                {/* Uncategorized channels at the top */}
                {uncategorizedChannels.length > 0 && (
                  <CategorySection
                    category={null}
                    channels={uncategorizedChannels}
                    isCollapsed={false}
                    onToggle={() => {}}
                    canManageChannels={canManageChannels}
                    channelLimitReached={channelLimitReached}
                    onCreateChannel={handleCreateChannelInCategory}
                    renderChannel={renderChannel}
                    onContextMenu={() => {}}
                  />
                )}

                {/* Categories with their channels */}
                {sortedCategories.map((cat) => (
                  <CategorySection
                    key={cat.id}
                    category={cat}
                    channels={channelsByCategory[cat.id] || []}
                    isCollapsed={collapsedSections.has(cat.id)}
                    onToggle={() => toggleSection(cat.id)}
                    canManageChannels={canManageChannels}
                    channelLimitReached={channelLimitReached}
                    onCreateChannel={handleCreateChannelInCategory}
                    renderChannel={renderChannel}
                    onContextMenu={handleCategoryContextMenu}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}

          {/* Create Category button */}
          {activeGuildId && canManageChannels && (
            <button
              onClick={() => setShowCreateCategory(true)}
              className="mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-slate-500 transition-colors hover:bg-dark-800/60 hover:text-slate-300"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                <path d="M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6z" />
              </svg>
              Create Category
            </button>
          )}
        </div>

        {/* Voice connection panel */}
        <VoicePanel />

        {/* User info bar */}
        <div className="flex shrink-0 items-center gap-2 border-t border-dark-950 bg-dark-950/50 px-2 py-2 transition-colors">
          <div className="relative" ref={statusMenuRef}>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-nexe-600 text-xs font-semibold text-white">
              {(user?.username || "U").charAt(0).toUpperCase()}
            </div>
            <button
              onClick={() => setShowStatusMenu((v) => !v)}
              className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-dark-950 cursor-pointer transition-transform hover:scale-125 ${statusColors[userStatus] || statusColors.online}`}
              title="Change status"
            />
            {showStatusMenu && (
              <StatusMenu
                current={userStatus}
                onSelect={async (status, clearAfter) => {
                  setShowStatusMenu(false);
                  try {
                    await api.updatePresence(status, clearAfter);
                    const typedStatus = status as "online" | "idle" | "dnd" | "offline" | "invisible";
                    useAuthStore.setState((s) => ({
                      user: s.user ? { ...s.user, status: typedStatus } : null,
                    }));
                    const userId = useAuthStore.getState().user?.id;
                    if (userId) {
                      useGuildStore.setState((s) => ({
                        presenceMap: { ...s.presenceMap, [userId]: status },
                      }));
                    }
                  } catch (err) {
                    console.error("Failed to update status:", err);
                  }
                }}
                onClose={() => setShowStatusMenu(false)}
                anchorRef={statusMenuRef}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-200">
              {user?.displayName || user?.username || "User"}
            </p>
            <p className="truncate text-xs capitalize text-slate-500">
              {userStatus === "dnd" ? "Do Not Disturb" : userStatus === "invisible" ? "Invisible" : userStatus}
            </p>
          </div>
          <button
            onClick={() => setShowUserSettings(true)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-dark-800 hover:text-slate-200"
            title="User settings"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
            </svg>
          </button>
        </div>
      </div>

      {showCreateChannel && (
        <CreateChannelModal
          defaultCategoryId={createChannelCategoryId}
          onClose={() => { setShowCreateChannel(false); setCreateChannelCategoryId(undefined); }}
        />
      )}

      {showSettings && activeGuildId && (
        <ServerSettingsModal
          guildId={activeGuildId}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showInvite && activeGuildId && (
        channels.length === 0 ? (
          <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 animate-modal-backdrop" onClick={() => setShowInvite(false)}>
            <div className="w-full max-w-sm rounded-xl bg-dark-800 p-6 text-center shadow-2xl animate-modal-content" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm text-slate-300">Create a channel first before inviting people.</p>
              <button onClick={() => setShowInvite(false)} className="mt-4 rounded-lg bg-nexe-600 px-4 py-2 text-sm font-medium text-white hover:bg-nexe-500">OK</button>
            </div>
          </div>
        ) : (
          <InviteModal
            guildId={activeGuildId}
            channelId={activeChannelId || channels[0]?.id || ""}
            onClose={() => setShowInvite(false)}
          />
        )
      )}

      {showUserSettings && (
        <UserSettingsModal onClose={() => setShowUserSettings(false)} />
      )}

      {showCreateCategory && activeGuildId && (
        <CreateCategoryModal guildId={activeGuildId} onClose={() => setShowCreateCategory(false)} />
      )}

      {editingCategory && (
        <CategoryEditModal category={editingCategory} onClose={() => setEditingCategory(null)} />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: "Edit Category", onClick: () => setEditingCategory(contextMenu.category) },
            { label: "Create Channel", onClick: () => handleCreateChannelInCategory(contextMenu.category.id) },
            { label: "Delete Category", danger: true, onClick: () => handleDeleteCategory(contextMenu.category) },
          ]}
        />
      )}
    </>
  );
}

// ── Status Selector Dropdown ──

const STATUS_OPTIONS = [
  { value: "online", label: "Online", color: "bg-green-500", hasDuration: false },
  { value: "idle", label: "Idle", color: "bg-yellow-500", hasDuration: false },
  { value: "dnd", label: "Do Not Disturb", color: "bg-red-500", hasDuration: true },
  { value: "invisible", label: "Invisible", color: "bg-slate-500", hasDuration: true },
] as const;

const DURATION_OPTIONS = [
  { label: "Don't clear", value: 0 },
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "4 hours", value: 240 },
  { label: "8 hours", value: 480 },
  { label: "24 hours", value: 1440 },
] as const;

function StatusMenu({
  current,
  onSelect,
  onClose,
  anchorRef,
}: {
  current: string;
  onSelect: (status: string, clearAfter?: number) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [durationFor, setDurationFor] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 10);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [onClose, anchorRef]);

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 mb-2 w-52 overflow-hidden rounded-lg border border-dark-700 bg-dark-800 py-1 shadow-xl animate-slide-up"
      style={{ zIndex: 100 }}
    >
      {durationFor ? (
        <>
          <button
            onClick={() => setDurationFor(null)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 hover:text-slate-300"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current">
              <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
            </svg>
            Clear after
          </button>
          {DURATION_OPTIONS.map((dur) => (
            <button
              key={dur.value}
              onClick={() => onSelect(durationFor, dur.value || undefined)}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-dark-700 hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current text-slate-500">
                <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" />
              </svg>
              <span>{dur.label}</span>
            </button>
          ))}
        </>
      ) : (
        <>
          <p className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Set Status
          </p>
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                if (opt.hasDuration) {
                  setDurationFor(opt.value);
                } else {
                  onSelect(opt.value);
                }
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-sm transition-colors hover:bg-dark-700 ${
                current === opt.value ? "text-white" : "text-slate-300"
              }`}
            >
              <div className={`h-2.5 w-2.5 rounded-full ${opt.color}`} />
              <span>{opt.label}</span>
              {current === opt.value ? (
                <svg className="ml-auto h-3.5 w-3.5 text-nexe-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : opt.hasDuration ? (
                <svg className="ml-auto h-3.5 w-3.5 text-slate-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                </svg>
              ) : null}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
