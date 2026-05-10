import { create } from "zustand";
import {
  api,
  type Guild,
  type Channel,
  type GuildMember,
  type Message,
  type Role,
} from "../lib/api";

interface GuildState {
  guilds: Guild[];
  activeGuildId: string | null;
  activeChannelId: string | null;
  channels: Record<string, Channel[]>;
  members: Record<string, GuildMember[]>;
  roles: Record<string, Role[]>;
  memberRoles: Record<string, string[]>;
  messages: Record<string, Message[]>;
  usernames: Record<string, string>;
  presenceMap: Record<string, string>; // userId → status (online/idle/dnd/offline)
  loading: boolean;
  loadingGuilds: boolean;
  hasMoreMessages: Record<string, boolean>;
  error: string | null;

  loadGuilds: () => Promise<void>;
  setActiveGuild: (guildId: string) => Promise<void>;
  setActiveChannel: (channelId: string) => Promise<void>;
  createGuild: (
    name: string,
    description: string,
    isStreamerServer: boolean,
  ) => Promise<void>;
  updateGuild: (guildId: string, data: { name?: string; description?: string }) => Promise<void>;
  deleteGuild: (guildId: string) => Promise<void>;
  leaveGuild: (guildId: string) => Promise<void>;
  createChannel: (name: string, type: string) => Promise<void>;
  updateChannel: (channelId: string, data: { name?: string; topic?: string; slowmodeSeconds?: number }) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;
  sendMessage: (content: string, replyToId?: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  createRole: (guildId: string, data: { name: string; color?: string; permissions?: number }) => Promise<void>;
  updateRole: (roleId: string, data: { guildId: string; name?: string; color?: string; permissions?: number; hoisted?: boolean; mentionable?: boolean }) => Promise<void>;
  deleteRole: (roleId: string, guildId: string) => Promise<void>;
  assignRole: (guildId: string, userId: string, roleId: string) => Promise<void>;
  removeRole: (guildId: string, userId: string, roleId: string) => Promise<void>;
  reset: () => void;
}

const MESSAGE_LIMIT = 50;

export const useGuildStore = create<GuildState>((set, get) => ({
  guilds: [],
  activeGuildId: null,
  activeChannelId: null,
  channels: {},
  members: {},
  roles: {},
  memberRoles: {},
  messages: {},
  usernames: {},
  presenceMap: {},
  loading: false,
  loadingGuilds: false,
  hasMoreMessages: {},
  error: null,

  reset() {
    set({
      guilds: [],
      activeGuildId: null,
      activeChannelId: null,
      channels: {},
      members: {},
      roles: {},
      memberRoles: {},
      messages: {},
      usernames: {},
      presenceMap: {},
      loading: false,
      loadingGuilds: false,
      hasMoreMessages: {},
      error: null,
    });
  },

  async loadGuilds() {
    set({ loadingGuilds: true, error: null });
    try {
      const guilds = await api.getMyGuilds();
      const list = Array.isArray(guilds) ? guilds : [];
      set({ guilds: list, loadingGuilds: false });
    } catch (err) {
      console.error("Failed to load guilds:", err);
      set({ guilds: [], loadingGuilds: false, error: "Failed to load servers" });
    }
  },

  async setActiveGuild(guildId: string) {
    set({ activeGuildId: guildId, activeChannelId: null, loading: true, error: null });
    try {
      const [channels, members, roleList] = await Promise.all([
        api.getChannels(guildId),
        api.getMembers(guildId, 100),
        api.getRoles(guildId),
      ]);

      // Race condition guard: if user switched guild while loading, abort
      if (get().activeGuildId !== guildId) return;

      const channelList = Array.isArray(channels) ? channels : [];
      const memberList = Array.isArray(members) ? members : [];

      // Resolve usernames for members
      const { usernames } = get();
      const newUsernames = { ...usernames };
      const unknownIds = memberList
        .map((m) => m.userId)
        .filter((id) => !newUsernames[id]);

      const batches: string[][] = [];
      for (let i = 0; i < unknownIds.length; i += 10) {
        batches.push(unknownIds.slice(i, i + 10));
      }
      for (const batch of batches) {
        const profiles = await Promise.allSettled(
          batch.map((id) => api.getProfile(id)),
        );
        profiles.forEach((result, idx) => {
          if (result.status === "fulfilled") {
            const p = result.value;
            newUsernames[batch[idx]] = p?.displayName || p?.username || p?.userId?.slice(0, 8) || "User";
          } else {
            newUsernames[batch[idx]] = "Unknown";
          }
        });
      }

      // Guard again after username resolution
      if (get().activeGuildId !== guildId) return;

      const roleArr = Array.isArray(roleList) ? roleList : [];

      // Build memberRoles mapping: userId → roleId[]
      const newMemberRoles: Record<string, string[]> = { ...get().memberRoles };
      for (const member of memberList) {
        if (member.roleIds && member.roleIds.length > 0) {
          newMemberRoles[member.userId] = member.roleIds;
        }
      }

      set((s) => ({
        channels: { ...s.channels, [guildId]: channelList },
        members: { ...s.members, [guildId]: memberList },
        roles: { ...s.roles, [guildId]: roleArr },
        memberRoles: newMemberRoles,
        usernames: newUsernames,
        loading: false,
      }));

      // Auto-select first text channel
      const firstText = channelList.find((c) => c.type === "text");
      if (firstText) {
        await get().setActiveChannel(firstText.id);
      }

      // Load presence for members (non-blocking)
      const memberIds = memberList.map((m) => m.userId);
      if (memberIds.length > 0) {
        api.getBulkPresence(memberIds).then((presences) => {
          if (presences && get().activeGuildId === guildId) {
            const map: Record<string, string> = { ...get().presenceMap };
            for (const p of presences) {
              map[p.userId] = p.status;
            }
            set({ presenceMap: map });
          }
        }).catch(() => {});
      }

      // Load voice states for this guild (non-blocking)
      api.getGuildVoiceStates(guildId).then((states) => {
        if (states && get().activeGuildId === guildId) {
          import("./voice").then(({ useVoiceStore }) => {
            useVoiceStore.getState().updateParticipants(states);
          });
        }
      }).catch(() => {});
    } catch (err) {
      console.error("Failed to load guild data:", err);
      if (get().activeGuildId === guildId) {
        set({ loading: false, error: "Failed to load server data" });
      }
    }
  },

  async setActiveChannel(channelId: string) {
    set({ activeChannelId: channelId });
    try {
      const msgs = await api.getMessages(channelId, MESSAGE_LIMIT);
      const msgList = Array.isArray(msgs) ? msgs : [];
      // API returns DESC order (newest first) — reverse for display
      const sorted = [...msgList].reverse();

      // Resolve author usernames
      const { usernames } = get();
      const newUsernames = { ...usernames };
      const unknownIds = [
        ...new Set(
          sorted.map((m) => m.authorId).filter((id) => !newUsernames[id]),
        ),
      ];

      const batches: string[][] = [];
      for (let i = 0; i < unknownIds.length; i += 10) {
        batches.push(unknownIds.slice(i, i + 10));
      }
      for (const batch of batches) {
        const profiles = await Promise.allSettled(
          batch.map((id) => api.getProfile(id)),
        );
        profiles.forEach((result, idx) => {
          if (result.status === "fulfilled") {
            const p = result.value;
            newUsernames[batch[idx]] = p?.displayName || p?.username || p?.userId?.slice(0, 8) || "User";
          } else {
            newUsernames[batch[idx]] = "Unknown";
          }
        });
      }

      set((s) => ({
        messages: { ...s.messages, [channelId]: sorted },
        usernames: newUsernames,
        hasMoreMessages: {
          ...s.hasMoreMessages,
          [channelId]: msgList.length >= MESSAGE_LIMIT,
        },
      }));
    } catch (err) {
      console.error("Failed to load messages:", err);
    }
  },

  async createGuild(
    name: string,
    description: string,
    isStreamerServer: boolean,
  ) {
    const guild = await api.createGuild(name, description, isStreamerServer);
    set((s) => ({ guilds: [...s.guilds, guild] }));
    await get().setActiveGuild(guild.id);
  },

  async updateGuild(guildId: string, data: { name?: string; description?: string }) {
    const updated = await api.updateGuild(guildId, data);
    set((s) => ({
      guilds: s.guilds.map((g) => (g.id === guildId ? { ...g, ...updated } : g)),
    }));
  },

  async deleteGuild(guildId: string) {
    await api.deleteGuild(guildId);
    set((s) => {
      const isActive = s.activeGuildId === guildId;
      return {
        guilds: s.guilds.filter((g) => g.id !== guildId),
        activeGuildId: isActive ? null : s.activeGuildId,
        activeChannelId: isActive ? null : s.activeChannelId,
      };
    });
  },

  async leaveGuild(guildId: string) {
    await api.leaveGuild(guildId);
    set((s) => {
      const isActive = s.activeGuildId === guildId;
      return {
        guilds: s.guilds.filter((g) => g.id !== guildId),
        activeGuildId: isActive ? null : s.activeGuildId,
        activeChannelId: isActive ? null : s.activeChannelId,
      };
    });
  },

  async updateChannel(channelId: string, data: { name?: string; topic?: string; slowmodeSeconds?: number }) {
    const updated = await api.updateChannel(channelId, data);
    set((s) => {
      const newChannels: Record<string, Channel[]> = {};
      for (const [gId, chs] of Object.entries(s.channels)) {
        newChannels[gId] = chs.map((c) => (c.id === channelId ? { ...c, ...updated } : c));
      }
      return { channels: newChannels };
    });
  },

  async deleteChannel(channelId: string) {
    await api.deleteChannel(channelId);
    set((s) => {
      const newChannels: Record<string, Channel[]> = {};
      for (const [gId, chs] of Object.entries(s.channels)) {
        newChannels[gId] = chs.filter((c) => c.id !== channelId);
      }
      return {
        channels: newChannels,
        activeChannelId: s.activeChannelId === channelId ? null : s.activeChannelId,
      };
    });
  },

  async createChannel(name: string, type: string) {
    const { activeGuildId } = get();
    if (!activeGuildId) return;
    const channel = await api.createChannel(activeGuildId, name, type);
    set((s) => ({
      channels: {
        ...s.channels,
        [activeGuildId]: [...(s.channels[activeGuildId] || []), channel],
      },
    }));
    if (type === "text") {
      await get().setActiveChannel(channel.id);
    }
  },

  async sendMessage(content: string, replyToId?: string) {
    const { activeChannelId } = get();
    if (!activeChannelId) return;

    // Use the full sendMessage API if replyToId provided
    const msg = replyToId
      ? await api.sendMessageWithReply(activeChannelId, content, replyToId)
      : await api.sendMessage(activeChannelId, content);

    // Ensure author username is known
    const { usernames } = get();
    if (!usernames[msg.authorId]) {
      try {
        const profile = await api.getProfile(msg.authorId);
        set((s) => ({
          usernames: {
            ...s.usernames,
            [msg.authorId]: profile.displayName || profile.username,
          },
        }));
      } catch {
        // ignore
      }
    }

    set((s) => {
      const existing = s.messages[activeChannelId] || [];
      // Deduplicate — WS event may have arrived before HTTP response
      if (existing.some((m) => m.id === msg.id)) return s;
      return {
        messages: {
          ...s.messages,
          [activeChannelId]: [...existing, msg],
        },
      };
    });
  },

  async editMessage(messageId: string, content: string) {
    await api.editMessage(messageId, content);
    // Update local state — the WS event will also arrive but we update optimistically
    set((s) => {
      const updated: Record<string, Message[]> = {};
      for (const [chId, msgs] of Object.entries(s.messages)) {
        updated[chId] = msgs.map((m) =>
          m.id === messageId ? { ...m, content, editedAt: new Date().toISOString() } : m,
        );
      }
      return { messages: updated };
    });
  },

  async deleteMessage(messageId: string) {
    await api.deleteMessage(messageId);
    // Remove from local state optimistically
    set((s) => {
      const updated: Record<string, Message[]> = {};
      for (const [chId, msgs] of Object.entries(s.messages)) {
        updated[chId] = msgs.filter((m) => m.id !== messageId);
      }
      return { messages: updated };
    });
  },

  async createRole(guildId: string, data: { name: string; color?: string; permissions?: number }) {
    const role = await api.createRole(guildId, data);
    set((s) => ({
      roles: {
        ...s.roles,
        [guildId]: [...(s.roles[guildId] || []), role],
      },
    }));
  },

  async updateRole(roleId: string, data: { guildId: string; name?: string; color?: string; permissions?: number; hoisted?: boolean; mentionable?: boolean }) {
    const updated = await api.updateRole(roleId, data);
    const { guildId } = data;
    set((s) => ({
      roles: {
        ...s.roles,
        [guildId]: (s.roles[guildId] || []).map((r) =>
          r.id === roleId ? { ...r, ...updated } : r,
        ),
      },
    }));
  },

  async deleteRole(roleId: string, guildId: string) {
    await api.deleteRole(roleId);
    set((s) => ({
      roles: {
        ...s.roles,
        [guildId]: (s.roles[guildId] || []).filter((r) => r.id !== roleId),
      },
    }));
  },

  async assignRole(guildId: string, userId: string, roleId: string) {
    await api.assignRole(guildId, userId, roleId);
  },

  async removeRole(guildId: string, userId: string, roleId: string) {
    await api.removeRole(guildId, userId, roleId);
  },

  async loadMoreMessages() {
    const { activeChannelId, messages, hasMoreMessages } = get();
    if (!activeChannelId) return;
    if (!hasMoreMessages[activeChannelId]) return;

    const currentMsgs = messages[activeChannelId] || [];
    if (currentMsgs.length === 0) return;

    const oldestId = currentMsgs[0].id;
    try {
      const older = await api.getMessages(
        activeChannelId,
        MESSAGE_LIMIT,
        oldestId,
      );
      const olderList = Array.isArray(older) ? older : [];
      const sorted = [...olderList].reverse();

      // Resolve author usernames
      const { usernames } = get();
      const newUsernames = { ...usernames };
      const unknownIds = [
        ...new Set(
          sorted.map((m) => m.authorId).filter((id) => !newUsernames[id]),
        ),
      ];
      for (const id of unknownIds) {
        try {
          const profile = await api.getProfile(id);
          newUsernames[id] = profile.displayName || profile.username;
        } catch {
          newUsernames[id] = "Unknown";
        }
      }

      set((s) => ({
        messages: {
          ...s.messages,
          [activeChannelId]: [...sorted, ...(s.messages[activeChannelId] || [])],
        },
        usernames: newUsernames,
        hasMoreMessages: {
          ...s.hasMoreMessages,
          [activeChannelId]: olderList.length >= MESSAGE_LIMIT,
        },
      }));
    } catch (err) {
      console.error("Failed to load more messages:", err);
    }
  },
}));
