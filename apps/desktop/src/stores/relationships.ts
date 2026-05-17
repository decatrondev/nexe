import { create } from "zustand";
import { api, type Relationship } from "../lib/api";
import { useGuildStore } from "./guild";
import { useAuthStore } from "./auth";

interface RelationshipState {
  relationships: Relationship[];
  loading: boolean;

  fetchRelationships: () => Promise<void>;
  sendFriendRequest: (username: string) => Promise<void>;
  acceptRequest: (id: string) => Promise<void>;
  rejectRequest: (id: string) => Promise<void>;
  removeFriend: (id: string) => Promise<void>;
  blockUser: (targetId: string) => Promise<void>;
  unblock: (id: string) => Promise<void>;
  updateRelationship: (id: string, data: { note?: string; isFavorite?: boolean }) => Promise<void>;

  // Derived helpers
  friends: () => Relationship[];
  pending: () => Relationship[];
  blocked: () => Relationship[];
  incomingRequests: (myId: string) => Relationship[];
  outgoingRequests: (myId: string) => Relationship[];

  _resolveUser: (userId: string) => void;

  // WS event handlers
  handleRelationshipCreate: (rel: Relationship) => void;
  handleRelationshipUpdate: (rel: Relationship) => void;
  handleRelationshipRemove: (data: { id: string }) => void;
}

export const useRelationshipStore = create<RelationshipState>((set, get) => ({
  relationships: [],
  loading: false,

  async fetchRelationships() {
    set({ loading: true });
    try {
      const data = await api.getRelationships();
      set({ relationships: data.relationships });
      // Populate guild store with user info for non-guild users
      if (data.users) {
        const guildState = useGuildStore.getState();
        const newUsernames = { ...guildState.usernames };
        const newAvatarMap = { ...guildState.avatarMap };
        for (const [uid, info] of Object.entries(data.users)) {
          newUsernames[uid] = info.username;
          if (info.avatarUrl) newAvatarMap[uid] = info.avatarUrl;
        }
        useGuildStore.setState({ usernames: newUsernames, avatarMap: newAvatarMap });

        // Fetch presence for all related users
        const userIds = Object.keys(data.users);
        if (userIds.length > 0) {
          api.getBulkPresence(userIds).then((presences) => {
            const gs = useGuildStore.getState();
            const newPresence = { ...gs.presenceMap };
            for (const p of presences) {
              newPresence[p.userId] = p.status;
            }
            useGuildStore.setState({ presenceMap: newPresence });
          }).catch(() => {});
        }
      }
    } finally {
      set({ loading: false });
    }
  },

  async sendFriendRequest(username: string) {
    await api.sendFriendRequest(username);
    // Don't add optimistically — WS event will handle it
  },

  async acceptRequest(id: string) {
    await api.acceptFriendRequest(id);
    // Don't add optimistically — WS event will handle the update
  },

  async rejectRequest(id: string) {
    await api.deleteRelationship(id);
    // Don't remove optimistically — WS RELATIONSHIP_REMOVE will handle it
  },

  async removeFriend(id: string) {
    await api.deleteRelationship(id);
  },

  async blockUser(targetId: string) {
    await api.blockUser(targetId);
  },

  async unblock(id: string) {
    await api.deleteRelationship(id);
    set((s) => ({ relationships: s.relationships.filter((r) => r.id !== id) }));
  },

  async updateRelationship(id: string, data: { note?: string; isFavorite?: boolean }) {
    const updated = await api.updateRelationship(id, data);
    set((s) => ({
      relationships: s.relationships.map((r) => (r.id === id ? updated : r)),
    }));
  },

  friends() {
    return get().relationships.filter((r) => r.type === "friend");
  },

  pending() {
    return get().relationships.filter((r) => r.type === "pending");
  },

  blocked() {
    return get().relationships.filter((r) => r.type === "blocked");
  },

  incomingRequests(myId: string) {
    return get().relationships.filter((r) => r.type === "pending" && r.targetId === myId);
  },

  outgoingRequests(myId: string) {
    return get().relationships.filter((r) => r.type === "pending" && r.userId === myId);
  },

  // Resolve unknown usernames for relationship users
  _resolveUser(userId: string) {
    const { usernames } = useGuildStore.getState();
    if (usernames[userId]) return;
    api.getProfile(userId).then((profile) => {
      if (!profile) return;
      const gs = useGuildStore.getState();
      useGuildStore.setState({
        usernames: { ...gs.usernames, [userId]: profile.displayName || profile.username || "User" },
        avatarMap: profile.avatarUrl ? { ...gs.avatarMap, [userId]: profile.avatarUrl } : gs.avatarMap,
      });
    }).catch(() => {});
  },

  // WS event handlers
  handleRelationshipCreate(rel: Relationship) {
    set((s) => {
      // Deduplicate by ID
      if (s.relationships.some((r) => r.id === rel.id)) return s;
      // Also deduplicate by user pair + type (prevent double from optimistic + WS)
      const hasSamePair = s.relationships.some(
        (r) => r.type === rel.type && (
          (r.userId === rel.userId && r.targetId === rel.targetId) ||
          (r.userId === rel.targetId && r.targetId === rel.userId)
        )
      );
      if (hasSamePair) return s;
      return { relationships: [...s.relationships, rel] };
    });
    // Resolve unknown users
    const myId = useAuthStore.getState().user?.id;
    const otherId = rel.userId === myId ? rel.targetId : rel.userId;
    get()._resolveUser(otherId);
  },

  handleRelationshipUpdate(rel: Relationship) {
    set((s) => {
      // When accepting: pending→friend. Remove old pending for this user pair, add/update the friend entry.
      const filtered = s.relationships.filter((r) => {
        // Remove if same ID (will be replaced)
        if (r.id === rel.id) return false;
        // Remove old pending between the same two users (accept flow)
        if (r.type === "pending" && rel.type === "friend") {
          const sameUsers = (r.userId === rel.userId && r.targetId === rel.targetId) ||
                            (r.userId === rel.targetId && r.targetId === rel.userId);
          if (sameUsers) return false;
        }
        return true;
      });
      // Only add if not already present (different ID but same user pair + type)
      const alreadyExists = filtered.some(
        (r) => r.type === rel.type && (
          (r.userId === rel.userId && r.targetId === rel.targetId) ||
          (r.userId === rel.targetId && r.targetId === rel.userId)
        )
      );
      return { relationships: alreadyExists ? filtered : [...filtered, rel] };
    });
    // Resolve unknown users
    const myId = useAuthStore.getState().user?.id;
    const otherId = rel.userId === myId ? rel.targetId : rel.userId;
    get()._resolveUser(otherId);
  },

  handleRelationshipRemove(data: { id: string }) {
    set((s) => ({
      relationships: s.relationships.filter((r) => r.id !== data.id),
    }));
  },
}));
