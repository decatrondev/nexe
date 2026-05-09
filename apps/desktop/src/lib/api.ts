const API_URL = import.meta.env.DEV
  ? "http://161.132.53.175:8090"
  : "https://api.nexe.decatron.net";

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

interface ApiResponse<T> {
  data?: T;
  error?: string;
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
    const err = (await res.json().catch(() => ({}))) as ApiResponse<unknown>;
    throw new Error(err.error || `Request failed: ${res.status}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
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

  getGuilds() {
    return request<unknown[]>("GET", "/guilds/me");
  },
};
