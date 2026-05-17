import { create } from "zustand";
import { api, type Relationship } from "../lib/api";

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
      const rels = await api.getRelationships();
      set({ relationships: rels });
    } finally {
      set({ loading: false });
    }
  },

  async sendFriendRequest(username: string) {
    const rel = await api.sendFriendRequest(username);
    set((s) => ({ relationships: [...s.relationships, rel] }));
  },

  async acceptRequest(id: string) {
    const rel = await api.acceptFriendRequest(id);
    // Remove the pending, add the new friend
    set((s) => ({
      relationships: s.relationships
        .filter((r) => r.id !== id)
        .concat(rel),
    }));
  },

  async rejectRequest(id: string) {
    await api.deleteRelationship(id);
    set((s) => ({ relationships: s.relationships.filter((r) => r.id !== id) }));
  },

  async removeFriend(id: string) {
    await api.deleteRelationship(id);
    set((s) => ({ relationships: s.relationships.filter((r) => r.id !== id) }));
  },

  async blockUser(targetId: string) {
    const rel = await api.blockUser(targetId);
    // Remove any existing relationship with this user, add the block
    set((s) => ({
      relationships: s.relationships
        .filter((r) => r.targetId !== targetId && r.userId !== targetId)
        .concat(rel),
    }));
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

  // WS event handlers
  handleRelationshipCreate(rel: Relationship) {
    set((s) => {
      // Avoid duplicates
      if (s.relationships.some((r) => r.id === rel.id)) return s;
      return { relationships: [...s.relationships, rel] };
    });
  },

  handleRelationshipUpdate(rel: Relationship) {
    set((s) => {
      const exists = s.relationships.some((r) => r.id === rel.id);
      if (exists) {
        return { relationships: s.relationships.map((r) => (r.id === rel.id ? rel : r)) };
      }
      // Might be new (e.g. pending→friend creates new entry)
      return { relationships: [...s.relationships, rel] };
    });
  },

  handleRelationshipRemove(data: { id: string }) {
    set((s) => ({
      relationships: s.relationships.filter((r) => r.id !== data.id),
    }));
  },
}));
