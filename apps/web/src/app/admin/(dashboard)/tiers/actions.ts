"use server";

import { query } from "@/lib/db";
import { isAdminAuthenticated } from "@/lib/admin-auth";

async function requireAdmin() {
  if (!(await isAdminAuthenticated())) throw new Error("Unauthorized");
}

export async function updateTierLimits(tier: string, data: Record<string, unknown>) {
  await requireAdmin();

  if (!["free", "pro", "ultra"].includes(tier)) {
    throw new Error("Invalid tier");
  }

  const columns: Record<string, string> = {
    maxOwnedGuilds: "max_owned_guilds",
    maxEmojisPerGuild: "max_emojis_per_guild",
    maxStickersPerGuild: "max_stickers_per_guild",
    maxUploadBytes: "max_upload_bytes",
    voiceBitrate: "voice_bitrate",
    screenShareQuality: "screen_share_quality",
    animatedAvatar: "animated_avatar",
    animatedBanner: "animated_banner",
    videoBanner: "video_banner",
    chatBridgeChannels: "chat_bridge_channels",
    analyticsDays: "analytics_days",
    serverBoosts: "server_boosts",
    prioritySupport: "priority_support",
    maxMessageLength: "max_message_length",
    maxBioLength: "max_bio_length",
    maxSocialLinks: "max_social_links",
    maxBadgesVisible: "max_badges_visible",
    maxClipsShowcase: "max_clips_showcase",
    profileEffects: "profile_effects",
    profileMusic: "profile_music",
    customCss: "custom_css",
    dragDropLayout: "drag_drop_layout",
    customBackground: "custom_background",
    featuredServers: "featured_servers",
    vanitySlug: "vanity_slug",
    visitorCounter: "visitor_counter",
    uploadStorageBytes: "upload_storage_bytes",
  };

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  for (const [key, val] of Object.entries(data)) {
    const col = columns[key];
    if (!col) continue;
    setClauses.push(`${col} = $${i}`);
    values.push(val);
    i++;
  }

  if (setClauses.length === 0) return;

  values.push(tier);
  await query(
    `UPDATE tier_limits SET ${setClauses.join(", ")} WHERE tier = $${i}`,
    values
  );
}
