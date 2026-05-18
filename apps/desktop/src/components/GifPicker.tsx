import { useState, useEffect, useRef, useCallback } from "react";
import { api, type GiphyGif } from "../lib/api";


interface GifPickerProps {
  x: number;
  y: number;
  onSelect: (gif: GiphyGif) => void;
  onClose: () => void;
}

export default function GifPicker({ x, y, onSelect, onClose }: GifPickerProps) {
  const [search, setSearch] = useState("");
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const gridRef = useRef<HTMLDivElement>(null);

  const LIMIT = 24;

  const fetchGifs = useCallback(async (q: string, off: number) => {
    setLoading(true);
    try {
      const result = q
        ? await api.searchGifs(q, LIMIT, off)
        : await api.trendingGifs(LIMIT, off);
      // request() auto-unwraps .data — result is GiphyGif[]
      const newGifs = Array.isArray(result) ? result : [];
      if (off > 0) {
        setGifs((prev) => [...prev, ...newGifs]);
      } else {
        setGifs(newGifs);
      }
      setHasMore(newGifs.length >= LIMIT);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load: trending
  useEffect(() => {
    fetchGifs("", 0);
    searchRef.current?.focus();
  }, [fetchGifs]);

  // Debounced search
  useEffect(() => {
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setGifs([]);
      setOffset(0);
      setHasMore(true);
      fetchGifs(search, 0);
    }, 300);
    return () => clearTimeout(searchTimeout.current);
  }, [search, fetchGifs]);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = gridRef.current;
    if (!el || loading || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
      const newOffset = offset + LIMIT;
      setOffset(newOffset);
      fetchGifs(search, newOffset);
    }
  }, [loading, hasMore, offset, search, fetchGifs]);

  function handleSelect(gif: GiphyGif) {
    onSelect(gif);
    onClose();
  }

  // Position: above the button, aligned right
  const style: React.CSSProperties = {
    position: "fixed",
    bottom: window.innerHeight - y,
    right: window.innerWidth - x,
    zIndex: 9999,
  };

  return (
    <div ref={ref} style={style} className="w-[420px] rounded-xl border border-dark-700 bg-dark-900 shadow-2xl shadow-black/40 animate-scale-in">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-dark-800 px-3 py-2.5">
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-nexe-400" fill="currentColor">
          <path d="M11.5 9H13v6h-1.5zM9 9H6c-.6 0-1 .5-1 1v4c0 .5.4 1 1 1h3c.6 0 1-.5 1-1V9zm-.5 4.5h-2v-3h2zm8.5-3c-.3 0-.5.2-.5.5v3c0 .3.2.5.5.5h2c.3 0 .5-.2.5-.5v-1h-1v.5h-1v-2h1v.5h1v-1c0-.6-.5-1-1-1zM2 5v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2zm18 14H4V5h16z"/>
        </svg>
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search GIFs..."
          className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-slate-500 hover:text-white">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M18.3 5.71a1 1 0 0 0-1.42 0L12 10.59 7.12 5.71A1 1 0 0 0 5.7 7.12L10.59 12l-4.88 4.88a1 1 0 1 0 1.42 1.42L12 13.41l4.88 4.88a1 1 0 0 0 1.42-1.42L13.41 12l4.88-4.88a1 1 0 0 0 0-1.41z" />
            </svg>
          </button>
        )}
      </div>

      {/* Grid */}
      <div
        ref={gridRef}
        onScroll={handleScroll}
        className="grid max-h-[340px] grid-cols-3 gap-1 overflow-y-auto p-1"
      >
        {gifs.map((gif) => {
          const preview = gif.images.fixed_height_small || gif.images.fixed_height;
          if (!preview) return null;
          return (
            <button
              key={gif.id}
              onClick={() => handleSelect(gif)}
              className="group relative overflow-hidden rounded-lg bg-dark-800 transition-transform hover:scale-[1.03]"
              title={gif.title}
            >
              <img
                src={preview.url}
                alt={gif.title}
                loading="lazy"
                className="h-[100px] w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-transparent group-hover:ring-nexe-500 transition-all" />
            </button>
          );
        })}

        {loading && (
          <>
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-[100px] animate-pulse rounded-lg bg-dark-800" />
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-dark-800 px-3 py-1.5">
        <span className="text-[10px] text-slate-600">
          {search ? `Results for "${search}"` : "Trending"}
        </span>
        <span className="text-[10px] text-slate-600">Powered by GIPHY</span>
      </div>
    </div>
  );
}
