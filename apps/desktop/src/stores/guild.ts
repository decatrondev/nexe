import { create } from "zustand";
import { loadGuildEmotes } from "../components/EmotePicker";
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
  streamStatusMap: Record<string, { live: boolean; title?: string; game?: string; viewers?: number; startedAt?: string; thumbnail?: string }>;
  liveGuilds: Set<string>; // guildIds that have at least one member streaming
  activeThreadId: string | null;
  threadMessages: Record<string, Message[]>;
  unreadChannels: Record<string, number>; // channelId → unread count
  lastReadMessageIds: Record<string, string>; // channelId → last read message id (for divider)
  emotesReady: number; // increment to trigger re-render when emotes load
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
  reorderChannels: (guildId: string, channelIds: string[]) => Promise<void>;
  openThread: (parentMessageId: string) => Promise<void>;
  closeThread: () => void;
  sendThreadMessage: (content: string) => Promise<void>;
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
  streamStatusMap: {},
  liveGuilds: new Set<string>(),
  activeThreadId: null,
  threadMessages: {},
  unreadChannels: {},
  lastReadMessageIds: {},
  emotesReady: 0,
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
      streamStatusMap: {},
      liveGuilds: new Set<string>(),
      activeThreadId: null,
      threadMessages: {},
      unreadChannels: {},
      lastReadMessageIds: {},
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

      // Fetch unread channels
      api.getUnreadChannels().then((unreads) => {
        if (unreads) {
          const countMap: Record<string, number> = {};
          const readMap: Record<string, string> = {};
          for (const u of unreads) {
            countMap[u.channelId] = u.unreadCount;
            if (u.lastReadId) readMap[u.channelId] = u.lastReadId;
          }
          set({ unreadChannels: countMap, lastReadMessageIds: readMap });
        }
      }).catch(() => {});

      // Check which guilds have live streamers
      if (list.length > 0) {
        api.getLiveGuilds(list.map((g) => g.id)).then((res) => {
          if (res?.guildIds) {
            set({ liveGuilds: new Set(res.guildIds) });
          }
        }).catch(() => {});
      }

      // Load emotes for ALL guilds so :emote: resolves everywhere
      Promise.all(
        list.map((g) => loadGuildEmotes(g.id, g.name).catch(() => {}))
      ).then(() => {
        set((s) => ({ emotesReady: s.emotesReady + 1 }));
      });
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

      // Emotes are loaded for all guilds at startup — no need to reload here

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
            const streams: GuildState["streamStatusMap"] = { ...get().streamStatusMap };
            for (const p of presences) {
              map[p.userId] = p.status;
              if (p.streamingLive) {
                streams[p.userId] = { live: true, title: p.streamTitle, game: p.streamGame, viewers: p.streamViewers, startedAt: p.streamStartedAt, thumbnail: p.streamThumbnail };
              }
            }
            set({ presenceMap: map, streamStatusMap: streams });
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

      // Mark channel as read (delay briefly so divider can render first)
      setTimeout(() => {
        api.ackChannel(channelId).then(() => {
          set((s) => {
            const u = { ...s.unreadChannels };
            delete u[channelId];
            // Keep lastReadMessageIds — divider uses it until component unmounts
            return { unreadChannels: u };
          });
        }).catch(() => {});
      }, 500);
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

  async reorderChannels(guildId: string, channelIds: string[]) {
    // Optimistic update
    set((s) => {
      const chs = s.channels[guildId];
      if (!chs) return s;
      const ordered = channelIds.map((id, i) => {
        const ch = chs.find((c) => c.id === id);
        return ch ? { ...ch, position: i } : null;
      }).filter(Boolean) as Channel[];
      // Keep any channels not in the reorder list (shouldn't happen but safe)
      const remaining = chs.filter((c) => !channelIds.includes(c.id));
      return { channels: { ...s.channels, [guildId]: [...ordered, ...remaining] } };
    });
    await api.reorderChannels(guildId, channelIds);
  },

  async openThread(parentMessageId: string) {
    set({ activeThreadId: parentMessageId });
    try {
      const messages = await api.getThreadMessages(parentMessageId);
      set((s) => ({
        threadMessages: { ...s.threadMessages, [parentMessageId]: messages ?? [] },
      }));
    } catch {
      set((s) => ({
        threadMessages: { ...s.threadMessages, [parentMessageId]: [] },
      }));
    }
  },

  closeThread() {
    set({ activeThreadId: null });
  },

  async sendThreadMessage(content: string) {
    const threadId = get().activeThreadId;
    if (!threadId) return;
    await api.sendThreadMessage(threadId, content);
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
