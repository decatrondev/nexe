const API_URL = import.meta.env.DEV
  ? "http://161.132.53.175:8090"
  : "https://nexeapi.decatron.net";

let accessToken: string | null = null;

function setToken(token: string | null) {
  accessToken = token;
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

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: headers(extraHeaders),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as ApiErrorResponse;

    // Auto-logout on 401 (expired/invalid token)
    if (res.status === 401 && path !== "/auth/login" && path !== "/users/@me") {
      accessToken = null;
      localStorage.removeItem("token");
      localStorage.removeItem("refreshToken");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }

    throw new Error(err.error?.message || `Request failed: ${res.status}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const json = await res.json();
  // Unwrap {data: T} envelope if present
  if (json && typeof json === "object" && "data" in json) {
    return json.data as T;
  }
  return json as T;
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
  status?: "online" | "idle" | "dnd" | "offline";
}

export interface UserProfile {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  status?: "online" | "idle" | "dnd" | "offline";
}

export interface UpdateProfileData {
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  status?: "online" | "idle" | "dnd" | "offline";
}

// ---- Guild types ----

export interface Guild {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  ownerId: string;
  isStreamerServer: boolean;
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

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  type: string;
  replyToId?: string;
  editedAt?: string;
  deleted: boolean;
  pinned: boolean;
  createdAt: string;
}

export interface GuildMember {
  id: string;
  guildId: string;
  userId: string;
  nickname?: string;
  joinedAt: string;
  muted: boolean;
}

export interface Role {
  id: string;
  guildId: string;
  name: string;
  color?: string;
  position: number;
  permissions: number;
  isDefault: boolean;
}

export interface Invite {
  id: string;
  guildId: string;
  channelId: string;
  code: string;
}

// ---- API client ----

export const api = {
  setToken,

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

  login(email: string, password: string) {
    return request<LoginResponse>("POST", "/auth/login", { email, password });
  },

  refresh(refreshToken: string) {
    return request<RefreshResponse>("POST", "/auth/refresh", { refreshToken });
  },

  getMe() {
    return request<User>("GET", "/users/@me");
  },

  getProfile(userId: string) {
    return request<UserProfile>("GET", `/users/${userId}/profile`);
  },

  updateProfile(data: UpdateProfileData) {
    return request<UserProfile>("PATCH", "/users/@me/profile", data);
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

  createChannel(guildId: string, name: string, type: string) {
    return request<Channel>("POST", `/guilds/${guildId}/channels`, {
      name,
      type,
    });
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

  editMessage(messageId: string, content: string) {
    return request<Message>("PATCH", `/messages/${messageId}`, { content });
  },

  deleteMessage(messageId: string) {
    return request<void>("DELETE", `/messages/${messageId}`);
  },

  createInvite(guildId: string, channelId: string) {
    return request<Invite>("POST", `/guilds/${guildId}/invites`, { channelId });
  },

  joinGuild(guildId: string) {
    return request<void>("POST", `/guilds/${guildId}/join`);
  },
};
