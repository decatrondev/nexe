import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useGuildStore } from "../stores/guild";
import { useAuthStore } from "../stores/auth";
import { api, type Channel, type Role, type Ban, type AuditLogEntry } from "../lib/api";
import { hasPermission, computePermissions, Permissions } from "../lib/permissions";
import { FREE_TIER_LIMITS } from "../lib/limits";
import { Tabs, TabList, TabPanel, type TabItem } from "@nexe/ui";

interface ServerSettingsModalProps {
  guildId: string;
  onClose: () => void;
}

const EMPTY_CHANNELS: Channel[] = [];

export default function ServerSettingsModal({ guildId, onClose }: ServerSettingsModalProps) {
  // Permission computation
  const user = useAuthStore((s) => s.user);
  const allRoles = useGuildStore((s) => s.roles);
  const memberRolesMap = useGuildStore((s) => s.memberRoles);
  const guilds = useGuildStore((s) => s.guilds);
  const guild = guilds.find((g) => g.id === guildId);
  const isOwner = guild?.ownerId === user?.id;
  const guildRoles = allRoles[guildId] ?? [];
  const myRoleIds = memberRolesMap[user?.id ?? ""] || [];
  const myPerms = computePermissions(myRoleIds, guildRoles);

  // Build tabs based on permissions
  const availableTabs = useMemo(() => {
    const tabs: TabItem[] = [];
    if (isOwner || hasPermission(myPerms, Permissions.MANAGE_GUILD))
      tabs.push({ id: "overview", label: "Overview" });
    if (isOwner || hasPermission(myPerms, Permissions.MANAGE_CHANNELS))
      tabs.push({ id: "channels", label: "Channels" });
    if (isOwner || hasPermission(myPerms, Permissions.MANAGE_ROLES))
      tabs.push({ id: "roles", label: "Roles" });
    if (isOwner || hasPermission(myPerms, Permissions.BAN_MEMBERS))
      tabs.push({ id: "bans", label: "Bans" });
    if (isOwner || hasPermission(myPerms, Permissions.MANAGE_GUILD))
      tabs.push({ id: "audit", label: "Audit Log" });
    if (isOwner || hasPermission(myPerms, Permissions.MANAGE_GUILD))
      tabs.push({ id: "automod", label: "Automod" });
    if (isOwner)
      tabs.push({ id: "twitch", label: "Twitch", color: "text-[#9146FF] hover:text-[#a970ff]" });
    tabs.push({ id: "danger", label: "Danger Zone", color: "text-red-400 hover:text-red-300" });
    return tabs;
  }, [isOwner, myPerms]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex bg-dark-900/95 animate-fade-in">
      <Tabs defaultTab={availableTabs[0]?.id ?? "danger"} className="flex w-full">
        {/* Sidebar */}
        <div className="flex w-56 shrink-0 flex-col border-r border-dark-800 bg-dark-900 pt-14">
          <div className="flex-1 px-3">
            <TabList tabs={availableTabs} label="Server Settings" />
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Close button */}
          <div className="flex shrink-0 justify-end p-4">
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-dark-700 text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
              title="Close (Esc)"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                <path d="M18.3 5.71a1 1 0 0 0-1.42 0L12 10.59 7.12 5.71A1 1 0 0 0 5.7 7.12L10.59 12l-4.88 4.88a1 1 0 1 0 1.42 1.42L12 13.41l4.88 4.88a1 1 0 0 0 1.42-1.42L13.41 12l4.88-4.88a1 1 0 0 0 0-1.41z" />
              </svg>
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto px-10 pb-10">
            <div className="mx-auto max-w-xl">
              <TabPanel id="overview"><OverviewTab guildId={guildId} /></TabPanel>
              <TabPanel id="channels"><ChannelsTab guildId={guildId} /></TabPanel>
              <TabPanel id="roles"><RolesTab guildId={guildId} /></TabPanel>
              <TabPanel id="bans"><BansTab guildId={guildId} /></TabPanel>
              <TabPanel id="audit"><AuditLogTab guildId={guildId} /></TabPanel>
              <TabPanel id="automod"><AutomodTab guildId={guildId} /></TabPanel>
              <TabPanel id="twitch"><TwitchTab guildId={guildId} /></TabPanel>
              <TabPanel id="danger"><DangerZoneTab guildId={guildId} onClose={onClose} /></TabPanel>
            </div>
          </div>
        </div>
      </Tabs>
    </div>
  );
}

// ---- Overview Tab ----

function OverviewTab({ guildId }: { guildId: string }) {
  const guild = useGuildStore((s) => s.guilds.find((g) => g.id === guildId));
  const updateGuild = useGuildStore((s) => s.updateGuild);

  const [name, setName] = useState(guild?.name ?? "");
  const [description, setDescription] = useState(guild?.description ?? "");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const hasChanges = name !== (guild?.name ?? "") || description !== (guild?.description ?? "");

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!hasChanges || !name.trim()) return;
    setLoading(true);
    setFeedback(null);
    try {
      await updateGuild(guildId, { name: name.trim(), description: description.trim() });
      setFeedback({ type: "success", message: "Server settings saved!" });
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : "Failed to save changes" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h2 className="mb-6 text-xl font-bold text-slate-100">Overview</h2>
      {feedback && (
        <div
          className={`mb-4 rounded-lg px-4 py-3 text-sm border ${
            feedback.type === "success"
              ? "bg-green-500/10 text-green-400 border-green-500/20"
              : "bg-red-500/10 text-red-400 border-red-500/20"
          }`}
        >
          {feedback.message}
        </div>
      )}
      <form onSubmit={handleSave} className="space-y-5">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
            Server Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-lg border border-dark-700 bg-dark-900 px-4 py-2.5 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-500 focus:border-nexe-500"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-lg border border-dark-700 bg-dark-900 px-4 py-2.5 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-500 focus:border-nexe-500"
            placeholder="What is this server about?"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !hasChanges || !name.trim()}
          className="rounded-lg bg-nexe-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-nexe-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </>
  );
}

// ---- Channels Tab ----

function ChannelsTab({ guildId }: { guildId: string }) {
  const allChannels = useGuildStore((s) => s.channels);
  const channels = allChannels[guildId] ?? EMPTY_CHANNELS;
  const allRolesMap = useGuildStore((s) => s.roles);
  const guildRoles = allRolesMap[guildId] ?? [];
  const updateChannelStore = useGuildStore((s) => s.updateChannel);
  const deleteChannelStore = useGuildStore((s) => s.deleteChannel);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlowmode, setEditSlowmode] = useState(0);
  const [showPermsForId, setShowPermsForId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const SLOWMODE_OPTIONS = [
    { label: "Off", value: 0 },
    { label: "5s", value: 5 },
    { label: "10s", value: 10 },
    { label: "15s", value: 15 },
    { label: "30s", value: 30 },
    { label: "1m", value: 60 },
    { label: "2m", value: 120 },
    { label: "5m", value: 300 },
    { label: "10m", value: 600 },
  ];

  function startEdit(ch: Channel) {
    setEditingId(ch.id);
    setEditName(ch.name);
    setEditSlowmode(ch.slowmodeSeconds ?? 0);
    setShowPermsForId(null);
    setError("");
  }

  async function saveEdit(channelId: string) {
    if (!editName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const ch = channels.find((c) => c.id === channelId);
      const data: { name?: string; slowmodeSeconds?: number } = {};
      if (editName.trim() !== ch?.name) data.name = editName.trim();
      if (editSlowmode !== (ch?.slowmodeSeconds ?? 0)) data.slowmodeSeconds = editSlowmode;
      await updateChannelStore(channelId, Object.keys(data).length > 0 ? data : { name: editName.trim() });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update channel");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(channelId: string) {
    setLoading(true);
    setError("");
    try {
      await deleteChannelStore(channelId);
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete channel");
    } finally {
      setLoading(false);
    }
  }

  // Channel permission overrides UI data
  const OVERRIDE_PERMS = [
    { name: "View Channel", bit: Permissions.VIEW_CHANNEL },
    { name: "Send Messages", bit: Permissions.SEND_MESSAGES },
    { name: "Manage Messages", bit: Permissions.MANAGE_MESSAGES },
  ] as const;

  return (
    <>
      <h2 className="mb-6 text-xl font-bold text-slate-100">Channels</h2>
      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
          {error}
        </div>
      )}
      {channels.length === 0 ? (
        <p className="text-sm text-slate-500">No channels in this server.</p>
      ) : (
        <div className="space-y-1">
          {channels.map((ch) => (
            <div key={ch.id}>
              <div className="flex items-center gap-2 rounded-lg bg-dark-800/50 px-3 py-2">
                <span className="shrink-0 text-sm text-slate-500">
                  {ch.type === "voice" ? (
                    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                      <path d="M12 3a1 1 0 0 0-.707.293l-7 7a1 1 0 0 0 0 1.414l7 7A1 1 0 0 0 13 18v-4.28c3.526.36 5.47 2.03 6.136 3.636a1 1 0 0 0 1.864-.728C20.143 14.07 17.368 11 13 10.29V6a1 1 0 0 0-1-1z" />
                    </svg>
                  ) : (
                    "#"
                  )}
                </span>

                {editingId === ch.id ? (
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(ch.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="flex-1 rounded border border-dark-600 bg-dark-900 px-2 py-1 text-sm text-slate-200 outline-none focus:border-nexe-500"
                        autoFocus
                        disabled={loading}
                      />
                      <button
                        onClick={() => saveEdit(ch.id)}
                        disabled={loading || !editName.trim()}
                        className="text-xs text-green-400 hover:text-green-300 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs text-slate-400 hover:text-slate-300"
                      >
                        Cancel
                      </button>
                    </div>
                    {ch.type === "text" && (
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] font-medium text-slate-400">Slowmode:</label>
                        <select
                          value={editSlowmode}
                          onChange={(e) => setEditSlowmode(Number(e.target.value))}
                          className="rounded border border-dark-600 bg-dark-900 px-2 py-1 text-[12px] text-slate-200 outline-none focus:border-nexe-500"
                          disabled={loading}
                        >
                          {SLOWMODE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ) : confirmDeleteId === ch.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <span className="flex-1 truncate text-sm text-red-400">
                      Delete #{ch.name}?
                    </span>
                    <button
                      onClick={() => handleDelete(ch.id)}
                      disabled={loading}
                      className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs text-slate-400 hover:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 truncate text-sm text-slate-200">
                      {ch.name}
                    </span>
                    <button
                      onClick={() => setShowPermsForId(showPermsForId === ch.id ? null : ch.id)}
                      className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                        showPermsForId === ch.id ? "text-nexe-400" : "text-slate-500 hover:text-slate-300"
                      }`}
                      title="Channel permissions"
                    >
                      {/* Shield icon */}
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => startEdit(ch)}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-500 transition-colors hover:text-slate-300"
                      title="Edit channel"
                    >
                      {/* Pencil icon */}
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                        <path d="M16.474 5.408l2.118 2.117m-.756-3.982L12.109 9.27a2.118 2.118 0 0 0-.58 1.082L11 13l2.648-.53c.41-.082.786-.283 1.082-.579l5.727-5.727a1.853 1.853 0 1 0-2.621-2.621zM19.5 12c0 .76-.056 1.508-.165 2.24C18.58 18.776 14.68 22 10 22c-5.523 0-10-4.477-10-10S4.477 2 10 2c1.376 0 2.69.278 3.884.78" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(ch.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-500 transition-colors hover:text-red-400"
                      title="Delete channel"
                    >
                      {/* Trash icon */}
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                        <path d="M9 3v1H4v2h1v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3H9zm0 5h2v9H9V8zm4 0h2v9h-2V8z" />
                      </svg>
                    </button>
                  </>
                )}
              </div>

              {/* Channel Permission Overrides Panel */}
              {showPermsForId === ch.id && (
                <div className="ml-6 mt-1 mb-2 rounded-lg border border-dark-700 bg-dark-800/70 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                      Permission Overrides
                    </h4>
                    <span className="rounded-full bg-yellow-500/10 border border-yellow-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-yellow-400">
                      Coming soon
                    </span>
                  </div>
                  <p className="mb-3 text-[11px] text-slate-500">
                    Set per-channel permissions for specific roles. Override the server-wide role settings for this channel only.
                  </p>
                  <div className="space-y-2 opacity-50 pointer-events-none">
                    {guildRoles
                      .filter((r) => !r.isDefault)
                      .slice(0, 5)
                      .map((role) => (
                        <div key={role.id} className="rounded-md bg-dark-900/60 px-3 py-2">
                          <div className="mb-2 flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: role.color || "#99AAB5" }}
                            />
                            <span className="text-xs font-medium text-slate-300">{role.name}</span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {OVERRIDE_PERMS.map((perm) => (
                              <div key={perm.bit} className="flex items-center gap-2">
                                <span className="text-[11px] text-slate-400 w-28">{perm.name}</span>
                                <div className="flex gap-1">
                                  {(["Allow", "Deny", "Inherit"] as const).map((state) => (
                                    <button
                                      key={state}
                                      disabled
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                        state === "Inherit"
                                          ? "bg-dark-700 text-slate-400"
                                          : state === "Allow"
                                            ? "bg-dark-700 text-slate-500"
                                            : "bg-dark-700 text-slate-500"
                                      }`}
                                    >
                                      {state}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                  {guildRoles.filter((r) => !r.isDefault).length === 0 && (
                    <p className="text-[11px] text-slate-500 italic">No roles to configure.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---- Roles Tab ----

const PRESET_COLORS = [
  "#5865F2", "#57F287", "#FEE75C", "#EB459E", "#ED4245",
  "#F47B67", "#E67E22", "#1ABC9C", "#3498DB", "#9B59B6",
  "#E91E63", "#2ECC71", "#00BCD4", "#FF9800", "#8BC34A",
  "#99AAB5",
];

const PERMISSION_GROUPS = [
  {
    label: "General",
    perms: [
      { name: "Administrator", bit: Permissions.ADMINISTRATOR, desc: "Full access to everything" },
      { name: "Manage Server", bit: Permissions.MANAGE_GUILD, desc: "Edit server settings" },
      { name: "Manage Channels", bit: Permissions.MANAGE_CHANNELS, desc: "Create, edit, delete channels" },
      { name: "Manage Roles", bit: Permissions.MANAGE_ROLES, desc: "Create, edit, assign roles" },
    ],
  },
  {
    label: "Moderation",
    perms: [
      { name: "Kick Members", bit: Permissions.KICK_MEMBERS, desc: "Remove members from server" },
      { name: "Ban Members", bit: Permissions.BAN_MEMBERS, desc: "Permanently ban members" },
      { name: "Timeout Members", bit: Permissions.TIMEOUT_MEMBERS, desc: "Temporarily mute members" },
      { name: "Manage Messages", bit: Permissions.MANAGE_MESSAGES, desc: "Delete others' messages" },
    ],
  },
  {
    label: "Text",
    perms: [
      { name: "Send Messages", bit: Permissions.SEND_MESSAGES, desc: "Send messages in channels" },
    ],
  },
] as const;

// Reusable permission editor component
function PermissionEditor({ perms, onChange }: { perms: number; onChange: (p: number) => void }) {
  const isAdmin = (perms & Permissions.ADMINISTRATOR) !== 0;

  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="rounded-md bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-[12px] text-yellow-400">
          Administrator grants all permissions
        </div>
      )}
      {PERMISSION_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{group.label}</p>
          <div className="space-y-1">
            {group.perms.map((p) => {
              const isAdminPerm = p.bit === Permissions.ADMINISTRATOR;
              const disabled = !isAdminPerm && isAdmin;
              const checked = (perms & p.bit) === p.bit;
              return (
                <label
                  key={p.bit}
                  className={`flex items-center justify-between rounded-md px-3 py-2 transition-colors ${
                    disabled ? "opacity-50" : "hover:bg-dark-700/50 cursor-pointer"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-5 w-9 items-center rounded-full transition-colors ${
                      (disabled ? true : checked) ? "bg-nexe-600" : "bg-dark-700"
                    }`}>
                      <div className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
                        (disabled ? true : checked) ? "translate-x-[18px]" : "translate-x-0.5"
                      }`} />
                    </div>
                    <div>
                      <p className="text-[13px] text-slate-200">{p.name}</p>
                      <p className="text-[11px] text-slate-500">{p.desc}</p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={disabled ? true : checked}
                    disabled={disabled}
                    onChange={() => onChange(perms ^ p.bit)}
                    className="sr-only"
                  />
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function RolesTab({ guildId }: { guildId: string }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [newPerms, setNewPerms] = useState(0);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editPerms, setEditPerms] = useState(0);

  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function fetchRoles() {
    try {
      const data = await api.getRoles(guildId);
      setRoles(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roles");
    }
  }

  useEffect(() => {
    fetchRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const role = await api.createRole(guildId, { name: newName.trim(), color: newColor, permissions: newPerms });
      setRoles((prev) => [...prev, role]);
      setNewName("");
      setNewColor(PRESET_COLORS[0]);
      setNewPerms(0);
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create role");
    } finally {
      setLoading(false);
    }
  }

  function startEdit(role: Role) {
    setEditingId(role.id);
    setEditName(role.name);
    setEditColor(role.color ?? PRESET_COLORS[0]);
    setEditPerms(role.permissions ?? 0);
    setError("");
  }

  async function saveEdit(roleId: string) {
    if (!editName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const updated = await api.updateRole(roleId, { guildId, name: editName.trim(), color: editColor, permissions: editPerms });
      setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, ...updated } : r)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(roleId: string) {
    setLoading(true);
    setError("");
    try {
      await api.deleteRole(roleId);
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete role");
    } finally {
      setLoading(false);
    }
  }

  // Reorder: swap positions between two roles
  const [reordering, setReordering] = useState(false);

  async function handleMoveRole(role: Role, direction: "up" | "down") {
    // Non-default, non-auto roles only — sorted by position ascending
    const movable = [...roles]
      .filter((r) => !r.isDefault && !r.isAuto)
      .sort((a, b) => a.position - b.position);

    const idx = movable.findIndex((r) => r.id === role.id);
    if (idx === -1) return;

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= movable.length) return;

    const target = movable[swapIdx];
    setReordering(true);
    setError("");
    try {
      // Swap positions
      const rolePos = role.position;
      const targetPos = target.position;
      await Promise.all([
        api.updateRole(role.id, { guildId, position: targetPos }),
        api.updateRole(target.id, { guildId, position: rolePos }),
      ]);
      await fetchRoles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reorder roles");
    } finally {
      setReordering(false);
    }
  }

  // Sort: @everyone last, auto roles after custom roles, then by position
  const sorted = [...roles].sort((a, b) => {
    if (a.isDefault) return 1;
    if (b.isDefault) return -1;
    if (a.isAuto && !b.isAuto) return 1;
    if (!a.isAuto && b.isAuto) return -1;
    return a.position - b.position;
  });

  // For computing move-ability: only custom (non-default, non-auto) roles
  const movableRoles = sorted.filter((r) => !r.isDefault && !r.isAuto);

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Roles</h2>
          <p className="text-xs text-slate-500">
            {roles.length}/{FREE_TIER_LIMITS.MAX_ROLES_PER_GUILD} roles
          </p>
        </div>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            disabled={roles.length >= FREE_TIER_LIMITS.MAX_ROLES_PER_GUILD}
            className="rounded-lg bg-nexe-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexe-600 disabled:opacity-50 disabled:cursor-not-allowed"
            title={roles.length >= FREE_TIER_LIMITS.MAX_ROLES_PER_GUILD ? `Role limit reached (${roles.length}/${FREE_TIER_LIMITS.MAX_ROLES_PER_GUILD})` : undefined}
          >
            Create Role
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="mb-5 rounded-lg border border-dark-700 bg-dark-800/50 p-4 space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
              Role Name
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New role"
              required
              autoFocus
              className="w-full rounded-lg border border-dark-600 bg-dark-900 px-4 py-2 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-500 focus:border-nexe-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
              Color
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className={`h-7 w-7 rounded-full border-2 transition-transform ${
                    newColor === c ? "border-white scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
              <label
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-dashed border-slate-500 text-xs text-slate-400"
                title="Custom color"
              >
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="sr-only"
                />
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                  <path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0 1 12 22zm0-18c-4.41 0-8 3.59-8 8s3.59 8 8 8c.28 0 .5-.22.5-.5a.54.54 0 0 0-.14-.35c-.41-.46-.63-1.05-.63-1.65a2.5 2.5 0 0 1 2.5-2.5H16c2.21 0 4-1.79 4-4 0-3.86-3.59-7-8-7z" />
                </svg>
              </label>
            </div>
          </div>
          {/* Permissions */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
              Permissions
            </label>
            <div className="rounded-lg border border-dark-700 bg-dark-900 p-3 max-h-60 overflow-y-auto">
              <PermissionEditor perms={newPerms} onChange={setNewPerms} />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={loading || !newName.trim()}
              className="rounded-lg bg-nexe-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexe-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Creating..." : "Create"}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setNewName(""); setNewPerms(0); }}
              className="rounded-lg bg-dark-800 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-dark-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Role list */}
      {sorted.length === 0 ? (
        <p className="text-sm text-slate-500">No roles in this server.</p>
      ) : (
        <div className="space-y-1">
          {sorted.map((role) => {
            const isMovable = !role.isDefault && !role.isAuto;
            const movableIdx = movableRoles.findIndex((r) => r.id === role.id);
            const canMoveUp = isMovable && movableIdx > 0;
            const canMoveDown = isMovable && movableIdx < movableRoles.length - 1;

            return (
            <div
              key={role.id}
              className="flex items-center gap-2 rounded-lg bg-dark-800/50 px-3 py-2"
            >
              {/* Color circle */}
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: role.color || "#99AAB5" }}
              />

              {editingId === role.id ? (
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(role.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="flex-1 rounded border border-dark-600 bg-dark-900 px-2 py-1 text-sm text-slate-200 outline-none focus:border-nexe-500"
                      autoFocus
                      disabled={loading}
                    />
                    <button
                      onClick={() => saveEdit(role.id)}
                      disabled={loading || !editName.trim()}
                      className="text-xs text-green-400 hover:text-green-300 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-xs text-slate-400 hover:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setEditColor(c)}
                        className={`h-5 w-5 rounded-full border-2 transition-transform ${
                          editColor === c ? "border-white scale-110" : "border-transparent"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <label className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-dashed border-slate-500 text-xs text-slate-400">
                      <input
                        type="color"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        className="sr-only"
                      />
                      <span className="text-[8px]">#</span>
                    </label>
                  </div>

                  {/* Permissions */}
                  <div className="mt-3 rounded-lg border border-dark-700 bg-dark-900 p-3 max-h-60 overflow-y-auto">
                    <PermissionEditor perms={editPerms} onChange={setEditPerms} />
                  </div>
                </div>
              ) : confirmDeleteId === role.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <span className="flex-1 truncate text-sm text-red-400">
                    Delete @{role.name}?
                  </span>
                  <button
                    onClick={() => handleDelete(role.id)}
                    disabled={loading}
                    className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="text-xs text-slate-400 hover:text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <span className="flex-1 truncate text-sm text-slate-200">
                    {role.name}
                    {role.isDefault && (
                      <span className="ml-2 text-xs text-slate-500">(default)</span>
                    )}
                    {role.isAuto && (
                      <span className="ml-2 text-xs text-purple-400">(auto)</span>
                    )}
                  </span>

                  {/* Reorder arrows — only for custom roles (not default, not auto) */}
                  {isMovable && (
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => handleMoveRole(role, "up")}
                        disabled={!canMoveUp || reordering || loading}
                        className="flex h-4 w-5 items-center justify-center rounded text-slate-500 transition-colors hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move up"
                      >
                        <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current">
                          <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleMoveRole(role, "down")}
                        disabled={!canMoveDown || reordering || loading}
                        className="flex h-4 w-5 items-center justify-center rounded text-slate-500 transition-colors hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move down"
                      >
                        <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current">
                          <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                        </svg>
                      </button>
                    </div>
                  )}

                  {!role.isDefault && !role.isAuto && (
                    <>
                      <button
                        onClick={() => startEdit(role)}
                        className="flex h-6 w-6 items-center justify-center rounded text-slate-500 transition-colors hover:text-slate-300"
                        title="Edit role"
                      >
                        {/* Pencil icon */}
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                          <path d="M16.474 5.408l2.118 2.117m-.756-3.982L12.109 9.27a2.118 2.118 0 0 0-.58 1.082L11 13l2.648-.53c.41-.082.786-.283 1.082-.579l5.727-5.727a1.853 1.853 0 1 0-2.621-2.621zM19.5 12c0 .76-.056 1.508-.165 2.24C18.58 18.776 14.68 22 10 22c-5.523 0-10-4.477-10-10S4.477 2 10 2c1.376 0 2.69.278 3.884.78" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(role.id)}
                        className="flex h-6 w-6 items-center justify-center rounded text-slate-500 transition-colors hover:text-red-400"
                        title="Delete role"
                      >
                        {/* Trash icon */}
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                          <path d="M9 3v1H4v2h1v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3H9zm0 5h2v9H9V8zm4 0h2v9h-2V8z" />
                        </svg>
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ---- Bans Tab ----

function BansTab({ guildId }: { guildId: string }) {
  const [bans, setBans] = useState<Ban[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unbanning, setUnbanning] = useState<string | null>(null);
  const usernames = useGuildStore((s) => s.usernames);

  useEffect(() => {
    api
      .listBans(guildId)
      .then((data) => setBans(Array.isArray(data) ? data : []))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load bans"),
      )
      .finally(() => setLoading(false));
  }, [guildId]);

  async function handleUnban(userId: string) {
    setUnbanning(userId);
    setError("");
    try {
      await api.unbanMember(guildId, userId);
      setBans((prev) => prev.filter((b) => b.userId !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unban user");
    } finally {
      setUnbanning(null);
    }
  }

  return (
    <>
      <h2 className="mb-6 text-xl font-bold text-slate-100">Bans</h2>
      {error && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {loading ? (
        <p className="text-sm text-slate-500">Loading bans...</p>
      ) : bans.length === 0 ? (
        <p className="text-sm text-slate-500">No banned users</p>
      ) : (
        <div className="space-y-1">
          {bans.map((ban) => (
            <div
              key={ban.userId}
              className="flex items-center gap-3 rounded-lg border border-dark-700 bg-dark-800 px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-slate-200">
                  {usernames[ban.userId] || ban.userId.slice(0, 8)}
                </p>
                {ban.reason && (
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    Reason: {ban.reason}
                  </p>
                )}
              </div>
              <button
                onClick={() => handleUnban(ban.userId)}
                disabled={unbanning === ban.userId}
                className="shrink-0 rounded-md bg-dark-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-dark-600 hover:text-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {unbanning === ban.userId ? "Unbanning..." : "Unban"}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---- Audit Log Tab ----

const ACTION_COLORS: Record<string, string> = {
  ban: "bg-red-500/20 text-red-400",
  kick: "bg-orange-500/20 text-orange-400",
  timeout: "bg-yellow-500/20 text-yellow-400",
  unban: "bg-green-500/20 text-green-400",
  mute: "bg-purple-500/20 text-purple-400",
  warn: "bg-amber-500/20 text-amber-400",
};

function AuditLogTab({ guildId }: { guildId: string }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const usernames = useGuildStore((s) => s.usernames);

  useEffect(() => {
    api
      .getAuditLog(guildId)
      .then((data) => setEntries(Array.isArray(data) ? data : []))
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Failed to load audit log",
        ),
      )
      .finally(() => setLoading(false));
  }, [guildId]);

  function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString();
  }

  return (
    <>
      <h2 className="mb-6 text-xl font-bold text-slate-100">Audit Log</h2>
      {error && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {loading ? (
        <p className="text-sm text-slate-500">Loading audit log...</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-500">No moderation actions yet</p>
      ) : (
        <div className="space-y-1">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-lg border border-dark-700 bg-dark-800 px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase ${
                    ACTION_COLORS[entry.action] ??
                    "bg-slate-500/20 text-slate-400"
                  }`}
                >
                  {entry.action}
                </span>
                <span className="text-sm text-slate-200">
                  {usernames[entry.moderatorId] ||
                    entry.moderatorId.slice(0, 8)}
                </span>
                <span className="text-xs text-slate-500">-&gt;</span>
                <span className="text-sm text-slate-300">
                  {usernames[entry.targetId] || entry.targetId.slice(0, 8)}
                </span>
                <span className="ml-auto text-xs text-slate-600">
                  {formatTime(entry.createdAt)}
                </span>
              </div>
              {entry.reason && (
                <p className="mt-1 text-xs text-slate-500">
                  Reason: {entry.reason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---- Automod Tab ----

function AutomodTab({ guildId }: { guildId: string }) {
  const [rules, setRules] = useState<{ id: string; type: string; enabled: boolean; config: string; action: string }[]>([]);
  const [blockedWords, setBlockedWords] = useState("");
  const [antiLinks, setAntiLinks] = useState(false);
  const [antiCaps, setAntiCaps] = useState(false);
  const [antiSpam, setAntiSpam] = useState(false);
  const [antiRaid, setAntiRaid] = useState(false);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    api.getAutomodRules(guildId).then((r) => {
      if (r) {
        setRules(r as typeof rules);
        const wordRule = r.find((rule) => rule.type === "blocked_words");
        if (wordRule) {
          try {
            const cfg = JSON.parse(wordRule.config as unknown as string);
            setBlockedWords((cfg.words || []).join("\n"));
          } catch { /* ignore */ }
        }
        setAntiLinks(r.some((rule) => rule.type === "anti_links" && rule.enabled));
        setAntiCaps(r.some((rule) => rule.type === "anti_caps" && rule.enabled));
        setAntiSpam(r.some((rule) => rule.type === "anti_spam" && rule.enabled));
        setAntiRaid(r.some((rule) => rule.type === "anti_raid" && rule.enabled));
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [guildId]);

  async function saveBlockedWords() {
    const words = blockedWords.split("\n").map((w) => w.trim()).filter(Boolean);
    const existing = rules.find((r) => r.type === "blocked_words");
    try {
      if (existing) {
        await api.updateAutomodRule(existing.id, { config: { words }, enabled: words.length > 0 });
      } else if (words.length > 0) {
        await api.createAutomodRule(guildId, "blocked_words", { words });
      }
      setFeedback("Saved!");
      setTimeout(() => setFeedback(""), 2000);
    } catch { setFeedback("Failed to save"); }
  }

  async function toggleRule(type: string, enabled: boolean) {
    const existing = rules.find((r) => r.type === type);
    try {
      if (existing) {
        await api.updateAutomodRule(existing.id, { enabled });
        setRules((prev) => prev.map((r) => r.type === type ? { ...r, enabled } : r));
      } else if (enabled) {
        const configs: Record<string, unknown> = {
          anti_links: { allowedDomains: [] },
          anti_caps: { maxPercent: 70, minLength: 10 },
          anti_spam: { maxMessages: 5, windowSeconds: 10, duplicateCheck: true },
          anti_raid: { maxJoinsPerMinute: 10, minAccountAgeDays: 0 },
        };
        const config = configs[type] || {};
        await api.createAutomodRule(guildId, type, config);
        // Reload
        const r = await api.getAutomodRules(guildId);
        if (r) setRules(r as typeof rules);
      }
    } catch { /* ignore */ }
  }

  if (loading) return <div className="flex justify-center py-8"><div className="h-5 w-5 animate-spin rounded-full border-2 border-dark-600 border-t-nexe-400" /></div>;

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <svg className="h-6 w-6 text-nexe-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h2 className="text-xl font-bold text-slate-100">Automod</h2>
      </div>

      <div className="space-y-5">
        {/* Word Filter */}
        <div className="rounded-lg border border-dark-700 bg-dark-800/50 p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-1">Blocked Words</h3>
          <p className="text-xs text-slate-500 mb-3">
            Messages containing these words will be blocked. One per line.
          </p>
          <textarea
            value={blockedWords}
            onChange={(e) => setBlockedWords(e.target.value)}
            rows={6}
            placeholder={"bad-word\nanother phrase"}
            className="w-full resize-none rounded-lg border border-dark-700 bg-dark-900 px-4 py-2.5 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-nexe-500 font-mono"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={saveBlockedWords}
              className="rounded-lg bg-nexe-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexe-600"
            >
              Save
            </button>
            {feedback && <span className="text-xs text-green-400">{feedback}</span>}
          </div>
        </div>

        {/* Anti-Links */}
        <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800/50 p-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Block Links</h3>
            <p className="text-xs text-slate-500 mt-0.5">Block messages containing URLs</p>
          </div>
          <button
            onClick={() => { const v = !antiLinks; setAntiLinks(v); toggleRule("anti_links", v); }}
            className={`relative h-6 w-11 rounded-full transition-colors ${antiLinks ? "bg-nexe-500" : "bg-dark-600"}`}
          >
            <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${antiLinks ? "translate-x-5.5 left-0.5" : "left-0.5"}`}
              style={{ transform: antiLinks ? "translateX(22px)" : "translateX(2px)" }}
            />
          </button>
        </div>

        {/* Anti-Caps */}
        <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800/50 p-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Block Excessive Caps</h3>
            <p className="text-xs text-slate-500 mt-0.5">Block messages with more than 70% capital letters</p>
          </div>
          <button
            onClick={() => { const v = !antiCaps; setAntiCaps(v); toggleRule("anti_caps", v); }}
            className={`relative h-6 w-11 rounded-full transition-colors ${antiCaps ? "bg-nexe-500" : "bg-dark-600"}`}
          >
            <div className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
              style={{ transform: antiCaps ? "translateX(22px)" : "translateX(2px)" }}
            />
          </button>
        </div>

        {/* Anti-Spam */}
        <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800/50 p-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Anti-Spam</h3>
            <p className="text-xs text-slate-500 mt-0.5">Block rapid message sending (5 messages / 10 seconds) and duplicate messages</p>
          </div>
          <button
            onClick={() => { const v = !antiSpam; setAntiSpam(v); toggleRule("anti_spam", v); }}
            className={`relative h-6 w-11 rounded-full transition-colors ${antiSpam ? "bg-nexe-500" : "bg-dark-600"}`}
          >
            <div className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
              style={{ transform: antiSpam ? "translateX(22px)" : "translateX(2px)" }}
            />
          </button>
        </div>

        {/* Anti-Raid */}
        <div className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-800/50 p-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Anti-Raid</h3>
            <p className="text-xs text-slate-500 mt-0.5">Block mass joins — max 10 joins per minute triggers protection</p>
          </div>
          <button
            onClick={() => { const v = !antiRaid; setAntiRaid(v); toggleRule("anti_raid", v); }}
            className={`relative h-6 w-11 rounded-full transition-colors ${antiRaid ? "bg-nexe-500" : "bg-dark-600"}`}
          >
            <div className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
              style={{ transform: antiRaid ? "translateX(22px)" : "translateX(2px)" }}
            />
          </button>
        </div>
      </div>
    </>
  );
}

// ---- Twitch Tab ----

const TWITCH_AUTO_ROLES = [
  { name: "Lead Moderator", color: "#00AD03", description: "Lead moderator on your Twitch channel" },
  { name: "Twitch Mod", color: "#2ECC71", description: "Moderator on your Twitch channel" },
  { name: "Twitch VIP", color: "#E91E63", description: "VIP on your Twitch channel" },
  { name: "Twitch Sub T3", color: "#9B59B6", description: "Tier 3 subscriber" },
  { name: "Twitch Sub T2", color: "#3498DB", description: "Tier 2 subscriber" },
  { name: "Twitch Sub T1", color: "#1ABC9C", description: "Tier 1 subscriber" },
  { name: "Twitch Follower", color: "#99AAB5", description: "Follows your Twitch channel" },
];

function TwitchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
    </svg>
  );
}

function TwitchTab({ guildId }: { guildId: string }) {
  const guild = useGuildStore((s) => s.guilds.find((g) => g.id === guildId));
  const user = useAuthStore((s) => s.user);
  const isEnabled = !!guild?.streamerTwitchId;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);

  async function handleEnable() {
    if (!user?.twitchId) {
      setFeedback({ type: "error", message: "Connect your Twitch account first in your User Settings" });
      return;
    }
    setLoading(true);
    setError("");
    setFeedback(null);
    try {
      await api.enableTwitchIntegration(guildId, user.twitchId);

      // Auto-sync ALL members' roles (runs in background on the server)
      try { await api.syncAllTwitchRoles(guildId); } catch { /* non-critical */ }

      // Reload guild data to reflect changes
      await useGuildStore.getState().loadGuilds();
      if (useGuildStore.getState().activeGuildId === guildId) {
        await useGuildStore.getState().setActiveGuild(guildId);
      }

      setFeedback({ type: "success", message: "Twitch integration enabled! Auto-roles created and your roles synced." });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable Twitch integration");
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable() {
    setLoading(true);
    setError("");
    setFeedback(null);
    try {
      await api.disableTwitchIntegration(guildId);

      await useGuildStore.getState().loadGuilds();
      if (useGuildStore.getState().activeGuildId === guildId) {
        await useGuildStore.getState().setActiveGuild(guildId);
      }

      setFeedback({ type: "success", message: "Twitch integration disabled." });
      setShowDisableConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable Twitch integration");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <TwitchIcon className="h-6 w-6 text-[#9146FF]" />
        <h2 className="text-xl font-bold text-slate-100">Twitch Integration</h2>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {feedback && (
        <div
          className={`mb-4 rounded-lg px-4 py-3 text-sm border ${
            feedback.type === "success"
              ? "bg-green-500/10 text-green-400 border-green-500/20"
              : "bg-red-500/10 text-red-400 border-red-500/20"
          }`}
        >
          {feedback.message}
        </div>
      )}

      {!isEnabled ? (
        /* State A: Not enabled */
        <div className="space-y-5">
          <div className="rounded-lg border border-dark-700 bg-dark-800/50 p-6 text-center">
            <TwitchIcon className="mx-auto mb-4 h-12 w-12 text-[#9146FF]/60" />
            <h3 className="text-lg font-semibold text-slate-200">
              Connect your Twitch channel
            </h3>
            <p className="mt-2 text-sm text-slate-400 max-w-md mx-auto">
              Enable auto-roles for your community. Subscribers, VIPs, moderators,
              and followers will automatically receive matching roles in your server.
            </p>
            <button
              onClick={handleEnable}
              disabled={loading}
              className="mt-5 inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: "#9146FF" }}
              onMouseEnter={(e) => { if (!loading) (e.currentTarget.style.backgroundColor = "#7c3aed"); }}
              onMouseLeave={(e) => { (e.currentTarget.style.backgroundColor = "#9146FF"); }}
            >
              <TwitchIcon className="h-4 w-4" />
              {loading ? "Enabling..." : "Enable Twitch Integration"}
            </button>
            {!user?.twitchId && (
              <p className="mt-3 text-xs text-yellow-400/80">
                You need to connect your Twitch account in User Settings first.
              </p>
            )}
          </div>
        </div>
      ) : (
        /* State B: Enabled */
        <div className="space-y-5">
          {/* Status header */}
          <div className="flex items-center gap-3 rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/20">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-green-400 fill-current">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-green-400">Twitch Integration Active</p>
              <p className="text-xs text-slate-500">
                Connected to channel ID: {guild?.streamerTwitchId}
              </p>
            </div>
          </div>

          {/* Auto-roles list */}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
              Auto-Roles
            </h3>
            <div className="space-y-1.5">
              {TWITCH_AUTO_ROLES.map((role) => (
                <div
                  key={role.name}
                  className="flex items-center gap-3 rounded-lg bg-dark-800/50 px-4 py-2.5"
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: role.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200">{role.name}</p>
                    <p className="text-xs text-slate-500">{role.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Chat Bridge */}
          <BridgeSection guildId={guildId} />

          {/* Info note */}
          <div className="rounded-lg border border-dark-700 bg-dark-800/50 px-4 py-3">
            <p className="text-xs text-slate-400">
              Roles are assigned automatically when members connect their Twitch account.
              Members must have their Twitch linked in their User Settings to receive auto-roles.
            </p>
          </div>

          {/* Disable integration */}
          <div className="mt-6 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
            <h3 className="text-sm font-semibold text-slate-200">Disable Integration</h3>
            <p className="mt-1 text-xs text-slate-500">
              This will remove all Twitch auto-roles from this server.
            </p>
            {!showDisableConfirm ? (
              <button
                onClick={() => setShowDisableConfirm(true)}
                className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
              >
                Disable Twitch Integration
              </button>
            ) : (
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => setShowDisableConfirm(false)}
                  className="rounded-lg bg-dark-800 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-dark-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDisable}
                  disabled={loading}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "Disabling..." : "Yes, Disable"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---- Chat Bridge Section ----

function BridgeSection({ guildId }: { guildId: string }) {
  const guild = useGuildStore((s) => s.guilds.find((g) => g.id === guildId));
  const allChannels = useGuildStore((s) => s.channels);
  const channels = allChannels[guildId] ?? [];
  const textChannels = channels.filter((c) => c.type === "text");
  const hasBridge = !!guild?.bridgeChannelId;
  const bridgeChannel = channels.find((c) => c.id === guild?.bridgeChannelId);

  const [selectedChannel, setSelectedChannel] = useState(guild?.bridgeChannelId || "");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function handleSetBridge() {
    if (!selectedChannel) return;
    setLoading(true);
    setFeedback("");
    try {
      await api.setBridgeChannel(guildId, selectedChannel);
      await useGuildStore.getState().loadGuilds();
      setFeedback("Chat bridge enabled!");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Failed to set bridge");
    } finally {
      setLoading(false);
    }
  }

  async function handleClearBridge() {
    setLoading(true);
    setFeedback("");
    try {
      await api.clearBridgeChannel(guildId);
      await useGuildStore.getState().loadGuilds();
      setSelectedChannel("");
      setFeedback("Chat bridge disabled.");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Failed to clear bridge");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
        Chat Bridge
      </h3>
      <div className="rounded-lg border border-dark-700 bg-dark-800/50 p-4">
        <p className="mb-3 text-xs text-slate-400">
          Bridge a text channel with your Twitch chat. Messages from Twitch viewers appear in the channel, and messages from Nexe users are sent to Twitch.
        </p>

        {hasBridge ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-[#9146FF]/10 border border-[#9146FF]/20 px-3 py-2">
              <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white" style={{ backgroundColor: "#9146FF" }}>
                TWITCH
              </span>
              <span className="text-sm text-slate-200">
                #{bridgeChannel?.name || "unknown"}
              </span>
              <svg viewBox="0 0 24 24" className="ml-1 h-4 w-4 text-green-400 fill-current">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </div>
            <button
              onClick={handleClearBridge}
              disabled={loading}
              className="rounded-lg bg-dark-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-dark-600 disabled:opacity-50"
            >
              {loading ? "Disabling..." : "Disable Bridge"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <select
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value)}
              className="w-full rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-[#9146FF]"
            >
              <option value="">Select a channel...</option>
              {textChannels.map((ch) => (
                <option key={ch.id} value={ch.id}>#{ch.name}</option>
              ))}
            </select>
            <button
              onClick={handleSetBridge}
              disabled={loading || !selectedChannel}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: "#9146FF" }}
            >
              {loading ? "Enabling..." : "Enable Chat Bridge"}
            </button>
          </div>
        )}

        {feedback && (
          <p className="mt-2 text-xs text-slate-400">{feedback}</p>
        )}
      </div>
    </div>
  );
}

// ---- Danger Zone Tab ----

function DangerZoneTab({ guildId, onClose }: { guildId: string; onClose: () => void }) {
  const guild = useGuildStore((s) => s.guilds.find((g) => g.id === guildId));
  const user = useAuthStore((s) => s.user);
  const deleteGuildStore = useGuildStore((s) => s.deleteGuild);
  const leaveGuildStore = useGuildStore((s) => s.leaveGuild);

  const isOwner = guild?.ownerId === user?.id;
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleAction() {
    setLoading(true);
    setError("");
    try {
      if (isOwner) {
        await deleteGuildStore(guildId);
      } else {
        await leaveGuildStore(guildId);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
      setLoading(false);
    }
  }

  const actionLabel = isOwner ? "Delete Server" : "Leave Server";
  const confirmRequired = isOwner ? guild?.name ?? "" : "";

  return (
    <>
      <h2 className="mb-6 text-xl font-bold text-red-400">Danger Zone</h2>
      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
          {error}
        </div>
      )}
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-5">
        <h3 className="text-sm font-semibold text-slate-200">{actionLabel}</h3>
        <p className="mt-1 text-sm text-slate-400">
          {isOwner
            ? "Permanently delete this server and all its data. This action cannot be undone."
            : "Leave this server. You will lose access to all channels and messages."}
        </p>

        {!showConfirm ? (
          <button
            onClick={() => setShowConfirm(true)}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
          >
            {actionLabel}
          </button>
        ) : (
          <div className="mt-4 space-y-3">
            {isOwner && (
              <div>
                <label className="mb-1.5 block text-xs text-slate-400">
                  Type <span className="font-semibold text-slate-200">{guild?.name}</span> to confirm
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="w-full rounded-lg border border-dark-700 bg-dark-900 px-4 py-2 text-sm text-slate-200 outline-none focus:border-red-500"
                  autoFocus
                />
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowConfirm(false);
                  setConfirmText("");
                }}
                className="rounded-lg bg-dark-800 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-dark-700"
              >
                Cancel
              </button>
              <button
                onClick={handleAction}
                disabled={loading || (isOwner && confirmText !== confirmRequired)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Processing..." : `Yes, ${actionLabel}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
