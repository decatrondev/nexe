import { create } from "zustand";
import { api, type DMChannel, type DMMessage } from "../lib/api";

interface DMState {
  channels: DMChannel[];
  requests: DMChannel[];
  activeChannelId: string | null;
  messages: Record<string, DMMessage[]>;
  unreads: Record<string, number>; // channelId → unread count
  readReceipts: Record<string, { userId: string; messageId: string }>; // channelId → last read by other
  typing: Record<string, { userId: string; timeout: ReturnType<typeof setTimeout> }>; // channelId → typing user
  loading: boolean;

  fetchChannels: () => Promise<void>;
  fetchRequests: () => Promise<void>;
  fetchUnreads: () => Promise<void>;
  ackChannel: (channelId: string) => Promise<void>;
  pinDM: (channelId: string) => Promise<void>;
  unpinDM: (channelId: string) => Promise<void>;
  acceptRequest: (channelId: string) => Promise<void>;
  rejectRequest: (channelId: string) => Promise<void>;
  openDM: (targetId: string) => Promise<DMChannel>;
  openGroupDM: (name: string, userIds: string[]) => Promise<DMChannel>;
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
  handleDMTyping: (data: { channelId: string; userId: string }) => void;
  handleDMRead: (data: { channelId: string; userId: string; messageId: string }) => void;
}

export const useDMStore = create<DMState>((set, get) => ({
  channels: [],
  requests: [],
  activeChannelId: null,
  messages: {},
  unreads: {},
  readReceipts: {},
  typing: {},
  loading: false,

  async fetchUnreads() {
    try {
      const data = await api.getDMUnreads();
      const unreads: Record<string, number> = {};
      for (const u of data) {
        unreads[u.channelId] = u.unreadCount;
      }
      set({ unreads });
    } catch { /* ignore */ }
  },

  async ackChannel(channelId: string) {
    const msgs = get().messages[channelId];
    if (!msgs || msgs.length === 0) return;
    const lastMsg = msgs[msgs.length - 1];
    try {
      await api.ackDM(channelId, lastMsg.id);
      set((s) => {
        const unreads = { ...s.unreads };
        delete unreads[channelId];
        return { unreads };
      });
    } catch { /* ignore */ }
  },

  async pinDM(channelId: string) {
    await api.pinDM(channelId);
    await get().fetchChannels();
  },

  async unpinDM(channelId: string) {
    await api.unpinDM(channelId);
    await get().fetchChannels();
  },

  async fetchRequests() {
    try {
      const requests = await api.getDMRequests();
      set({ requests });
    } catch {
      // ignore
    }
  },

  async acceptRequest(channelId: string) {
    const ch = await api.acceptDMRequest(channelId);
    set((s) => ({
      requests: s.requests.filter((c) => c.id !== channelId),
      channels: [ch, ...s.channels],
    }));
  },

  async rejectRequest(channelId: string) {
    await api.rejectDMRequest(channelId);
    set((s) => ({
      requests: s.requests.filter((c) => c.id !== channelId),
    }));
  },

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

  async openGroupDM(name: string, userIds: string[]) {
    const ch = await api.createGroupDM(name, userIds);
    set((s) => ({
      channels: [ch, ...s.channels],
      activeChannelId: ch.id,
    }));
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
      if (existing.some((m) => m.id === msg.id)) return s;

      const channels = [...s.channels];
      const idx = channels.findIndex((c) => c.id === msg.channelId);
      if (idx > 0) {
        const [ch] = channels.splice(idx, 1);
        channels.unshift(ch);
      }

      // Increment unread if not the active channel
      const unreads = { ...s.unreads };
      if (s.activeChannelId !== msg.channelId) {
        unreads[msg.channelId] = (unreads[msg.channelId] || 0) + 1;
      }

      // Clear typing indicator for this user
      const typing = { ...s.typing };
      if (typing[msg.channelId]) {
        clearTimeout(typing[msg.channelId].timeout);
        delete typing[msg.channelId];
      }

      return {
        channels,
        unreads,
        typing,
        messages: { ...s.messages, [msg.channelId]: [...existing, msg] },
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

  handleDMRead(data: { channelId: string; userId: string; messageId: string }) {
    set((s) => ({
      readReceipts: { ...s.readReceipts, [data.channelId]: { userId: data.userId, messageId: data.messageId } },
    }));
  },

  handleDMTyping(data: { channelId: string; userId: string }) {
    set((s) => {
      const typing = { ...s.typing };
      // Clear existing timeout
      if (typing[data.channelId]) {
        clearTimeout(typing[data.channelId].timeout);
      }
      // Set new typing with 5s timeout
      typing[data.channelId] = {
        userId: data.userId,
        timeout: setTimeout(() => {
          set((s2) => {
            const t = { ...s2.typing };
            delete t[data.channelId];
            return { typing: t };
          });
        }, 5000),
      };
      return { typing };
    });
  },
}));
