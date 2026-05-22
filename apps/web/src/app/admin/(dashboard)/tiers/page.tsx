import { query } from "@/lib/db";
import { TiersEditor } from "./tiers-client";

export const dynamic = "force-dynamic";

interface TierRow {
  tier: string;
  max_owned_guilds: number;
  max_emojis_per_guild: number;
  max_stickers_per_guild: number;
  max_upload_bytes: number;
  voice_bitrate: number;
  screen_share_quality: string;
  animated_avatar: boolean;
  animated_banner: boolean;
  video_banner: boolean;
  chat_bridge_channels: number;
  analytics_days: number;
  server_boosts: number;
  priority_support: boolean;
  max_message_length: number;
  max_bio_length: number;
  max_social_links: number;
  max_badges_visible: number;
  max_clips_showcase: number;
  profile_effects: boolean;
  profile_music: boolean;
  custom_css: boolean;
  drag_drop_layout: boolean;
  custom_background: boolean;
  featured_servers: number;
  vanity_slug: boolean;
  visitor_counter: boolean;
  upload_storage_bytes: number;
}

function toClient(row: TierRow) {
  return {
    tier: row.tier,
    maxOwnedGuilds: row.max_owned_guilds,
    maxEmojisPerGuild: row.max_emojis_per_guild,
    maxStickersPerGuild: row.max_stickers_per_guild,
    maxUploadBytes: Number(row.max_upload_bytes),
    voiceBitrate: row.voice_bitrate,
    screenShareQuality: row.screen_share_quality,
    animatedAvatar: row.animated_avatar,
    animatedBanner: row.animated_banner,
    videoBanner: row.video_banner,
    chatBridgeChannels: row.chat_bridge_channels,
    analyticsDays: row.analytics_days,
    serverBoosts: row.server_boosts,
    prioritySupport: row.priority_support,
    maxMessageLength: row.max_message_length,
    maxBioLength: row.max_bio_length,
    maxSocialLinks: row.max_social_links,
    maxBadgesVisible: row.max_badges_visible,
    maxClipsShowcase: row.max_clips_showcase,
    profileEffects: row.profile_effects,
    profileMusic: row.profile_music,
    customCss: row.custom_css,
    dragDropLayout: row.drag_drop_layout,
    customBackground: row.custom_background,
    featuredServers: row.featured_servers,
    vanitySlug: row.vanity_slug,
    visitorCounter: row.visitor_counter,
    uploadStorageBytes: Number(row.upload_storage_bytes),
  };
}

export default async function TiersPage() {
  const rows = await query<TierRow>("SELECT * FROM tier_limits ORDER BY CASE tier WHEN 'free' THEN 0 WHEN 'pro' THEN 1 WHEN 'ultra' THEN 2 END");

  const tiers = rows.map(toClient);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Tier Limits</h1>
        <p className="mt-1 text-sm text-slate-500">Configure what each tier can do. Changes apply after Redis cache expires (~5 min) or gateway restart.</p>
      </div>
      <TiersEditor initialTiers={tiers} />
    </div>
  );
}
