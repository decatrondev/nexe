import { create } from "zustand";
import { api, type User } from "../lib/api";

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string,
  ) => Promise<{ userId: string; email: string }>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  logout: () => void;
  loadFromStorage: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  refreshToken: null,
  isAuthenticated: false,

  async login(email: string, password: string) {
    const res = await api.login(email, password);
    api.setToken(res.accessToken);
    localStorage.setItem("token", res.accessToken);
    localStorage.setItem("refreshToken", res.refreshToken);
    localStorage.setItem("user", JSON.stringify(res.user));
    set({
      user: res.user,
      token: res.accessToken,
      refreshToken: res.refreshToken,
      isAuthenticated: true,
    });
  },

  async register(username: string, email: string, password: string) {
    const res = await api.register(username, email, password);
    return { userId: res.userId, email: res.email };
  },

  async verifyEmail(email: string, code: string) {
    await api.verifyEmail(email, code);
  },

  logout() {
    api.setToken(null);
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
    set({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  },

  loadFromStorage() {
    const token = localStorage.getItem("token");
    const refreshToken = localStorage.getItem("refreshToken");
    const userJson = localStorage.getItem("user");

    if (token && userJson) {
      try {
        const user = JSON.parse(userJson) as User;
        api.setToken(token);
        set({
          user,
          token,
          refreshToken,
          isAuthenticated: true,
        });
      } catch {
        // corrupted data, clear it
        localStorage.removeItem("token");
        localStorage.removeItem("refreshToken");
        localStorage.removeItem("user");
      }
    }
  },
}));
