import { create } from "zustand";
import { api, type User } from "../lib/api";
import { useGuildStore } from "./guild";

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  authLoading: boolean; // true until loadFromStorage finishes
  login: (email: string, password: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string,
  ) => Promise<{ userId: string; email: string }>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  logout: () => void;
  loadFromStorage: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  refreshToken: null,
  isAuthenticated: false,
  authLoading: true, // starts true — don't render routes until checked

  async login(email: string, password: string) {
    const res = await api.login(email, password);
    api.setToken(res.accessToken);
    api.setRefreshToken(res.refreshToken);
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
    api.setRefreshToken(null);
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
    useGuildStore.getState().reset();
    set({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  },

  async loadFromStorage() {
    const token = localStorage.getItem("token");
    const rt = localStorage.getItem("refreshToken");
    const userJson = localStorage.getItem("user");

    if (token && userJson) {
      try {
        const user = JSON.parse(userJson) as User;
        api.setToken(token);
        if (rt) api.setRefreshToken(rt);

        const me = await api.getMe();

        set({
          user: me ?? user,
          token: localStorage.getItem("token") ?? token,
          refreshToken: localStorage.getItem("refreshToken") ?? rt,
          isAuthenticated: true,
          authLoading: false,
        });
      } catch {
        api.setToken(null);
        api.setRefreshToken(null);
        localStorage.removeItem("token");
        localStorage.removeItem("refreshToken");
        localStorage.removeItem("user");
        set({
          user: null,
          token: null,
          refreshToken: null,
          isAuthenticated: false,
          authLoading: false,
        });
      }
    } else {
      set({ authLoading: false });
    }
  },
}));
