import { create } from "zustand";
import { api, type DMChannel, type DMMessage } from "../lib/api";

interface DMState {
  channels: DMChannel[];
  activeChannelId: string | null;
  messages: Record<string, DMMessage[]>;
  loading: boolean;

  fetchChannels: () => Promise<void>;
  openDM: (targetId: string) => Promise<DMChannel>;
  closeDM: (channelId: string) => Promise<void>;
  setActive: (channelId: string | null) => void;

  fetchMessages: (channelId: string) => Promise<void>;
  sendMessage: (channelId: string, content: string, replyToId?: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;

  // WS handlers
  handleDMChannelCreate: (ch: DMChannel) => void;
  handleDMMessageCreate: (msg: DMMessage) => void;
  handleDMMessageUpdate: (msg: DMMessage) => void;
  handleDMMessageDelete: (data: { id: string; channelId: string }) => void;
}

export const useDMStore = create<DMState>((set, get) => ({
  channels: [],
  activeChannelId: null,
  messages: {},
  loading: false,

  async fetchChannels() {
    try {
      const channels = await api.getDMChannels();
      set({ channels });
    } catch {
      // ignore
    }
  },

  async openDM(targetId: string) {
    const ch = await api.createDM(targetId);
    set((s) => {
      const exists = s.channels.some((c) => c.id === ch.id);
      return {
        channels: exists ? s.channels : [ch, ...s.channels],
        activeChannelId: ch.id,
      };
    });
    return ch;
  },

  async closeDM(channelId: string) {
    await api.closeDM(channelId);
    set((s) => ({
      channels: s.channels.filter((c) => c.id !== channelId),
      activeChannelId: s.activeChannelId === channelId ? null : s.activeChannelId,
    }));
  },

  setActive(channelId: string | null) {
    set({ activeChannelId: channelId });
    if (channelId && !get().messages[channelId]) {
      get().fetchMessages(channelId);
    }
  },

  async fetchMessages(channelId: string) {
    set({ loading: true });
    try {
      const messages = await api.getDMMessages(channelId);
      set((s) => ({
        messages: { ...s.messages, [channelId]: messages },
      }));
    } finally {
      set({ loading: false });
    }
  },

  async sendMessage(channelId: string, content: string, replyToId?: string) {
    const msg = await api.sendDMMessage(channelId, content, replyToId);
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: [...(s.messages[channelId] || []), msg],
      },
    }));
  },

  async editMessage(messageId: string, content: string) {
    const updated = await api.editDMMessage(messageId, content);
    set((s) => ({
      messages: {
        ...s.messages,
        [updated.channelId]: (s.messages[updated.channelId] || []).map((m) =>
          m.id === messageId ? updated : m
        ),
      },
    }));
  },

  async deleteMessage(messageId: string) {
    // Find which channel this message belongs to
    const allMsgs = get().messages;
    let channelId = "";
    for (const [cid, msgs] of Object.entries(allMsgs)) {
      if (msgs.some((m) => m.id === messageId)) {
        channelId = cid;
        break;
      }
    }
    await api.deleteDMMessage(messageId);
    if (channelId) {
      set((s) => ({
        messages: {
          ...s.messages,
          [channelId]: (s.messages[channelId] || []).filter((m) => m.id !== messageId),
        },
      }));
    }
  },

  // WS handlers
  handleDMChannelCreate(ch: DMChannel) {
    set((s) => {
      if (s.channels.some((c) => c.id === ch.id)) return s;
      return { channels: [ch, ...s.channels] };
    });
  },

  handleDMMessageCreate(msg: DMMessage) {
    set((s) => {
      const existing = s.messages[msg.channelId] || [];
      // Avoid duplicates
      if (existing.some((m) => m.id === msg.id)) return s;

      // Move channel to top of list
      const channels = [...s.channels];
      const idx = channels.findIndex((c) => c.id === msg.channelId);
      if (idx > 0) {
        const [ch] = channels.splice(idx, 1);
        channels.unshift(ch);
      }

      // Reopen channel if it was closed (it's now in the list from backend)
      return {
        channels,
        messages: {
          ...s.messages,
          [msg.channelId]: [...existing, msg],
        },
      };
    });
  },

  handleDMMessageUpdate(msg: DMMessage) {
    set((s) => ({
      messages: {
        ...s.messages,
        [msg.channelId]: (s.messages[msg.channelId] || []).map((m) =>
          m.id === msg.id ? msg : m
        ),
      },
    }));
  },

  handleDMMessageDelete(data: { id: string; channelId: string }) {
    set((s) => ({
      messages: {
        ...s.messages,
        [data.channelId]: (s.messages[data.channelId] || []).filter((m) => m.id !== data.id),
      },
    }));
  },
}));
