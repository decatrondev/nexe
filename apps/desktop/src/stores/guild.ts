import { create } from "zustand";
import {
  api,
  type Guild,
  type Channel,
  type GuildMember,
  type Message,
} from "../lib/api";

interface GuildState {
  guilds: Guild[];
  activeGuildId: string | null;
  activeChannelId: string | null;
  channels: Record<string, Channel[]>;
  members: Record<string, GuildMember[]>;
  messages: Record<string, Message[]>;
  usernames: Record<string, string>;
  loading: boolean;
  hasMoreMessages: Record<string, boolean>;

  loadGuilds: () => Promise<void>;
  setActiveGuild: (guildId: string) => Promise<void>;
  setActiveChannel: (channelId: string) => Promise<void>;
  createGuild: (
    name: string,
    description: string,
    isStreamerServer: boolean,
  ) => Promise<void>;
  createChannel: (name: string, type: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
}

const MESSAGE_LIMIT = 50;

export const useGuildStore = create<GuildState>((set, get) => ({
  guilds: [],
  activeGuildId: null,
  activeChannelId: null,
  channels: {},
  members: {},
  messages: {},
  usernames: {},
  loading: false,
  hasMoreMessages: {},

  async loadGuilds() {
    try {
      const guilds = await api.getMyGuilds();
      const list = Array.isArray(guilds) ? guilds : [];
      set({ guilds: list });
    } catch (err) {
      console.error("Failed to load guilds:", err);
      set({ guilds: [] });
    }
  },

  async setActiveGuild(guildId: string) {
    set({ activeGuildId: guildId, activeChannelId: null, loading: true });
    try {
      const [channels, members] = await Promise.all([
        api.getChannels(guildId),
        api.getMembers(guildId, 100),
      ]);

      const channelList = Array.isArray(channels) ? channels : [];
      const memberList = Array.isArray(members) ? members : [];

      // Resolve usernames for members
      const { usernames } = get();
      const newUsernames = { ...usernames };
      const unknownIds = memberList
        .map((m) => m.userId)
        .filter((id) => !newUsernames[id]);

      // Fetch profiles for unknown users (batch, max 10 concurrent)
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
            newUsernames[batch[idx]] = p?.displayName || p?.username || p?.id?.slice(0, 8) || "User";
          } else {
            newUsernames[batch[idx]] = "Unknown";
          }
        });
      }

      set((s) => ({
        channels: { ...s.channels, [guildId]: channelList },
        members: { ...s.members, [guildId]: memberList },
        usernames: newUsernames,
        loading: false,
      }));

      // Auto-select first text channel
      const firstText = channelList.find((c) => c.type === "text");
      if (firstText) {
        await get().setActiveChannel(firstText.id);
      }
    } catch (err) {
      console.error("Failed to load guild data:", err);
      set({ loading: false });
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
            newUsernames[batch[idx]] = p?.displayName || p?.username || p?.id?.slice(0, 8) || "User";
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

  async sendMessage(content: string) {
    const { activeChannelId } = get();
    if (!activeChannelId) return;
    const msg = await api.sendMessage(activeChannelId, content);

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

    set((s) => ({
      messages: {
        ...s.messages,
        [activeChannelId]: [
          ...(s.messages[activeChannelId] || []),
          msg,
        ],
      },
    }));
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
