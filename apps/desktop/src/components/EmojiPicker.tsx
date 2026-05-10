import { useEffect, useRef, useState, useMemo } from "react";

interface EmojiPickerProps {
  x: number;
  y: number;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

interface EmojiCategory {
  id: string;
  icon: string;
  label: string;
  emojis: string[];
}

const STORAGE_KEY = "nexe_recent_emojis";
const MAX_RECENT = 16;

function getRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function saveRecentEmoji(emoji: string) {
  const recent = getRecentEmojis().filter((e) => e !== emoji);
  recent.unshift(emoji);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    icon: "\u{1F600}",
    label: "Smileys",
    emojis: ["\u{1F600}","\u{1F603}","\u{1F604}","\u{1F601}","\u{1F606}","\u{1F605}","\u{1F923}","\u{1F602}","\u{1F642}","\u{1F60A}","\u{1F607}","\u{1F970}","\u{1F60D}","\u{1F929}","\u{1F618}","\u{1F617}","\u{1F61A}","\u{1F619}","\u{1F972}","\u{1F60B}","\u{1F61B}","\u{1F61C}","\u{1F92A}","\u{1F61D}","\u{1F911}","\u{1F917}","\u{1F92D}","\u{1F92B}","\u{1F914}","\u{1FAE1}","\u{1F910}","\u{1F928}","\u{1F610}","\u{1F611}","\u{1F636}","\u{1FAE5}","\u{1F60F}","\u{1F612}","\u{1F644}","\u{1F62C}","\u{1FAE0}","\u{1F925}","\u{1F60C}","\u{1F614}","\u{1F62A}","\u{1F924}","\u{1F634}","\u{1F637}","\u{1F912}","\u{1F915}","\u{1F922}","\u{1F92E}","\u{1F974}","\u{1F635}","\u{1F92F}","\u{1F976}","\u{1F975}","\u{1F621}","\u{1F624}","\u{1F620}","\u{1F92C}","\u{1F608}","\u{1F47F}","\u{1F480}","\u2620\uFE0F","\u{1F4A9}","\u{1F921}","\u{1F479}","\u{1F47A}","\u{1F47B}","\u{1F47D}","\u{1F47E}","\u{1F916}"],
  },
  {
    id: "people",
    icon: "\u{1F44B}",
    label: "People",
    emojis: ["\u{1F44B}","\u{1F91A}","\u{1F590}\uFE0F","\u270B","\u{1F596}","\u{1F44C}","\u{1F90C}","\u{1F90F}","\u270C\uFE0F","\u{1F91E}","\u{1FAF0}","\u{1F91F}","\u{1F918}","\u{1F919}","\u{1F448}","\u{1F449}","\u{1F446}","\u{1F595}","\u{1F447}","\u261D\uFE0F","\u{1FAF5}","\u{1F44D}","\u{1F44E}","\u270A","\u{1F44A}","\u{1F91B}","\u{1F91C}","\u{1F44F}","\u{1F64C}","\u{1FAF6}","\u{1F450}","\u{1F932}","\u{1F91D}","\u{1F64F}","\u{1F4AA}","\u{1F9BE}","\u{1F9B5}","\u{1F9B6}","\u{1F442}","\u{1F9BB}","\u{1F443}","\u{1F9E0}","\u{1FAC0}","\u{1FAC1}","\u{1F9B7}","\u{1F9B4}","\u{1F440}","\u{1F441}\uFE0F","\u{1F445}","\u{1F444}"],
  },
  {
    id: "animals",
    icon: "\u{1F436}",
    label: "Animals",
    emojis: ["\u{1F436}","\u{1F431}","\u{1F42D}","\u{1F439}","\u{1F430}","\u{1F98A}","\u{1F43B}","\u{1F43C}","\u{1F43B}\u200D\u2744\uFE0F","\u{1F428}","\u{1F42F}","\u{1F981}","\u{1F42E}","\u{1F437}","\u{1F438}","\u{1F435}","\u{1F648}","\u{1F649}","\u{1F64A}","\u{1F414}","\u{1F427}","\u{1F426}","\u{1F424}","\u{1F986}","\u{1F985}","\u{1F989}","\u{1F987}","\u{1F43A}","\u{1F417}","\u{1F434}","\u{1F984}","\u{1F41D}","\u{1FAB1}","\u{1F41B}","\u{1F98B}","\u{1F40C}","\u{1F41E}","\u{1F41C}","\u{1FAB0}","\u{1FAB2}","\u{1FAB3}","\u{1F99F}","\u{1F997}","\u{1F577}\uFE0F","\u{1F982}","\u{1F422}","\u{1F40D}","\u{1F98E}","\u{1F996}","\u{1F995}","\u{1F419}","\u{1F991}","\u{1F990}","\u{1F99E}","\u{1F980}","\u{1F421}","\u{1F420}","\u{1F41F}","\u{1F42C}","\u{1F433}","\u{1F40B}","\u{1F988}","\u{1F40A}"],
  },
  {
    id: "food",
    icon: "\u{1F355}",
    label: "Food",
    emojis: ["\u{1F34E}","\u{1F350}","\u{1F34A}","\u{1F34B}","\u{1F34C}","\u{1F349}","\u{1F347}","\u{1F353}","\u{1FAD0}","\u{1F348}","\u{1F352}","\u{1F351}","\u{1F96D}","\u{1F34D}","\u{1F965}","\u{1F95D}","\u{1F345}","\u{1F346}","\u{1F951}","\u{1F966}","\u{1F96C}","\u{1F952}","\u{1F336}\uFE0F","\u{1FAD1}","\u{1F33D}","\u{1F955}","\u{1F9C4}","\u{1F9C5}","\u{1F954}","\u{1F360}","\u{1F950}","\u{1F35E}","\u{1F956}","\u{1F968}","\u{1F9C0}","\u{1F95A}","\u{1F373}","\u{1F9C8}","\u{1F95E}","\u{1F9C7}","\u{1F953}","\u{1F969}","\u{1F357}","\u{1F356}","\u{1F32D}","\u{1F354}","\u{1F35F}","\u{1F355}","\u{1FAD3}","\u{1F96A}","\u{1F32E}","\u{1F32F}","\u{1FAD4}","\u{1F959}","\u{1F9C6}","\u{1F35D}","\u{1F35C}","\u{1F372}","\u{1F35B}","\u{1F363}","\u{1F371}","\u{1F95F}","\u{1F9AA}","\u{1F364}","\u{1F359}","\u{1F35A}","\u{1F358}","\u{1F365}","\u{1F96E}","\u{1F361}","\u{1F9C1}","\u{1F370}","\u{1F382}","\u{1F36E}","\u{1F36D}","\u{1F36C}","\u{1F36B}","\u{1F369}","\u{1F36A}","\u{1F330}","\u{1F95C}","\u{1F36F}"],
  },
  {
    id: "activities",
    icon: "\u26BD",
    label: "Activities",
    emojis: ["\u26BD","\u{1F3C0}","\u{1F3C8}","\u26BE","\u{1F94E}","\u{1F3BE}","\u{1F3D0}","\u{1F3C9}","\u{1F94F}","\u{1F3B1}","\u{1FA80}","\u{1F3D3}","\u{1F3F8}","\u{1F3D2}","\u{1F945}","\u26F3","\u{1FA81}","\u{1F3F9}","\u{1F3A3}","\u{1F93F}","\u{1F94A}","\u{1F94B}","\u{1F3BD}","\u{1F6F9}","\u{1F6FC}","\u{1F6F7}","\u26F8\uFE0F","\u{1F94C}","\u{1F3BF}","\u26F7\uFE0F","\u{1F3C2}","\u{1FA82}","\u{1F3CB}\uFE0F","\u{1F93C}","\u{1F938}","\u{1F93A}","\u26F9\uFE0F","\u{1F93E}","\u{1F3CC}\uFE0F","\u{1F3C7}","\u{1F9D8}","\u{1F3C4}","\u{1F3CA}","\u{1F93D}","\u{1F6A3}","\u{1F9D7}","\u{1F6B4}","\u{1F3C6}","\u{1F947}","\u{1F948}","\u{1F949}","\u{1F3C5}","\u{1F396}\uFE0F","\u{1F3AE}","\u{1F579}\uFE0F","\u{1F3B2}","\u{1F3AF}","\u{1F3B3}","\u{1F3AA}","\u{1F3AD}","\u{1F3A8}","\u{1F3AC}","\u{1F3A4}","\u{1F3A7}","\u{1F3BC}","\u{1F3B9}","\u{1F941}","\u{1F3B7}","\u{1F3BA}","\u{1FA97}","\u{1F3B8}","\u{1F3BB}"],
  },
  {
    id: "travel",
    icon: "\u{1F30D}",
    label: "Travel",
    emojis: ["\u{1F697}","\u{1F695}","\u{1F699}","\u{1F68C}","\u{1F68E}","\u{1F3CE}\uFE0F","\u{1F693}","\u{1F691}","\u{1F692}","\u{1F690}","\u{1F6FB}","\u{1F69A}","\u{1F69B}","\u{1F69C}","\u{1F3CD}\uFE0F","\u{1F6F5}","\u{1F6B2}","\u{1F6F4}","\u{1F68F}","\u{1F6E3}\uFE0F","\u{1F6E4}\uFE0F","\u26FD","\u{1F6A8}","\u{1F6A5}","\u{1F6A6}","\u{1F6D1}","\u{1F6A7}","\u2693","\u26F5","\u{1F6F6}","\u{1F6A4}","\u{1F6F3}\uFE0F","\u26F4\uFE0F","\u{1F6E5}\uFE0F","\u{1F6A2}","\u2708\uFE0F","\u{1F6E9}\uFE0F","\u{1F6EB}","\u{1F6EC}","\u{1FA82}","\u{1F4BA}","\u{1F681}","\u{1F69F}","\u{1F6A0}","\u{1F6A1}","\u{1F6F0}\uFE0F","\u{1F680}","\u{1F30D}","\u{1F30E}","\u{1F30F}","\u{1F5FA}\uFE0F","\u{1F3D4}\uFE0F","\u26F0\uFE0F","\u{1F30B}","\u{1F5FB}","\u{1F3D5}\uFE0F","\u{1F3D6}\uFE0F","\u{1F3DC}\uFE0F","\u{1F3DD}\uFE0F","\u{1F3DE}\uFE0F"],
  },
  {
    id: "objects",
    icon: "\u{1F4A1}",
    label: "Objects",
    emojis: ["\u{1F4A1}","\u{1F526}","\u{1F56F}\uFE0F","\u{1F4B0}","\u{1F4B5}","\u{1F4B4}","\u{1F4B6}","\u{1F4B7}","\u{1F48E}","\u2696\uFE0F","\u{1F527}","\u{1F528}","\u2692\uFE0F","\u{1F6E0}\uFE0F","\u26CF\uFE0F","\u{1FA93}","\u{1F529}","\u2699\uFE0F","\u{1F5DC}\uFE0F","\u{1F4A3}","\u{1F52B}","\u{1FA83}","\u{1F3F9}","\u{1F6E1}\uFE0F","\u{1FA9A}","\u{1F511}","\u{1F5DD}\uFE0F","\u{1F6AA}","\u{1FA91}","\u{1F6CB}\uFE0F","\u{1F6CF}\uFE0F","\u{1FA9E}","\u{1FA9F}","\u{1F4F1}","\u{1F4BB}","\u2328\uFE0F","\u{1F5A5}\uFE0F","\u{1F5A8}\uFE0F","\u{1F5B1}\uFE0F","\u{1F4F7}","\u{1F4F8}","\u{1F4F9}","\u{1F3A5}","\u{1F4FA}","\u{1F4FB}","\u{1F399}\uFE0F","\u{1F39A}\uFE0F","\u{1F39B}\uFE0F","\u23F0","\u231A","\u{1F4E1}","\u{1F50B}","\u{1F50C}","\u{1F4BE}","\u{1F4BF}","\u{1F4C0}"],
  },
  {
    id: "symbols",
    icon: "\u2764\uFE0F",
    label: "Symbols",
    emojis: ["\u2764\uFE0F","\u{1F9E1}","\u{1F49B}","\u{1F49A}","\u{1F499}","\u{1F49C}","\u{1F5A4}","\u{1F90D}","\u{1F90E}","\u{1F494}","\u2764\uFE0F\u200D\u{1F525}","\u2764\uFE0F\u200D\u{1FA79}","\u2763\uFE0F","\u{1F495}","\u{1F49E}","\u{1F493}","\u{1F497}","\u{1F496}","\u{1F498}","\u{1F49D}","\u{1F49F}","\u262E\uFE0F","\u271D\uFE0F","\u262A\uFE0F","\u{1F549}\uFE0F","\u2638\uFE0F","\u2721\uFE0F","\u{1F52F}","\u{1F54E}","\u262F\uFE0F","\u2626\uFE0F","\u{1F6D0}","\u26CE","\u2648","\u2649","\u264A","\u264B","\u264C","\u264D","\u264E","\u264F","\u2650","\u2651","\u2652","\u2653","\u{1F194}","\u269B\uFE0F","\u2705","\u2611\uFE0F","\u2714\uFE0F","\u274C","\u274E","\u2795","\u2796","\u2797","\u2716\uFE0F","\u267E\uFE0F","\u203C\uFE0F","\u2049\uFE0F","\u2753","\u2754","\u2755","\u2757","\u3030\uFE0F","\u00A9\uFE0F","\u00AE\uFE0F","\u2122\uFE0F","\u{1F530}","\u2B55","\u2733\uFE0F","\u2747\uFE0F","\u{1F534}","\u{1F7E0}","\u{1F7E1}","\u{1F7E2}","\u{1F535}","\u{1F7E3}","\u26AB","\u26AA","\u{1F7E4}","\u{1F53A}","\u{1F53B}","\u{1F538}","\u{1F539}","\u{1F536}","\u{1F537}","\u{1F4A0}","\u{1F518}","\u{1F533}","\u{1F532}"],
  },
];

// Simple emoji name lookup for tooltips
const EMOJI_NAMES: Record<string, string> = {
  "\u{1F600}": "grinning", "\u{1F603}": "smiley", "\u{1F604}": "smile", "\u{1F601}": "grin",
  "\u{1F606}": "laughing", "\u{1F605}": "sweat smile", "\u{1F923}": "rofl", "\u{1F602}": "joy",
  "\u{1F642}": "slightly smiling", "\u{1F60A}": "blush", "\u{1F607}": "innocent", "\u{1F970}": "smiling with hearts",
  "\u{1F60D}": "heart eyes", "\u{1F929}": "star struck", "\u{1F618}": "kissing heart",
  "\u{1F914}": "thinking", "\u{1F60F}": "smirk", "\u{1F644}": "rolling eyes",
  "\u{1F621}": "rage", "\u{1F620}": "angry", "\u{1F92C}": "cursing", "\u{1F608}": "smiling imp",
  "\u{1F480}": "skull", "\u{1F4A9}": "poop", "\u{1F921}": "clown", "\u{1F47B}": "ghost",
  "\u{1F47D}": "alien", "\u{1F916}": "robot", "\u{1F44D}": "thumbs up", "\u{1F44E}": "thumbs down",
  "\u{1F44B}": "wave", "\u{1F44F}": "clap", "\u{1F64F}": "pray", "\u{1F4AA}": "muscle",
  "\u{1F440}": "eyes", "\u2764\uFE0F": "red heart", "\u{1F494}": "broken heart",
  "\u{1F525}": "fire", "\u{1F389}": "party", "\u2705": "check mark",
  "\u274C": "cross mark", "\u{1F4A1}": "light bulb", "\u{1F3AE}": "video game",
  "\u{1F3C6}": "trophy", "\u{1F947}": "gold medal", "\u{1F680}": "rocket",
};

export default function EmojiPicker({ x, y, onSelect, onClose }: EmojiPickerProps) {
  const [activeCategory, setActiveCategory] = useState("smileys");
  const [search, setSearch] = useState("");
  const [recentEmojis, setRecentEmojis] = useState<string[]>(getRecentEmojis);
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [tooltipEmoji, setTooltipEmoji] = useState<string | null>(null);

  // Focus search on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Delay to avoid catching the same click that opened the picker
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", onClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  // Viewport clamping
  const style = useMemo(() => {
    const W = 320;
    const H = 380;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + W > vw - 8) left = vw - W - 8;
    if (left < 8) left = 8;
    if (top + H > vh - 8) top = y - H;
    if (top < 8) top = 8;
    return { left, top, width: W, height: H };
  }, [x, y]);

  // Build categories with recent
  const categories = useMemo(() => {
    const cats: EmojiCategory[] = [];
    if (recentEmojis.length > 0) {
      cats.push({ id: "recent", icon: "\u{1F552}", label: "Recently Used", emojis: recentEmojis });
    }
    cats.push(...EMOJI_CATEGORIES);
    return cats;
  }, [recentEmojis]);

  // Filter by search
  const filteredEmojis = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.trim().toLowerCase();
    const results: string[] = [];
    for (const cat of EMOJI_CATEGORIES) {
      for (const emoji of cat.emojis) {
        const name = EMOJI_NAMES[emoji] || "";
        if (name.includes(q) || emoji.includes(q)) {
          results.push(emoji);
        }
      }
    }
    return results;
  }, [search]);

  function handleSelect(emoji: string) {
    saveRecentEmoji(emoji);
    setRecentEmojis(getRecentEmojis());
    onSelect(emoji);
  }

  // Scroll grid to category section
  function scrollToCategory(catId: string) {
    setActiveCategory(catId);
    setSearch("");
    const el = document.getElementById(`emoji-cat-${catId}`);
    if (el && gridRef.current) {
      gridRef.current.scrollTop = el.offsetTop - gridRef.current.offsetTop;
    }
  }

  const showingSearch = filteredEmojis !== null;

  return (
    <div
      ref={pickerRef}
      className="fixed z-[100] flex flex-col rounded-xl border border-dark-700 bg-dark-900 shadow-2xl"
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Search */}
      <div className="shrink-0 p-2 pb-0">
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search emoji..."
          className="w-full rounded-md bg-dark-800 px-3 py-1.5 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-nexe-500/50"
        />
      </div>

      {/* Category tabs */}
      {!showingSearch && (
        <div className="flex shrink-0 gap-0.5 overflow-x-auto px-2 pt-2 pb-1 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => scrollToCategory(cat.id)}
              className={`shrink-0 rounded-md px-1.5 py-1 text-base transition-colors ${
                activeCategory === cat.id
                  ? "bg-dark-700 ring-1 ring-nexe-500/30"
                  : "hover:bg-dark-800"
              }`}
              title={cat.label}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      {/* Emoji grid */}
      <div ref={gridRef} className="flex-1 overflow-y-auto px-2 pb-2 pt-1 scrollbar-thin">
        {showingSearch ? (
          filteredEmojis.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              No emojis found
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "2px" }}>
              {filteredEmojis.map((emoji, i) => (
                <button
                  key={`${emoji}-${i}`}
                  onClick={() => handleSelect(emoji)}
                  onMouseEnter={() => setTooltipEmoji(emoji)}
                  onMouseLeave={() => setTooltipEmoji(null)}
                  className="flex h-8 w-8 items-center justify-center rounded text-xl transition-colors hover:bg-dark-700"
                  title={EMOJI_NAMES[emoji] || emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )
        ) : (
          categories.map((cat) => (
            <div key={cat.id} id={`emoji-cat-${cat.id}`}>
              <div className="sticky top-0 z-10 bg-dark-900 px-1 py-1 text-xs font-semibold text-slate-500">
                {cat.label}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "2px" }}>
                {cat.emojis.map((emoji, i) => (
                  <button
                    key={`${cat.id}-${emoji}-${i}`}
                    onClick={() => handleSelect(emoji)}
                    onMouseEnter={() => setTooltipEmoji(emoji)}
                    onMouseLeave={() => setTooltipEmoji(null)}
                    className="flex h-8 w-8 items-center justify-center rounded text-xl transition-colors hover:bg-dark-700"
                    title={EMOJI_NAMES[emoji] || emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer bar - shows hovered emoji name */}
      <div className="flex h-7 shrink-0 items-center border-t border-dark-800 px-3">
        {tooltipEmoji ? (
          <span className="truncate text-xs text-slate-400">
            {tooltipEmoji} {EMOJI_NAMES[tooltipEmoji] ? `:${EMOJI_NAMES[tooltipEmoji]}:` : ""}
          </span>
        ) : (
          <span className="text-xs text-slate-600">Hover for preview</span>
        )}
      </div>
    </div>
  );
}
