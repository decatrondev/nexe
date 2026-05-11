import { useState } from "react";

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
  return `https://static-cdn.jtvnbs.net/emoticons/v2/${id}/default/dark/${size}`;
}

// ---- Types ----

interface MediaEmbed {
  type: "image" | "video" | "youtube" | "twitch-clip" | "gif";
  url: string;
  embedId?: string;
}

// ---- Parse message content ----

function parseContent(text: string): { segments: React.ReactNode[]; embeds: MediaEmbed[] } {
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

    // Text segments — check for Twitch emotes
    if (!part) return null;
    return parseEmotes(part, i);
  });

  return { segments: segments.filter(Boolean), embeds };
}

function parseEmotes(text: string, keyBase: number): React.ReactNode {
  const words = text.split(/(\s+)/);
  const result: React.ReactNode[] = [];

  for (let w = 0; w < words.length; w++) {
    const word = words[w];
    const emoteId = TWITCH_GLOBAL_EMOTES[word];
    if (emoteId) {
      result.push(
        <img
          key={`${keyBase}-${w}`}
          src={getTwitchEmoteURL(emoteId)}
          alt={word}
          title={word}
          className="inline-block h-6 align-middle"
          loading="lazy"
        />
      );
    } else {
      result.push(word);
    }
  }

  return <span key={keyBase}>{result}</span>;
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
}

export default function MessageContent({ content, bridgeEmotes }: MessageContentProps) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // If bridge emotes are provided (from Twitch EventSub fragments), use those
  const processedContent = bridgeEmotes
    ? renderBridgeEmotes(content, bridgeEmotes)
    : null;

  const { segments, embeds } = parseContent(content);

  return (
    <>
      <p className="text-sm leading-relaxed text-slate-200 break-words">
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
