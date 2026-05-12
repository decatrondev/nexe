import { useState } from "react";
import { emoteLookup } from "./EmotePicker";

// ---- URL Detection ----

const URL_REGEX = /(https?:\/\/[^\s<>"]+)/g;
const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?.*)?$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov)(\?.*)?$/i;
const YOUTUBE_REGEX = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/;
const TWITCH_CLIP_REGEX = /(?:clips\.twitch\.tv\/|twitch\.tv\/\w+\/clip\/)([\w-]+)/;
const TENOR_REGEX = /tenor\.com\/view\//;
const GIPHY_REGEX = /giphy\.com\/gifs\//;

// ---- Twitch Emote Detection ----

// Common global Twitch emotes (subset)
// Real Twitch global emote IDs
const TWITCH_GLOBAL_EMOTES: Record<string, string> = {
  "Kappa": "25",
  "LUL": "425618",
  "Kreygasm": "41",
  "4Head": "354",
  "BibleThump": "86",
  "ResidentSleeper": "245",
  "NotLikeThis": "58765",
  "TriHard": "120232",
  "CoolStoryBob": "123171",
  "HeyGuys": "30259",
  "VoHiYo": "81274",
  "SeemsGood": "64138",
  "WutFace": "28087",
  "DansGame": "33",
  "SwiftRage": "34",
  "PJSalt": "36",
  "MrDestructoid": "28",
  "Jebaited": "114836",
  "PogChamp": "305954156",
  "B)": "7",
  "R)": "14",
  "O_o": "6",
  "<3": "9",
  "FailFish": "360",
  "GlitchCat": "304489309",
  "TwitchLit": "166263",
  "PopCorn": "724216",
  "GunRun": "86010",
  "TBAngel": "143490",
  "BloodTrail": "69",
  "PunchTrees": "47",
  "DBstyle": "73",
  "EarthDay": "959018",
  "TheIlluminati": "145315",
  "PowerUpR": "425688",
  "PowerUpL": "425671",
  "TPFufun": "508650",
  "StinkyCheese": "304489128",
  "FBtouchdown": "626795",
  "TehePelo": "160394",
  "GoldPLNS": "355771",
  "HSCheers": "444572",
};

function getTwitchEmoteURL(id: string, size: "1.0" | "2.0" | "3.0" = "2.0") {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/${size}`;
}

// ---- Types ----

interface MediaEmbed {
  type: "image" | "video" | "youtube" | "twitch-clip" | "gif";
  url: string;
  embedId?: string;
}

// ---- Parse message content ----

function parseContent(text: string, usernames?: Record<string, string>): { segments: React.ReactNode[]; embeds: MediaEmbed[] } {
  const embeds: MediaEmbed[] = [];
  const parts = text.split(URL_REGEX);

  const segments = parts.map((part, i) => {
    // Odd indices are URL matches
    if (i % 2 === 1) {
      const url = part;

      if (IMAGE_EXTENSIONS.test(url)) {
        embeds.push({ type: "image", url });
        return null; // Don't show URL text, show embed instead
      }

      if (VIDEO_EXTENSIONS.test(url)) {
        embeds.push({ type: "video", url });
        return null;
      }

      const ytMatch = url.match(YOUTUBE_REGEX);
      if (ytMatch) {
        embeds.push({ type: "youtube", url, embedId: ytMatch[1] });
        return null;
      }

      const clipMatch = url.match(TWITCH_CLIP_REGEX);
      if (clipMatch) {
        embeds.push({ type: "twitch-clip", url, embedId: clipMatch[1] });
        return null;
      }

      if (TENOR_REGEX.test(url) || GIPHY_REGEX.test(url)) {
        embeds.push({ type: "gif", url });
        return (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="text-nexe-400 hover:underline">
            {url}
          </a>
        );
      }

      // Regular link
      return (
        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="text-nexe-400 hover:underline break-all">
          {url}
        </a>
      );
    }

    // Text segments — parse markdown + emotes
    if (!part) return null;
    return parseMarkdownAndEmotes(part, i, usernames);
  });

  return { segments: segments.filter(Boolean), embeds };
}

function parseMarkdownAndEmotes(text: string, keyBase: number, usernames?: Record<string, string>): React.ReactNode {
  // Process markdown: ```code blocks```, `inline code`, **bold**, *italic*, ~~strikethrough~~, @mentions
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Code block ```...```
    const codeBlockMatch = remaining.match(/```([\s\S]*?)```/);
    if (codeBlockMatch && remaining.indexOf(codeBlockMatch[0]) === 0) {
      parts.push(<pre key={`${keyBase}-cb-${key++}`} className="my-1 rounded bg-dark-900 px-3 py-2 text-xs text-green-400 font-mono whitespace-pre-wrap">{codeBlockMatch[1]}</pre>);
      remaining = remaining.slice(codeBlockMatch[0].length);
      continue;
    }

    // Inline code `...`
    const inlineMatch = remaining.match(/`([^`]+)`/);
    if (inlineMatch && remaining.indexOf(inlineMatch[0]) === 0) {
      parts.push(<code key={`${keyBase}-ic-${key++}`} className="rounded bg-dark-900 px-1.5 py-0.5 text-xs text-orange-300 font-mono">{inlineMatch[1]}</code>);
      remaining = remaining.slice(inlineMatch[0].length);
      continue;
    }

    // Find first markdown pattern
    const patterns = [
      { regex: /```[\s\S]*?```/, type: "codeblock" },
      { regex: /`[^`]+`/, type: "code" },
      { regex: /\*\*(.+?)\*\*/, type: "bold" },
      { regex: /\*(.+?)\*/, type: "italic" },
      { regex: /~~(.+?)~~/, type: "strike" },
      { regex: /<@([a-f0-9-]+)>/, type: "mention" },
    ];

    let earliest = { index: remaining.length, match: null as RegExpMatchArray | null, type: "" };
    for (const p of patterns) {
      const m = remaining.match(p.regex);
      if (m && m.index !== undefined && m.index < earliest.index) {
        earliest = { index: m.index, match: m, type: p.type };
      }
    }

    if (!earliest.match) {
      // No more markdown, parse emotes on remaining text
      parts.push(parseEmotes(remaining, keyBase * 1000 + key++));
      break;
    }

    // Text before the match
    if (earliest.index > 0) {
      parts.push(parseEmotes(remaining.slice(0, earliest.index), keyBase * 1000 + key++));
    }

    const m = earliest.match;
    switch (earliest.type) {
      case "codeblock":
        parts.push(<pre key={`${keyBase}-md-${key++}`} className="my-1 rounded bg-dark-900 px-3 py-2 text-xs text-green-400 font-mono whitespace-pre-wrap">{m[1] || m[0].slice(3, -3)}</pre>);
        break;
      case "code":
        parts.push(<code key={`${keyBase}-md-${key++}`} className="rounded bg-dark-900 px-1.5 py-0.5 text-xs text-orange-300 font-mono">{m[1] || m[0].slice(1, -1)}</code>);
        break;
      case "bold":
        parts.push(<strong key={`${keyBase}-md-${key++}`} className="font-bold text-white">{m[1]}</strong>);
        break;
      case "italic":
        parts.push(<em key={`${keyBase}-md-${key++}`} className="italic">{m[1]}</em>);
        break;
      case "strike":
        parts.push(<s key={`${keyBase}-md-${key++}`} className="text-slate-500 line-through">{m[1]}</s>);
        break;
      case "mention": {
        const mentionName = usernames?.[m[1]] || m[1].slice(0, 8);
        parts.push(<span key={`${keyBase}-md-${key++}`} className="rounded bg-nexe-500/20 px-1 text-nexe-400 font-medium cursor-pointer hover:bg-nexe-500/30">@{mentionName}</span>);
        break;
      }
    }

    remaining = remaining.slice(earliest.index + m[0].length);
  }

  return <span key={keyBase}>{parts}</span>;
}

function parseEmotes(text: string, keyBase: number): React.ReactNode {
  // First pass: resolve :emoteName: syntax from the dynamic emote lookup
  const colonParts = text.split(/:([a-zA-Z0-9_]+):/g);
  const resolved: React.ReactNode[] = [];

  for (let i = 0; i < colonParts.length; i++) {
    if (i % 2 === 1) {
      // This is a potential emote name (between colons)
      const url = emoteLookup.get(colonParts[i]);
      if (url) {
        resolved.push(
          <img
            key={`${keyBase}-ce-${i}`}
            src={url}
            alt={colonParts[i]}
            title={`:${colonParts[i]}:`}
            className="inline-block h-8 align-middle"
            loading="lazy"
          />
        );
        continue;
      }
      // Not found — keep the original text with colons
      resolved.push(`:${colonParts[i]}:`);
      continue;
    }

    // Regular text — only match hardcoded Twitch global emotes as bare words
    // Custom emotes (7TV, BTTV, etc.) require :emote: syntax
    const words = colonParts[i].split(/(\s+)/);
    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      const emoteId = TWITCH_GLOBAL_EMOTES[word];
      if (emoteId) {
        resolved.push(
          <img
            key={`${keyBase}-${i}-${w}`}
            src={getTwitchEmoteURL(emoteId)}
            alt={word}
            title={word}
            className="inline-block h-8 align-middle"
            loading="lazy"
          />
        );
      } else {
        resolved.push(word);
      }
    }
  }

  return <span key={keyBase}>{resolved}</span>;
}

// ---- Lightbox ----

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-dark-800/80 text-slate-300 hover:text-white"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </svg>
      </button>
      <img
        src={src}
        alt=""
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ---- Main Component ----

interface MessageContentProps {
  content: string;
  bridgeEmotes?: { id: string; text: string }[];
  usernames?: Record<string, string>;
}

export default function MessageContent({ content, bridgeEmotes, usernames }: MessageContentProps) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // If bridge emotes are provided (from Twitch EventSub fragments), use those
  const processedContent = bridgeEmotes
    ? renderBridgeEmotes(content, bridgeEmotes)
    : null;

  const { segments, embeds } = parseContent(content, usernames);

  // Check if message is only emotes (for bigger rendering)
  const isOnlyEmotes = /^(\s*:[a-zA-Z0-9_]+:\s*)+$/.test(content.trim());

  return (
    <>
      <p className={`leading-relaxed text-slate-200 break-words ${isOnlyEmotes ? "text-lg [&_img]:h-12 [&_img]:w-12" : "text-sm"}`}>
        {processedContent || segments}
      </p>

      {/* Media embeds */}
      {embeds.length > 0 && (
        <div className="mt-1.5 space-y-2">
          {embeds.map((embed, i) => {
            switch (embed.type) {
              case "image":
                return (
                  <button
                    key={i}
                    onClick={() => setLightboxSrc(embed.url)}
                    className="block overflow-hidden rounded-lg border border-dark-700 hover:border-dark-600 transition-colors"
                  >
                    <img
                      src={embed.url}
                      alt=""
                      className="max-w-[550px] max-h-[400px] object-contain"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  </button>
                );

              case "video":
                return (
                  <div key={i} className="overflow-hidden rounded-lg border border-dark-700">
                    <video
                      src={embed.url}
                      controls
                      preload="metadata"
                      className="max-w-[550px] max-h-[400px]"
                    />
                  </div>
                );

              case "youtube":
                return (
                  <div key={i} className="overflow-hidden rounded-lg border border-dark-700 bg-dark-800">
                    <iframe
                      src={`https://www.youtube.com/embed/${embed.embedId}`}
                      width="550"
                      height="309"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="max-w-full"
                      style={{ border: 0 }}
                    />
                  </div>
                );

              case "twitch-clip":
                return (
                  <div key={i} className="overflow-hidden rounded-lg border border-dark-700 bg-dark-800">
                    <iframe
                      src={`https://clips.twitch.tv/embed?clip=${embed.embedId}&parent=${window.location.hostname}`}
                      width="550"
                      height="309"
                      allowFullScreen
                      className="max-w-full"
                      style={{ border: 0 }}
                    />
                  </div>
                );

              default:
                return null;
            }
          })}
        </div>
      )}

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </>
  );
}

function renderBridgeEmotes(text: string, emotes: { id: string; text: string }[]): React.ReactNode {
  if (!emotes || emotes.length === 0) return null;

  // Build a map of emote text → emote id
  const emoteMap = new Map<string, string>();
  for (const e of emotes) {
    emoteMap.set(e.text, e.id);
  }

  const words = text.split(/(\s+)/);
  const result: React.ReactNode[] = [];

  for (let i = 0; i < words.length; i++) {
    const emoteId = emoteMap.get(words[i]);
    if (emoteId) {
      result.push(
        <img
          key={i}
          src={getTwitchEmoteURL(emoteId)}
          alt={words[i]}
          title={words[i]}
          className="inline-block h-6 align-middle"
          loading="lazy"
        />
      );
    } else {
      result.push(words[i]);
    }
  }

  return <>{result}</>;
}
