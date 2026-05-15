const API_URL =
  typeof window !== "undefined" &&
  (window.location.protocol === "https:" || "__TAURI__" in window || "__TAURI_INTERNALS__" in window || window.location.hostname === "tauri.localhost")
    ? "https://nexeapi.decatron.net"
    : "http://161.132.53.175:8090";

const REQUEST_TIMEOUT = 15_000; // 15 seconds

let accessToken: string | null = null;
let refreshToken: string | null = null;
let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

function setToken(token: string | null) {
  accessToken = token;
}

function setRefreshToken(token: string | null) {
  refreshToken = token;
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    ...extra,
  };
  if (accessToken) {
    h["Authorization"] = `Bearer ${accessToken}`;
  }
  return h;
}

interface ApiErrorResponse {
  error?: { code: string; message: string };
}

async function tryRefreshToken(): Promise<boolean> {
  if (!refreshToken) return false;

  // Deduplicate concurrent refresh attempts
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) return false;

      const json = await res.json();
      const data = json?.data ?? json;
      if (data?.accessToken && data?.refreshToken) {
        accessToken = data.accessToken;
        refreshToken = data.refreshToken;
        localStorage.setItem("token", data.accessToken);
        localStorage.setItem("refreshToken", data.refreshToken);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function clearAuth() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("user");
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const maxRetries = method === "GET" ? 3 : 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers: headers(extraHeaders),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === "AbortError") {
        lastError = new Error("Request timed out");
      } else {
        lastError = new Error("Network error — check your connection");
      }
      continue; // retry
    } finally {
      clearTimeout(timeout);
    }

    // Handle 401 — try refresh before giving up
    if (res.status === 401 && path !== "/auth/login" && path !== "/auth/refresh" && accessToken) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        return request<T>(method, path, body, extraHeaders);
      }
      clearAuth();
      throw new Error("Session expired — please log in again");
    }

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as ApiErrorResponse;
      throw new Error(err.error?.message || `Request failed (${res.status})`);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const json = await res.json();
    if (json && typeof json === "object" && "data" in json) {
      return json.data as T;
    }
    return json as T;
  }

  // All retries exhausted
  throw lastError ?? new Error("Request failed");
}

// ---- Auth types ----

export interface RegisterResponse {
  userId: string;
  email: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  status?: "online" | "idle" | "dnd" | "offline" | "invisible";
  tier?: string;
  twitchId?: string;
  twitchLogin?: string;
  totpEnabled?: boolean;
}

export interface StreamStatus {
  live: boolean;
  linked: boolean;
  title?: string;
  game?: string;
  viewers?: number;
  startedAt?: string;
  thumbnail?: string;
}

export interface SocialLink {
  platform: string;
  url: string;
  verified?: boolean;
}

export interface UserProfile {
  userId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  bio?: string;
  accentColor?: string;
  level: number;
  totalXp: number;
  socialLinks: SocialLink[];
  createdAt: string;
  updatedAt: string;
  status?: "online" | "idle" | "dnd" | "offline" | "invisible";
  twitchId?: string;
  twitchLogin?: string;
}

export interface UpdateProfileData {
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  accentColor?: string;
  status?: "online" | "idle" | "dnd" | "offline" | "invisible";
  socialLinks?: SocialLink[];
}

export interface UserBadge {
  id: string;
  name: string;
  description?: string;
  iconUrl: string;
  type: string;
  guildId?: string;
  tierRequired: string;
  createdAt: string;
  displayed: boolean;
  displayOrder: number;
  earnedAt: string;
}

// ---- Guild types ----

export interface Guild {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  ownerId: string;
  isStreamerServer: boolean;
  streamerTwitchId?: string;
  bridgeChannelId?: string;
  systemChannelId?: string;
  accentColor?: string;
  memberCount: number;
  createdAt: string;
}

export interface Channel {
  id: string;
  guildId: string;
  categoryId?: string;
  name: string;
  topic?: string;
  type: string;
  position: number;
  slowmodeSeconds: number;
  isSubOnly: boolean;
  isLiveChannel: boolean;
}

export interface ThreadInfo {
  replyCount: number;
  lastReplyAt?: string;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  type: string;
  replyToId?: string;
  threadId?: string;
  thread?: ThreadInfo;
  editedAt?: string;
  deleted: boolean;
  pinned: boolean;
  createdAt: string;
  bridgeSource?: string;
  bridgeAuthor?: string;
  bridgeAuthorId?: string;
}

export interface GuildMember {
  id: string;
  guildId: string;
  userId: string;
  nickname?: string;
  roleIds: string[];
  joinedAt: string;
  muted: boolean;
  avatarUrl?: string;
  displayName?: string;
  username?: string;
}

export interface Role {
  id: string;
  guildId: string;
  name: string;
  color?: string;
  position: number;
  permissions: number;
  mentionable: boolean;
  hoisted: boolean;
  isDefault: boolean;
  isAuto?: boolean;
  autoSource?: string;
}

export interface Category {
  id: string;
  guildId: string;
  name: string;
  position: number;
  createdAt: string;
}

export interface Invite {
  code: string;
  guildId: string;
  channelId: string;
  inviterId: string;
  maxUses?: number;
  uses?: number;
  expiresAt?: string;
  createdAt: string;
}

export interface Ban {
  userId: string;
  reason?: string;
  bannedAt: string;
}

export interface AuditLogEntry {
  id: string;
  guildId: string;
  moderatorId: string;
  targetId: string;
  action: string;
  reason?: string;
  createdAt: string;
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  users: string[];
}

export interface AppNotification {
  id: string;
  userId: string;
  type: string;
  guildId: string;
  channelId: string;
  messageId?: string;
  authorId?: string;
  content: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationPreference {
  userId: string;
  guildId: string;
  channelId?: string;
  level: "all" | "mentions" | "nothing";
}

export interface VoiceState {
  userId: string;
  guildId: string;
  channelId: string;
  muted: boolean;
  deafened: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
  speaking: boolean;
}

export interface VoiceJoinResponse {
  token: string;
  url: string;
  participants: VoiceState[];
}

// ---- API client ----

export const api = {
  setToken,
  setRefreshToken,

  register(username: string, email: string, password: string) {
    return request<RegisterResponse>("POST", "/auth/register", {
      username,
      email,
      password,
    });
  },

  verifyEmail(email: string, code: string) {
    return request<void>("POST", "/auth/verify-email", { email, code });
  },

  resendVerification(email: string) {
    return request<void>("POST", "/auth/resend-verification", { email });
  },

  forgotPassword(email: string) {
    return request<{ message: string }>("POST", "/auth/forgot-password", { email });
  },

  resetPassword(email: string, code: string, newPassword: string) {
    return request<{ message: string }>("POST", "/auth/reset-password", { email, code, newPassword });
  },

  login(email: string, password: string) {
    return request<LoginResponse>("POST", "/auth/login", { email, password });
  },

  refresh(rt: string) {
    return request<RefreshResponse>("POST", "/auth/refresh", { refreshToken: rt });
  },

  getMe() {
    return request<User>("GET", "/users/@me");
  },

  getProfile(userId: string) {
    return request<UserProfile>("GET", `/users/${userId}/profile`);
  },

  getTwitchClip(clipId: string) {
    return request<Record<string, unknown>>("GET", `/twitch/clip/${clipId}`);
  },

  getTwitchClips(broadcasterId: string) {
    return request<{ title: string; thumbnail_url: string; url: string; view_count: number; creator_name: string; video_url?: string }[]>("GET", `/twitch/clips/${broadcasterId}`);
  },

  updateProfile(data: UpdateProfileData) {
    return request<UserProfile>("PATCH", "/users/@me/profile", data);
  },

  async uploadAvatar(file: File): Promise<{ url: string }> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_URL}/users/@me/avatar`, {
      method: "POST",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      body: form,
    });
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  },

  async uploadBanner(file: File): Promise<{ url: string }> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_URL}/users/@me/banner`, {
      method: "POST",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      body: form,
    });
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  },

  async uploadAttachment(file: File): Promise<{ url: string; filename: string; size: number }> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_URL}/upload/attachment`, {
      method: "POST",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      body: form,
    });
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  },

  getGuildEmotes(guildId: string) {
    return request<{
      twitch: { name: string; url: string; animated?: boolean; source: string }[];
      seventv: { name: string; url: string; animated?: boolean; source: string }[];
      bttv: { name: string; url: string; animated?: boolean; source: string }[];
      ffz: { name: string; url: string; animated?: boolean; source: string }[];
      twitchGlobal: { name: string; url: string; animated?: boolean; source: string }[];
      seventvGlobal: { name: string; url: string; animated?: boolean; source: string }[];
      bttvGlobal: { name: string; url: string; animated?: boolean; source: string }[];
    }>("GET", `/guilds/${guildId}/emotes`);
  },

  deleteAvatar() {
    return request<void>("DELETE", "/users/@me/avatar");
  },

  deleteBanner() {
    return request<void>("DELETE", "/users/@me/banner");
  },

  // ---- 2FA TOTP ----

  enable2FA() {
    return request<{ secret: string; uri: string }>("POST", "/auth/2fa/enable");
  },

  verify2FA(code: string) {
    return request<{ enabled: boolean; recoveryCodes: string[] }>("POST", "/auth/2fa/verify", { code });
  },

  disable2FA(code: string) {
    return request<{ disabled: boolean }>("POST", "/auth/2fa/disable", { code });
  },

  login2FA(email: string, password: string, code: string) {
    return request<{ accessToken: string; refreshToken: string; user: unknown }>("POST", "/auth/2fa/login", { email, password, code });
  },

  recover2FA(email: string, password: string, recoveryCode: string) {
    return request<{ accessToken: string; refreshToken: string; user: unknown }>("POST", "/auth/2fa/recover", { email, password, recoveryCode });
  },

  updatePresence(status: string, clearAfter?: number) {
    const body: Record<string, unknown> = { status };
    if (clearAfter) body.clearAfter = clearAfter;
    return request<void>("PATCH", "/users/@me/presence", body);
  },

  presenceHeartbeat() {
    return request<void>("POST", "/users/@me/heartbeat");
  },

  getBulkPresence(userIds: string[]) {
    return request<{
      userId: string;
      status: string;
      streamingLive?: boolean;
      streamTitle?: string;
      streamGame?: string;
      streamViewers?: number;
      streamStartedAt?: string;
      streamThumbnail?: string;
    }[]>("POST", "/users/bulk-presence", { userIds });
  },

  getThreadMessages(messageId: string, limit?: number, before?: string) {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (before) params.set("before", before);
    const qs = params.toString();
    return request<Message[]>("GET", `/messages/${messageId}/thread${qs ? `?${qs}` : ""}`);
  },

  sendThreadMessage(messageId: string, content: string) {
    return request<Message>("POST", `/messages/${messageId}/thread`, { content });
  },

  getActivity(userId: string, limit = 20) {
    return request<{ id: string; type: string; data: Record<string, unknown>; createdAt: string }[]>("GET", `/users/${userId}/activity?limit=${limit}`);
  },

  getLiveGuilds(guildIds: string[]) {
    return request<{ guildIds: string[] }>("POST", "/guilds/live", { guildIds });
  },

  getBadges(userId: string) {
    return request<UserBadge[]>("GET", `/users/${userId}/badges`);
  },

  // ---- Guild methods ----

  getMyGuilds() {
    return request<Guild[]>("GET", "/guilds/me");
  },

  createGuild(name: string, description: string, isStreamerServer: boolean) {
    return request<Guild>("POST", "/guilds", {
      name,
      description,
      isStreamerServer,
    });
  },

  getGuild(id: string) {
    return request<Guild>("GET", `/guilds/${id}`);
  },

  getChannels(guildId: string) {
    return request<Channel[]>("GET", `/guilds/${guildId}/channels`);
  },

  createChannel(guildId: string, name: string, type: string, categoryId?: string) {
    const body: Record<string, unknown> = { name, type };
    if (categoryId) body.categoryId = categoryId;
    return request<Channel>("POST", `/guilds/${guildId}/channels`, body);
  },

  getRoles(guildId: string) {
    return request<Role[]>("GET", `/guilds/${guildId}/roles`);
  },

  getMembers(guildId: string, limit?: number) {
    const params = limit ? `?limit=${limit}` : "";
    return request<GuildMember[]>("GET", `/guilds/${guildId}/members${params}`);
  },

  getMessages(channelId: string, limit?: number, before?: string) {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (before) params.set("before", before);
    const qs = params.toString();
    return request<Message[]>(
      "GET",
      `/channels/${channelId}/messages${qs ? `?${qs}` : ""}`,
    );
  },

  sendMessage(channelId: string, content: string) {
    return request<Message>("POST", `/channels/${channelId}/messages`, {
      content,
    });
  },

  sendMessageWithReply(channelId: string, content: string, replyToId: string) {
    return request<Message>("POST", `/channels/${channelId}/messages`, {
      content,
      replyToId,
    });
  },

  editMessage(messageId: string, content: string) {
    return request<Message>("PATCH", `/messages/${messageId}`, { content });
  },

  getEditHistory(messageId: string) {
    return request<{ id: string; messageId: string; oldContent: string; editedAt: string }[]>("GET", `/messages/${messageId}/edits`);
  },

  deleteMessage(messageId: string) {
    return request<void>("DELETE", `/messages/${messageId}`);
  },

  createInvite(guildId: string, channelId: string, maxAge?: number, maxUses?: number) {
    const body: Record<string, unknown> = { channelId };
    if (maxAge) body.maxAge = maxAge;
    if (maxUses) body.maxUses = maxUses;
    return request<Invite>("POST", `/guilds/${guildId}/invites`, body);
  },

  joinGuild(guildId: string) {
    return request<void>("POST", `/guilds/${guildId}/join`);
  },

  joinByInvite(code: string) {
    return request<void>("POST", `/invites/${code}/use`);
  },

  updateGuild(id: string, data: { name?: string; description?: string; systemChannelId?: string | null; accentColor?: string | null }) {
    return request<Guild>("PATCH", `/guilds/${id}`, data);
  },

  deleteGuild(id: string) {
    return request<void>("DELETE", `/guilds/${id}`);
  },

  updateChannel(id: string, data: { name?: string; topic?: string; slowmodeSeconds?: number; categoryId?: string | null }) {
    return request<Channel>("PATCH", `/channels/${id}`, data);
  },

  reorderChannels(guildId: string, channelIds: string[]) {
    return request<void>("PUT", `/guilds/${guildId}/channels/reorder`, { channelIds });
  },

  deleteChannel(id: string) {
    return request<void>("DELETE", `/channels/${id}`);
  },

  leaveGuild(id: string) {
    return request<void>("DELETE", `/guilds/${id}/members/@me`);
  },

  // ---- Role methods ----

  createRole(guildId: string, data: { name: string; color?: string; permissions?: number }) {
    return request<Role>("POST", `/guilds/${guildId}/roles`, data);
  },

  updateRole(roleId: string, data: { guildId: string; name?: string; color?: string; position?: number; permissions?: number; hoisted?: boolean; mentionable?: boolean }) {
    return request<Role>("PATCH", `/roles/${roleId}`, data);
  },

  deleteRole(roleId: string) {
    return request<void>("DELETE", `/roles/${roleId}`);
  },

  assignRole(guildId: string, userId: string, roleId: string) {
    return request<void>("PUT", `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  },

  removeRole(guildId: string, userId: string, roleId: string) {
    return request<void>("DELETE", `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  },

  // ---- Moderation methods ----

  banMember(guildId: string, targetId: string, reason?: string) {
    return request<void>("POST", `/guilds/${guildId}/bans`, { targetId, reason });
  },

  unbanMember(guildId: string, userId: string) {
    return request<void>("DELETE", `/guilds/${guildId}/bans/${userId}`);
  },

  listBans(guildId: string) {
    return request<Ban[]>("GET", `/guilds/${guildId}/bans`);
  },

  kickMember(guildId: string, userId: string) {
    return request<void>("DELETE", `/guilds/${guildId}/members/${userId}`);
  },

  timeoutMember(guildId: string, userId: string, duration: number, reason?: string) {
    return request<void>("POST", `/guilds/${guildId}/members/${userId}/timeout`, { duration, reason });
  },

  getAuditLog(guildId: string) {
    return request<AuditLogEntry[]>("GET", `/guilds/${guildId}/audit-log`);
  },

  warnMember(guildId: string, userId: string, reason: string) {
    return request<void>("POST", `/guilds/${guildId}/members/${userId}/warn`, { reason });
  },

  // ---- Twitch integration methods ----

  enableTwitchIntegration(guildId: string, twitchId: string) {
    return request<{ roles: Role[] }>("POST", `/guilds/${guildId}/twitch/enable`, { twitchId });
  },

  disableTwitchIntegration(guildId: string) {
    return request<void>("POST", `/guilds/${guildId}/twitch/disable`);
  },

  syncTwitchRoles(guildId: string) {
    return request<{ status: any; assigned: string[]; removed: string[]; errors: string[] }>("POST", `/guilds/${guildId}/twitch/sync`);
  },

  syncAllTwitchRoles(guildId: string) {
    return request<{ message: string }>("POST", `/guilds/${guildId}/twitch/sync-all`);
  },

  // ---- Link unfurl ----

  unfurl(url: string) {
    return request<{ url: string; title?: string; description?: string; image?: string; siteName?: string; favicon?: string }>("GET", `/unfurl?url=${encodeURIComponent(url)}`);
  },

  // ---- Twitch auth methods ----

  registerWithTwitch(
    username: string,
    email: string,
    password: string,
    twitchId: string,
    twitchLogin: string,
    twitchDisplayName: string,
    twitchEmail: string,
    twitchAvatar: string,
  ) {
    return request<RegisterResponse>("POST", "/auth/register", {
      username,
      email,
      password,
      twitchId,
      twitchLogin,
      twitchDisplayName,
      twitchEmail,
      twitchAvatar,
    });
  },

  unlinkTwitch() {
    return request<void>("DELETE", "/auth/twitch/link");
  },

  getStreamStatus(userId: string) {
    return request<StreamStatus>("GET", `/users/${userId}/stream`);
  },

  // ---- Reaction methods ----

  addReaction(messageId: string, emoji: string) {
    return request<void>("PUT", `/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`);
  },

  removeReaction(messageId: string, emoji: string) {
    return request<void>("DELETE", `/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`);
  },

  getReactions(messageId: string) {
    return request<ReactionGroup[]>("GET", `/messages/${messageId}/reactions`);
  },

  // ---- Pin methods ----

  pinMessage(messageId: string) {
    return request<void>("PUT", `/messages/${messageId}/pin`);
  },

  unpinMessage(messageId: string) {
    return request<void>("DELETE", `/messages/${messageId}/pin`);
  },

  getPinnedMessages(channelId: string) {
    return request<Message[]>("GET", `/channels/${channelId}/pins`);
  },

  // ---- Search methods ----

  searchMessages(channelId: string, query: string, opts?: { limit?: number; author?: string; before?: string; after?: string }) {
    const params = new URLSearchParams({ q: query });
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.author) params.set("author", opts.author);
    if (opts?.before) params.set("before", opts.before);
    if (opts?.after) params.set("after", opts.after);
    return request<Message[]>("GET", `/channels/${channelId}/search?${params}`);
  },

  // ---- Notification methods ----

  getNotifications(unreadOnly?: boolean) {
    const params = unreadOnly ? "?unread=true" : "";
    return request<AppNotification[]>("GET", `/notifications${params}`);
  },

  getUnreadCount() {
    return request<{ count: number }>("GET", "/notifications/unread-count");
  },

  markNotificationRead(id: string) {
    return request<void>("POST", `/notifications/${id}/read`);
  },

  markAllNotificationsRead() {
    return request<void>("POST", "/notifications/read-all");
  },

  deleteNotification(id: string) {
    return request<void>("DELETE", `/notifications/${id}`);
  },

  getNotificationPreference(guildId: string) {
    return request<NotificationPreference>("GET", `/notifications/preferences/${guildId}`);
  },

  setNotificationPreference(guildId: string, level: string, channelId?: string) {
    return request<NotificationPreference>("PUT", `/notifications/preferences/${guildId}`, { level, channelId });
  },

  // ---- Unread methods ----

  ackChannel(channelId: string, messageId?: string) {
    return request<void>("POST", `/channels/${channelId}/ack`, messageId ? { messageId } : {});
  },

  getUnreadChannels() {
    return request<{ channelId: string; unreadCount: number; lastReadId: string }[]>("GET", "/users/@me/unread");
  },

  // ---- Channel overrides ----

  getChannelOverrides(channelId: string) {
    return request<{ id: string; channelId: string; targetId: string; targetType: string; allow: number; deny: number }[]>("GET", `/channels/${channelId}/overrides`);
  },

  upsertChannelOverride(channelId: string, targetId: string, targetType: string, allow: number, deny: number) {
    return request<unknown>("PUT", `/channels/${channelId}/overrides`, { targetId, targetType, allow, deny });
  },

  deleteChannelOverride(overrideId: string) {
    return request<void>("DELETE", `/overrides/${overrideId}`);
  },

  // ---- Automod methods ----

  getAutomodRules(guildId: string) {
    return request<{ id: string; type: string; enabled: boolean; config: unknown; action: string }[]>("GET", `/guilds/${guildId}/automod`);
  },

  createAutomodRule(guildId: string, type: string, config: unknown, action?: string) {
    return request<unknown>("POST", `/guilds/${guildId}/automod`, { type, config, action: action || "block", enabled: true });
  },

  updateAutomodRule(ruleId: string, data: { enabled?: boolean; config?: unknown; action?: string }) {
    const body: Record<string, unknown> = {};
    if (data.enabled !== undefined) body.enabled = data.enabled;
    if (data.config !== undefined) body.config = data.config;
    if (data.action) body.action = data.action;
    return request<void>("PATCH", `/automod/${ruleId}`, body);
  },

  deleteAutomodRule(ruleId: string) {
    return request<void>("DELETE", `/automod/${ruleId}`);
  },

  // ---- Bridge methods ----

  setBridgeChannel(guildId: string, channelId: string) {
    return request<void>("POST", `/guilds/${guildId}/bridge`, { channelId });
  },

  clearBridgeChannel(guildId: string) {
    return request<void>("DELETE", `/guilds/${guildId}/bridge`);
  },

  sendToBridge(guildId: string, channelId: string, message: string, username: string) {
    return request<void>("POST", "/twitch/bridge/send", { guildId, channelId, message, username });
  },

  // ---- Voice methods ----

  joinVoice(guildId: string, channelId: string) {
    return request<VoiceJoinResponse>("POST", "/voice/join", { guildId, channelId });
  },

  leaveVoice() {
    return request<void>("POST", "/voice/leave");
  },

  updateVoiceState(selfMute?: boolean, selfDeaf?: boolean) {
    return request<VoiceState>("PATCH", "/voice/state", { selfMute, selfDeaf });
  },

  getMyVoiceState() {
    return request<VoiceState | null>("GET", "/voice/state/@me");
  },

  getVoiceParticipants(channelId: string, guildId?: string) {
    const params = guildId ? `?guildId=${guildId}` : "";
    return request<VoiceState[]>("GET", `/voice/channel/${channelId}/participants${params}`);
  },

  getGuildVoiceStates(guildId: string) {
    return request<VoiceState[]>("GET", `/voice/guild/${guildId}/states`);
  },

  // ---- Category methods ----

  getCategories(guildId: string) {
    return request<Category[]>("GET", `/guilds/${guildId}/categories`);
  },

  createCategory(guildId: string, name: string) {
    return request<Category>("POST", `/guilds/${guildId}/categories`, { name });
  },

  updateCategory(categoryId: string, name: string) {
    return request<Category>("PATCH", `/categories/${categoryId}`, { name });
  },

  deleteCategory(categoryId: string) {
    return request<void>("DELETE", `/categories/${categoryId}`);
  },

  reorderCategories(guildId: string, categoryIds: string[]) {
    return request<void>("PUT", `/guilds/${guildId}/categories/reorder`, { categoryIds });
  },
};
