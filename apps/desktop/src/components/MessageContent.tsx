import { useState, useEffect } from "react";
import { emoteLookup } from "./EmotePicker";
import { api } from "../lib/api";

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
  type: "image" | "video" | "youtube" | "twitch-clip" | "gif" | "link";
  url: string;
  embedId?: string;
}

// ---- Parse message content ----

function parseContent(text: string, usernames?: Record<string, string>, currentUserId?: string): { segments: React.ReactNode[]; embeds: MediaEmbed[] } {
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

      // Regular link — show as clickable + queue for preview
      embeds.push({ type: "link", url });
      return (
        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="text-nexe-400 hover:underline break-all">
          {url}
        </a>
      );
    }

    // Text segments — parse markdown + emotes
    if (!part) return null;
    return parseMarkdownAndEmotes(part, i, usernames, currentUserId);
  });

  return { segments: segments.filter(Boolean), embeds };
}

function parseMarkdownAndEmotes(text: string, keyBase: number, usernames?: Record<string, string>, currentUserId?: string): React.ReactNode {
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
        const isSelfMention = currentUserId && m[1] === currentUserId;
        parts.push(
          <span
            key={`${keyBase}-md-${key++}`}
            className={`rounded px-1 font-medium cursor-pointer ${
              isSelfMention
                ? "bg-nexe-500/30 text-nexe-300 hover:bg-nexe-500/40"
                : "bg-nexe-500/20 text-nexe-400 hover:bg-nexe-500/30"
            }`}
          >
            @{mentionName}
          </span>
        );
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
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/80"
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

// ---- Link Preview ----

interface UnfurlData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

const unfurlCache = new Map<string, UnfurlData | null>();

// Derive MP4 URL from Twitch thumbnail URL
// Thumbnail: https://clips-media-assets2.twitch.tv/AT-cm|123-preview-480x272.jpg
// Video:     https://clips-media-assets2.twitch.tv/AT-cm|123.mp4
function deriveVideoUrl(thumbnailUrl: string): string | null {
  const idx = thumbnailUrl.indexOf("-preview-");
  if (idx !== -1) return thumbnailUrl.substring(0, idx) + ".mp4";
  return null;
}

function TwitchClipPlayer({ clipId, url }: { clipId: string; url: string }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [clipData, setClipData] = useState<{ title?: string; broadcaster_name?: string; thumbnail_url?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchClip() {
      try {
        // Step 1: Try the API
        const data = await api.getTwitchClip(clipId);

        if (cancelled) return;

        if (data?.video_url) {
          setVideoUrl(data.video_url as string);
          setClipData(data as { title?: string; broadcaster_name?: string; thumbnail_url?: string });
          setLoading(false);
          return;
        }

        // Step 2: API returned data but no video_url — derive from thumbnail
        if (data?.thumbnail_url) {
          const derived = deriveVideoUrl(data.thumbnail_url as string);
          if (derived) {
            setVideoUrl(derived);
            setClipData(data as { title?: string; broadcaster_name?: string; thumbnail_url?: string });
            setLoading(false);
            return;
          }
        }
      } catch {
        // API failed entirely
      }

      if (cancelled) return;

      // Step 3: API failed — try unfurl to get og:image thumbnail → derive MP4
      try {
        const clipUrl = url.includes("clips.twitch.tv")
          ? url
          : `https://clips.twitch.tv/${clipId}`;
        const unfurled = await api.unfurl(clipUrl);

        if (cancelled) return;

        if (unfurled?.image) {
          const derived = deriveVideoUrl(unfurled.image);
          if (derived) {
            setVideoUrl(derived);
            setClipData({ title: unfurled.title, thumbnail_url: unfurled.image });
            setLoading(false);
            return;
          }
        }
      } catch {
        // Unfurl also failed
      }

      if (cancelled) return;
      setLoading(false);
    }

    setLoading(true);
    fetchClip();
    return () => { cancelled = true; };
  }, [clipId, url, retryCount]);

  const twitchIcon = <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><path d="M11.64 5.93h1.43v4.28h-1.43m3.93-4.28H17v4.28h-1.43M7 2L3.43 5.57v12.86h4.28V22l3.58-3.57h2.85L20.57 12V2m-1.43 9.29l-2.85 2.85h-2.86l-2.5 2.5v-2.5H7.71V3.43h11.43z" /></svg>;

  // Loading
  if (loading) {
    return (
      <div className="w-[640px] max-w-full overflow-hidden rounded border-l-4 border-l-purple-500 bg-dark-800">
        <div className="flex items-center justify-center bg-dark-900" style={{ aspectRatio: "16/9" }}>
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-dark-600 border-t-purple-500" />
        </div>
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-purple-400">
            {twitchIcon}
            Twitch
          </div>
          <p className="mt-1 text-sm text-slate-500">Loading clip...</p>
        </div>
      </div>
    );
  }

  // Both API and unfurl failed — show retry (no iframe, no external link)
  if (!videoUrl) {
    return (
      <div className="w-[640px] max-w-full overflow-hidden rounded border-l-4 border-l-purple-500 bg-dark-800">
        <div className="flex items-center justify-center bg-dark-900" style={{ aspectRatio: "16/9" }}>
          <button
            onClick={() => setRetryCount((c) => c + 1)}
            className="flex flex-col items-center gap-3 group"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-600 shadow-lg group-hover:bg-purple-500 transition-colors">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" /></svg>
            </div>
            <span className="text-sm text-slate-400 group-hover:text-slate-200 transition-colors">Retry loading clip</span>
          </button>
        </div>
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-purple-400">
            {twitchIcon}
            Twitch
          </div>
          <a href={url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block text-sm font-medium text-nexe-400 hover:underline truncate">
            {clipData?.title || "Twitch Clip"}
          </a>
        </div>
      </div>
    );
  }

  // Success: native video player — always, no iframe
  return (
    <div className="w-[640px] max-w-full overflow-hidden rounded border-l-4 border-l-purple-500 bg-dark-800">
      <video
        src={videoUrl}
        controls
        preload="metadata"
        className="block w-full"
        poster={clipData?.thumbnail_url}
      />
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] text-purple-400">
          {twitchIcon}
          Twitch
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block text-sm font-medium text-nexe-400 hover:underline truncate">
          {clipData?.title || "Twitch Clip"}
        </a>
        {clipData?.broadcaster_name && (
          <p className="mt-0.5 text-xs text-slate-500">{clipData.broadcaster_name}</p>
        )}
      </div>
    </div>
  );
}

function YouTubeEmbed({ videoId, url }: { videoId: string; url: string }) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="w-[640px] max-w-full overflow-hidden rounded border-l-4 border-l-red-600 bg-dark-800">
      {playing ? (
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="block w-full"
          style={{ border: 0, aspectRatio: "16/9" }}
        />
      ) : (
        <button
          onClick={() => setPlaying(true)}
          className="group relative block w-full"
        >
          <img
            src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
            alt=""
            className="block w-full object-cover"
            style={{ aspectRatio: "16/9" }}
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 shadow-lg group-hover:bg-red-500 transition-colors">
              <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7 fill-white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </button>
      )}
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] text-red-400">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><path d="M21.58 7.19c-.23-.86-.91-1.54-1.77-1.77C18.25 5 12 5 12 5s-6.25 0-7.81.42c-.86.23-1.54.91-1.77 1.77C2 8.75 2 12 2 12s0 3.25.42 4.81c.23.86.91 1.54 1.77 1.77C5.75 19 12 19 12 19s6.25 0 7.81-.42c.86-.23 1.54-.91 1.77-1.77C22 15.25 22 12 22 12s0-3.25-.42-4.81z" /><path d="M10 15.5l5.5-3.5L10 8.5v7z" fill="#fff" /></svg>
          YouTube
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block text-sm font-medium text-nexe-400 hover:underline truncate">
          Watch on YouTube
        </a>
      </div>
    </div>
  );
}

function LinkPreview({ url }: { url: string }) {
  const [data, setData] = useState<UnfurlData | null>(unfurlCache.get(url) ?? null);
  const [loaded, setLoaded] = useState(unfurlCache.has(url));

  useEffect(() => {
    if (unfurlCache.has(url)) return;
    let cancelled = false;
    api.unfurl(url).then((d) => {
      if (cancelled) return;
      const result = d && d.title ? d : null;
      unfurlCache.set(url, result);
      setData(result);
      setLoaded(true);
    }).catch(() => {
      unfurlCache.set(url, null);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [url]);

  if (!loaded || !data || !data.title) return null;

  const domain = (() => {
    try { return new URL(url).hostname.replace("www.", ""); } catch { return ""; }
  })();

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 flex w-[480px] max-w-full overflow-hidden rounded border-l-4 border-l-dark-600 bg-dark-800 transition-colors hover:brightness-110"
    >
      {data.image && (
        <div className="w-20 shrink-0 bg-dark-900">
          <img
            src={data.image}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      )}
      <div className="min-w-0 flex-1 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          {data.favicon && (
            <img src={data.favicon} alt="" className="h-3 w-3" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}
          <span>{data.siteName || domain}</span>
        </div>
        <p className="mt-0.5 truncate text-sm font-medium text-nexe-400">{data.title}</p>
        {data.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{data.description}</p>
        )}
      </div>
    </a>
  );
}

// ---- Main Component ----

interface MessageContentProps {
  content: string;
  bridgeEmotes?: { id: string; text: string }[];
  usernames?: Record<string, string>;
  currentUserId?: string;
}

export default function MessageContent({ content, bridgeEmotes, usernames, currentUserId }: MessageContentProps) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // If bridge emotes are provided (from Twitch EventSub fragments), use those
  const processedContent = bridgeEmotes
    ? renderBridgeEmotes(content, bridgeEmotes)
    : null;

  const { segments, embeds } = parseContent(content, usernames, currentUserId);

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
                    className="block max-w-[640px] overflow-hidden rounded hover:brightness-110 transition"
                  >
                    <img
                      src={embed.url}
                      alt=""
                      className="max-h-[400px] w-auto rounded object-contain"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  </button>
                );

              case "video":
                return (
                  <div key={i} className="w-[640px] max-w-full overflow-hidden rounded border-l-4 border-l-dark-600 bg-dark-800">
                    <video
                      src={embed.url}
                      controls
                      preload="metadata"
                      className="block w-full max-h-[400px]"
                    />
                  </div>
                );

              case "youtube":
                return <YouTubeEmbed key={i} videoId={embed.embedId!} url={embed.url} />;

              case "twitch-clip":
                return <TwitchClipPlayer key={i} clipId={embed.embedId!} url={embed.url} />;

              case "link":
                return <LinkPreview key={i} url={embed.url} />;

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
