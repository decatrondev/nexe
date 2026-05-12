import { useEffect, useRef, useState, useMemo } from "react";
import { api } from "../lib/api";
import { useGuildStore } from "../stores/guild";
import { useAuthStore } from "../stores/auth";

interface EmotePickerProps {
  x: number;
  y: number;
  onSelect: (text: string) => void;
  onClose: () => void;
  /** Other guild emotes for locked display */
  allGuildEmotes?: Record<string, EmoteItem[]>;
}

interface EmoteItem {
  name: string;
  url: string;
  animated?: boolean;
  source: string;
  locked?: boolean;
  guildName?: string;
}

interface EmoteSection {
  id: string;
  label: string;
  icon: string;
  emotes: EmoteItem[];
}

const RECENT_KEY = "nexe_recent_emotes";
const MAX_RECENT = 24;

function getRecent(): EmoteItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw).slice(0, MAX_RECENT) : [];
  } catch { return []; }
}

function saveRecent(emote: EmoteItem) {
  const recent = getRecent().filter((e) => e.name !== emote.name || e.source !== emote.source);
  recent.unshift(emote);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

// Basic unicode emoji sets (condensed)
const UNICODE_EMOJIS = [
  "😀","😂","🥹","😊","😍","🥰","😘","😜","🤪","😎","🤓","🥳","😤","😡","🤬","😱","😨","😰","😢","😭","🥺","😩","😫","🤮","💀","☠️","👻","👽","🤖","💩",
  "❤️","🧡","💛","💚","💙","💜","🖤","🤍","💔","❤️‍🔥","💯","💢","💥","🔥","✨","⭐","🌟","💫","🎉","🎊",
  "👍","👎","👏","🙌","🤝","✌️","🤞","🤟","🤙","👋","💪","🫡","🫶",
  "🎮","🕹️","🎲","🏆","🥇","🎯","🎪","🎭","🎨","🎬","🎤","🎧","🎵","🎶",
];

// Emote cache per guild
const emoteCache = new Map<string, { data: EmoteSection[]; ts: number }>();

// Shared lookup map: emoteName → url (for MessageContent to resolve :emote: syntax)
export const emoteLookup = new Map<string, string>();

/** Load emotes for a guild and populate the lookup. Call this when entering a server. */
export async function loadGuildEmotes(guildId: string, guildName?: string) {
  const cached = emoteCache.get(guildId);
  if (cached && Date.now() - cached.ts < 180_000) {
    // Add to lookup from cache (don't clear — keep emotes from other servers)
    for (const sec of cached.data) {
      for (const e of sec.emotes) {
        if (e.source !== "emoji" && e.url) emoteLookup.set(e.name, e.url);
      }
    }
    return;
  }

  try {
    const data = await api.getGuildEmotes(guildId);
    const allEmotes: EmoteItem[] = [
      ...(data.twitch || []).map((e) => ({ ...e, source: "twitch" })),
      ...(data.seventv || []).map((e) => ({ ...e, source: "seventv" })),
      ...(data.bttv || []).map((e) => ({ ...e, source: "bttv" })),
      ...(data.ffz || []).map((e) => ({ ...e, source: "ffz" })),
      ...(data.twitchGlobal || []).map((e) => ({ ...e, source: "twitch_global" })),
      ...(data.seventvGlobal || []).map((e) => ({ ...e, source: "seventv_global" })),
      ...(data.bttvGlobal || []).map((e) => ({ ...e, source: "bttv_global" })),
    ];

    const secs: EmoteSection[] = [
      { id: "recent", label: "Recently Used", icon: "🕐", emotes: getRecent() },
    ];
    const name = guildName || "Channel";
    if (data.twitch?.length) secs.push({ id: "twitch", label: `${name} — Twitch`, icon: "📺", emotes: allEmotes.filter((e) => e.source === "twitch") });
    if (data.seventv?.length) secs.push({ id: "seventv", label: `${name} — 7TV`, icon: "7️⃣", emotes: allEmotes.filter((e) => e.source === "seventv") });
    if (data.bttv?.length) secs.push({ id: "bttv", label: `${name} — BTTV`, icon: "🅱️", emotes: allEmotes.filter((e) => e.source === "bttv") });
    if (data.ffz?.length) secs.push({ id: "ffz", label: `${name} — FFZ`, icon: "😎", emotes: allEmotes.filter((e) => e.source === "ffz") });
    if (data.twitchGlobal?.length) secs.push({ id: "twitch_global", label: "Twitch Global", icon: "🌐", emotes: allEmotes.filter((e) => e.source === "twitch_global") });
    if (data.seventvGlobal?.length) secs.push({ id: "seventv_global", label: "7TV Global", icon: "7️⃣", emotes: allEmotes.filter((e) => e.source === "seventv_global") });
    if (data.bttvGlobal?.length) secs.push({ id: "bttv_global", label: "BTTV Global", icon: "🅱️", emotes: allEmotes.filter((e) => e.source === "bttv_global") });
    secs.push({ id: "emoji", label: "Emoji", icon: "😀", emotes: UNICODE_EMOJIS.map((e) => ({ name: e, url: "", source: "emoji" })) });

    emoteCache.set(guildId, { data: secs, ts: Date.now() });

    for (const e of allEmotes) {
      if (e.url) emoteLookup.set(e.name, e.url);
    }
  } catch {
    // Silently fail — emotes will just show as text
  }
}

export default function EmotePicker({ x, y, onSelect, onClose }: EmotePickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [sections, setSections] = useState<EmoteSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("recent");
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const guilds = useGuildStore((s) => s.guilds);
  const emotesReady = useGuildStore((s) => s.emotesReady);
  const userTier = useAuthStore((s) => s.user?.tier) || "free";

  // Position
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const W = 380, H = 440;
    let left = x, top = y - H;
    if (left + W > window.innerWidth) left = window.innerWidth - W - 8;
    if (top < 8) top = y + 24;
    if (left < 8) left = 8;
    setPos({ left, top });
  }, [x, y]);

  // Click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 10);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [onClose]);

  // Build sections from ALL guilds' cached emotes
  useEffect(() => {
    const secs: EmoteSection[] = [
      { id: "recent", label: "Recently Used", icon: "🕐", emotes: getRecent() },
    ];

    const isPremium = userTier === "nexe" || userTier === "nexe_plus";

    // Current guild emotes first (always usable)
    if (activeGuildId) {
      const cached = emoteCache.get(activeGuildId);
      if (cached) {
        for (const sec of cached.data) {
          if (sec.id !== "recent" && sec.id !== "emoji" && sec.emotes.length > 0) {
            secs.push(sec);
          }
        }
      }
    }

    // Other guilds' emotes (locked for free, unlocked for premium)
    for (const guild of guilds) {
      if (guild.id === activeGuildId) continue;
      const cached = emoteCache.get(guild.id);
      if (!cached) continue;
      const channelEmotes: EmoteItem[] = [];
      for (const sec of cached.data) {
        if (sec.id === "recent" || sec.id === "emoji" || sec.id.includes("global")) continue;
        for (const e of sec.emotes) {
          channelEmotes.push({ ...e, locked: !isPremium, guildName: guild.name });
        }
      }
      if (channelEmotes.length > 0) {
        secs.push({
          id: `other-${guild.id}`,
          label: isPremium ? guild.name : `${guild.name} 🔒`,
          icon: "📺",
          emotes: channelEmotes,
        });
      }
    }

    // Global emotes (always usable — take from any cached guild)
    const anyCache = activeGuildId ? emoteCache.get(activeGuildId) : emoteCache.values().next().value;
    if (anyCache) {
      for (const sec of anyCache.data) {
        if (sec.id.includes("global") && sec.emotes.length > 0 && !secs.some((s) => s.id === sec.id)) {
          secs.push(sec);
        }
      }
    }

    // Unicode emoji
    secs.push({ id: "emoji", label: "Emoji", icon: "😀", emotes: UNICODE_EMOJIS.map((e) => ({ name: e, url: "", source: "emoji" })) });

    setSections(secs);
    setLoading(false);
  }, [activeGuildId, guilds, userTier, emotesReady]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return sections;
    const q = search.toLowerCase();
    return sections
      .map((s) => ({
        ...s,
        emotes: s.emotes.filter((e) => e.name.toLowerCase().includes(q)),
      }))
      .filter((s) => s.emotes.length > 0);
  }, [sections, search]);

  function handleSelect(emote: EmoteItem) {
    if (emote.locked) {
      // Could show a tooltip/toast — for now just ignore
      return;
    }
    if (emote.source === "emoji") {
      onSelect(emote.name);
    } else {
      onSelect(`:${emote.name}:`);
    }
    saveRecent(emote);
    // Update recent section in current state
    setSections((prev) =>
      prev.map((s) => s.id === "recent" ? { ...s, emotes: getRecent() } : s)
    );
  }

  function scrollToSection(id: string) {
    setActiveTab(id);
    const el = document.getElementById(`emote-section-${id}`);
    if (el && scrollRef.current) {
      scrollRef.current.scrollTo({ top: el.offsetTop - scrollRef.current.offsetTop - 8, behavior: "smooth" });
    }
  }

  // Tab icons for bottom bar
  const tabs = sections.filter((s) => s.emotes.length > 0 || s.id === "recent");

  return (
    <div
      ref={pickerRef}
      className="fixed z-50 flex w-[380px] flex-col overflow-hidden rounded-xl border border-dark-700 bg-dark-900 shadow-2xl animate-scale-in"
      style={{ left: pos.left, top: pos.top, height: 440 }}
    >
      {/* Search */}
      <div className="shrink-0 border-b border-dark-700 px-3 py-2">
        <div className="flex items-center gap-2 rounded-md bg-dark-800 px-3 py-1.5">
          <svg className="h-4 w-4 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search emotes..."
            className="flex-1 bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
            autoFocus
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-slate-500 hover:text-slate-300">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Emote grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-nexe-500 border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No emotes found</p>
        ) : (
          filtered.map((section) => (
            <div key={section.id} id={`emote-section-${section.id}`} className="mb-2">
              <p className="sticky top-0 z-10 bg-dark-900 px-1 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {section.icon} {section.label}
                <span className="ml-1 text-slate-600">({section.emotes.length})</span>
              </p>
              <div className="grid grid-cols-8 gap-0.5">
                {section.emotes.map((emote, i) => (
                  <button
                    key={`${emote.source}-${emote.name}-${i}`}
                    onClick={() => handleSelect(emote)}
                    disabled={emote.locked}
                    className={`group relative flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
                      emote.locked
                        ? "cursor-not-allowed opacity-40"
                        : "hover:bg-dark-700"
                    }`}
                    title={emote.source === "emoji" ? emote.name : `:${emote.name}: (${emote.source})`}
                  >
                    {emote.source === "emoji" ? (
                      <span className="text-xl">{emote.name}</span>
                    ) : (
                      <img
                        src={emote.url}
                        alt={emote.name}
                        className="h-7 w-7 object-contain"
                        loading="lazy"
                      />
                    )}
                    {emote.locked && (
                      <div className="absolute bottom-0 right-0 flex h-3 w-3 items-center justify-center rounded-full bg-dark-900 text-slate-500">
                        <svg className="h-2 w-2" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Tab bar */}
      <div className="flex shrink-0 items-center gap-0.5 border-t border-dark-700 px-2 py-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => scrollToSection(tab.id)}
            className={`flex h-7 w-7 items-center justify-center rounded-md text-sm transition-colors ${
              activeTab === tab.id ? "bg-dark-700 text-white" : "text-slate-500 hover:bg-dark-800 hover:text-slate-300"
            }`}
            title={tab.label}
          >
            {tab.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
