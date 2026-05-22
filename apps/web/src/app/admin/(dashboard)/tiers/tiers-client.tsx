"use client";

import { useState } from "react";
import { updateTierLimits } from "./actions";

interface TierData {
  tier: string;
  [key: string]: unknown;
}

const TIER_COLORS: Record<string, { label: string; text: string; bg: string; border: string }> = {
  free: { label: "Free", text: "text-slate-300", bg: "bg-slate-500/10", border: "border-slate-700" },
  pro: { label: "Pro — $5/mo", text: "text-blue-400", bg: "bg-blue-500/8", border: "border-blue-500/20" },
  ultra: { label: "Ultra — $10/mo", text: "text-amber-400", bg: "bg-amber-500/8", border: "border-amber-500/20" },
};

interface Field {
  key: string;
  label: string;
  type: "number" | "boolean" | "string" | "bytes";
  category: string;
  hint?: string;
}

const FIELDS: Field[] = [
  // Servers
  { key: "maxOwnedGuilds", label: "Max owned servers", type: "number", category: "Servers", hint: "-1 = unlimited" },
  { key: "maxEmojisPerGuild", label: "Emojis per server", type: "number", category: "Servers" },
  { key: "maxStickersPerGuild", label: "Stickers per server", type: "number", category: "Servers" },
  { key: "chatBridgeChannels", label: "Twitch bridge channels", type: "number", category: "Servers", hint: "-1 = unlimited" },
  { key: "serverBoosts", label: "Server boosts included", type: "number", category: "Servers" },
  { key: "analyticsDays", label: "Analytics history (days)", type: "number", category: "Servers", hint: "-1 = unlimited" },
  // Chat
  { key: "maxMessageLength", label: "Max message length", type: "number", category: "Chat" },
  { key: "maxUploadBytes", label: "Max upload size (bytes)", type: "bytes", category: "Chat" },
  { key: "uploadStorageBytes", label: "Total storage (bytes)", type: "bytes", category: "Chat" },
  // Voice
  { key: "voiceBitrate", label: "Voice bitrate (bps)", type: "number", category: "Voice" },
  { key: "screenShareQuality", label: "Screen share quality", type: "string", category: "Voice" },
  // Profile
  { key: "maxBioLength", label: "Max bio length", type: "number", category: "Profile" },
  { key: "maxSocialLinks", label: "Max social links", type: "number", category: "Profile", hint: "-1 = unlimited" },
  { key: "maxBadgesVisible", label: "Max badges visible", type: "number", category: "Profile", hint: "-1 = all" },
  { key: "maxClipsShowcase", label: "Max featured clips", type: "number", category: "Profile" },
  { key: "featuredServers", label: "Featured servers", type: "number", category: "Profile" },
  { key: "animatedAvatar", label: "Animated avatar", type: "boolean", category: "Profile" },
  { key: "animatedBanner", label: "Animated banner (GIF)", type: "boolean", category: "Profile" },
  { key: "videoBanner", label: "Video banner (MP4)", type: "boolean", category: "Profile" },
  { key: "customBackground", label: "Custom background", type: "boolean", category: "Profile" },
  { key: "profileEffects", label: "Profile effects", type: "boolean", category: "Profile" },
  { key: "profileMusic", label: "Profile music", type: "boolean", category: "Profile" },
  { key: "customCss", label: "Custom CSS", type: "boolean", category: "Profile" },
  { key: "dragDropLayout", label: "Drag & drop layout", type: "boolean", category: "Profile" },
  { key: "vanitySlug", label: "Vanity URL slug", type: "boolean", category: "Profile" },
  { key: "visitorCounter", label: "Visitor counter", type: "boolean", category: "Profile" },
  // Other
  { key: "prioritySupport", label: "Priority support", type: "boolean", category: "Other" },
];

function formatBytes(b: number): string {
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(0)} MB`;
  return `${b} B`;
}

export function TiersEditor({ initialTiers }: { initialTiers: TierData[] }) {
  const [tiers, setTiers] = useState(initialTiers);
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tier: string; msg: string } | null>(null);

  function updateField(tierName: string, key: string, value: unknown) {
    setTiers((prev) =>
      prev.map((t) => (t.tier === tierName ? { ...t, [key]: value } : t))
    );
  }

  async function handleSave(tierName: string) {
    const tierData = tiers.find((t) => t.tier === tierName);
    if (!tierData) return;
    setSaving(tierName);
    setFeedback(null);
    try {
      const { tier, ...data } = tierData;
      await updateTierLimits(tier as string, data);
      setFeedback({ tier: tierName, msg: "Saved!" });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err) {
      setFeedback({ tier: tierName, msg: err instanceof Error ? err.message : "Failed" });
    } finally {
      setSaving(null);
    }
  }

  const categories = [...new Set(FIELDS.map((f) => f.category))];

  return (
    <div className="space-y-8">
      {/* Tier columns */}
      <div className="grid grid-cols-3 gap-4">
        {tiers.map((t) => {
          const tc = TIER_COLORS[t.tier as string] || TIER_COLORS.free;
          return (
            <div key={t.tier as string} className={`rounded-xl border ${tc.border} ${tc.bg} p-0.5`}>
              {/* Header */}
              <div className="rounded-t-[10px] bg-dark-950/80 px-4 py-3">
                <h2 className={`text-lg font-bold ${tc.text}`}>{tc.label}</h2>
              </div>

              {/* Fields by category */}
              <div className="space-y-0.5 p-0.5">
                {categories.map((cat) => (
                  <div key={cat} className="rounded-lg bg-dark-900/80 px-4 py-3">
                    <h3 className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">{cat}</h3>
                    <div className="space-y-2.5">
                      {FIELDS.filter((f) => f.category === cat).map((field) => {
                        const val = t[field.key];
                        return (
                          <div key={field.key}>
                            <label className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                              {field.label}
                              {field.hint && <span className="text-[9px] text-slate-600">({field.hint})</span>}
                            </label>
                            {field.type === "boolean" ? (
                              <button
                                type="button"
                                onClick={() => updateField(t.tier as string, field.key, !val)}
                                className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-all ${
                                  val
                                    ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20"
                                    : "bg-dark-800 text-slate-600 ring-1 ring-white/[0.04]"
                                }`}
                              >
                                {val ? "Enabled" : "Disabled"}
                              </button>
                            ) : field.type === "bytes" ? (
                              <div>
                                <input
                                  type="number"
                                  value={val as number}
                                  onChange={(e) => updateField(t.tier as string, field.key, Number(e.target.value))}
                                  className="w-full rounded-md border border-white/[0.06] bg-dark-800 px-2.5 py-1.5 text-xs tabular-nums text-white outline-none focus:border-nexe-500"
                                />
                                <p className="mt-0.5 text-[9px] text-slate-600">{formatBytes(val as number)}</p>
                              </div>
                            ) : field.type === "string" ? (
                              <input
                                type="text"
                                value={(val as string) || ""}
                                onChange={(e) => updateField(t.tier as string, field.key, e.target.value)}
                                className="w-full rounded-md border border-white/[0.06] bg-dark-800 px-2.5 py-1.5 text-xs text-white outline-none focus:border-nexe-500"
                              />
                            ) : (
                              <input
                                type="number"
                                value={val as number}
                                onChange={(e) => updateField(t.tier as string, field.key, Number(e.target.value))}
                                className="w-full rounded-md border border-white/[0.06] bg-dark-800 px-2.5 py-1.5 text-xs tabular-nums text-white outline-none focus:border-nexe-500"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Save */}
              <div className="px-4 py-3">
                {feedback?.tier === t.tier && (
                  <p className={`mb-2 text-xs ${feedback.msg === "Saved!" ? "text-emerald-400" : "text-red-400"}`}>{feedback.msg}</p>
                )}
                <button
                  onClick={() => handleSave(t.tier as string)}
                  disabled={saving === t.tier}
                  className={`w-full rounded-lg px-4 py-2.5 text-xs font-bold transition-all disabled:opacity-50 ${
                    t.tier === "ultra"
                      ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                      : t.tier === "pro"
                      ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
                      : "bg-white/[0.06] text-slate-300 hover:bg-white/[0.1]"
                  }`}
                >
                  {saving === t.tier ? "Saving..." : `Save ${tc.label.split(" —")[0]}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info */}
      <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4">
        <p className="text-[11px] text-slate-600">
          Changes are cached in Redis for 5 minutes. Restart the gateway service to apply immediately.
          Values of <span className="text-slate-400">-1</span> mean unlimited.
          Upload sizes are in bytes (25 MB = 26214400, 100 MB = 104857600, 500 MB = 524288000).
        </p>
      </div>
    </div>
  );
}
