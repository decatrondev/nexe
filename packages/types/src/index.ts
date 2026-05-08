// Nexe shared types
// This package contains TypeScript types shared between desktop and web apps.

// ============================================================
// User
// ============================================================

export interface User {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  twitchId?: string;
  twitchLogin?: string;
  twitchDisplayName?: string;
  status: UserStatus;
  customStatusText?: string;
  customStatusEmoji?: string;
  tier: Tier;
  createdAt: string;
}

export type UserStatus = "online" | "offline" | "idle" | "dnd";
export type Tier = "free" | "pro" | "streamer";

// ============================================================
// Profile
// ============================================================

export interface Profile {
  userId: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  accentColor?: string;
  backgroundUrl?: string;
  socialLinks: SocialLink[];
  featuredClips: Clip[];
  level: number;
  totalXp: number;
}

export interface SocialLink {
  platform: string;
  url: string;
  verified: boolean;
}

export interface Clip {
  clipId: string;
  platform: "twitch" | "kick";
  url: string;
  thumbnailUrl: string;
  title: string;
}

// ============================================================
// Guild
// ============================================================

export interface Guild {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  bannerUrl?: string;
  ownerId: string;
  isStreamerServer: boolean;
  memberCount: number;
  features: string[];
  createdAt: string;
}

export interface Channel {
  id: string;
  guildId: string;
  categoryId?: string;
  name: string;
  topic?: string;
  type: ChannelType;
  position: number;
  slowmodeSeconds: number;
  isSubOnly: boolean;
  isLiveChannel: boolean;
}

export type ChannelType = "text" | "voice" | "announcement" | "stage" | "thread_parent";

export interface Category {
  id: string;
  guildId: string;
  name: string;
  position: number;
}

// ============================================================
// Message
// ============================================================

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  type: MessageType;
  replyToId?: string;
  threadId?: string;
  editedAt?: string;
  deleted: boolean;
  pinned: boolean;
  embeds: Embed[];
  attachments: Attachment[];
  reactions: Reaction[];
  mentionEveryone: boolean;
  createdAt: string;
}

export type MessageType = "default" | "reply" | "system" | "thread_starter";

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  thumbnailUrl?: string;
  providerName?: string;
}

export interface Attachment {
  id: string;
  filename: string;
  url: string;
  contentType?: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

export interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
}

// ============================================================
// Role & Permissions
// ============================================================

export interface Role {
  id: string;
  guildId: string;
  name: string;
  color?: string;
  iconUrl?: string;
  position: number;
  permissions: bigint;
  mentionable: boolean;
  hoisted: boolean;
  isDefault: boolean;
  isAuto: boolean;
  autoSource?: AutoRoleSource;
}

export type AutoRoleSource = "twitch_sub" | "twitch_follow" | "twitch_vip" | "twitch_mod";

// ============================================================
// WebSocket
// ============================================================

export type WSOpcode =
  | 0  // IDENTIFY
  | 1  // HEARTBEAT
  | 2  // PRESENCE_UPDATE
  | 3  // VOICE_STATE_UPDATE
  | 4  // RESUME
  | 5; // REQUEST_GUILD_MEMBERS

export type WSEvent =
  | "READY"
  | "MESSAGE_CREATE"
  | "MESSAGE_UPDATE"
  | "MESSAGE_DELETE"
  | "TYPING_START"
  | "PRESENCE_UPDATE"
  | "GUILD_CREATE"
  | "GUILD_UPDATE"
  | "GUILD_DELETE"
  | "CHANNEL_CREATE"
  | "CHANNEL_UPDATE"
  | "CHANNEL_DELETE"
  | "GUILD_MEMBER_ADD"
  | "GUILD_MEMBER_REMOVE"
  | "GUILD_MEMBER_UPDATE"
  | "GUILD_ROLE_CREATE"
  | "GUILD_ROLE_UPDATE"
  | "GUILD_ROLE_DELETE"
  | "GUILD_BAN_ADD"
  | "GUILD_BAN_REMOVE"
  | "GUILD_EMOJIS_UPDATE"
  | "THREAD_CREATE"
  | "THREAD_UPDATE"
  | "THREAD_DELETE"
  | "STREAM_STATUS_UPDATE"
  | "REACTION_ADD"
  | "REACTION_REMOVE";

// ============================================================
// Badge
// ============================================================

export interface Badge {
  id: string;
  name: string;
  description?: string;
  iconUrl: string;
  type: "global" | "server" | "achievement";
}

// ============================================================
// API Responses
// ============================================================

export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  cursor?: string;
  hasMore: boolean;
}
