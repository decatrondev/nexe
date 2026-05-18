import { useState, useEffect, useCallback, useRef } from "react";
import { api, type Guild } from "../lib/api";
import { useGuildStore } from "../stores/guild";
import { toast } from "@nexe/ui";

const CATEGORIES = [
  { id: "", label: "All", emoji: "🌐" },
  { id: "gaming", label: "Gaming", emoji: "🎮" },
  { id: "streaming", label: "Streaming", emoji: "📺" },
  { id: "music", label: "Music", emoji: "🎵" },
  { id: "art", label: "Art & Design", emoji: "🎨" },
  { id: "tech", label: "Tech", emoji: "💻" },
  { id: "education", label: "Education", emoji: "📚" },
  { id: "community", label: "Community", emoji: "🤝" },
  { id: "anime", label: "Anime", emoji: "⛩️" },
];

function fmt(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function gc(id: string) {
  const C = ["#6366f1","#8b5cf6","#a855f7","#d946ef","#ec4899","#f43f5e","#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#06b6d4","#3b82f6"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return C[Math.abs(h) % C.length];
}

export default function DiscoveryPage({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("popular");
  const [selectedTag, setSelectedTag] = useState("");
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [popularTags, setPopularTags] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [joining, setJoining] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  const myGuilds = useGuildStore((s) => s.guilds);
  const setActiveGuild = useGuildStore((s) => s.setActiveGuild);
  const joined = new Set(myGuilds.map((g) => g.id));
  const LIMIT = 24;

  const load = useCallback(async (q: string, cat: string, tag: string, s: string, off: number) => {
    setLoading(true);
    try {
      const r = await api.discoverServers({ q: q || undefined, category: cat || undefined, tag: tag || undefined, sort: s, limit: LIMIT, offset: off });
      setGuilds(r.guilds || []);
      setTotal(r.total);
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(search, category, selectedTag, sort, page * LIMIT); }, [category, selectedTag, sort, page, load]);
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { setPage(0); load(search, category, selectedTag, sort, 0); }, 300);
    return () => clearTimeout(debounce.current);
  }, [search]);
  useEffect(() => { api.discoverTags(20).then(setPopularTags).catch(() => {}); }, []);

  const join = async (id: string) => {
    setJoining(id);
    try {
      await api.joinGuild(id);
      await useGuildStore.getState().loadGuilds();
      toast.success("Joined!");
      setActiveGuild(id);
      onClose();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setJoining(null); }
  };

  const pages = Math.ceil(total / LIMIT);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-dark-950">

      {/* ═══ HERO ═══ */}
      <div className="relative shrink-0 overflow-hidden border-b border-white/5">
        {/* BG layers */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-nexe-600/20 via-indigo-600/10 to-transparent" />
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-nexe-500/8 blur-[100px]" />
          <div className="absolute -left-20 top-10 h-56 w-56 rounded-full bg-purple-500/8 blur-[80px]" />
          <div className="absolute bottom-0 left-1/3 h-40 w-80 rounded-full bg-cyan-500/5 blur-[60px]" />
        </div>

        <div className="relative mx-auto max-w-[1400px] px-10 pb-7 pt-6">
          {/* Row 1: back + search + sort */}
          <div className="mb-6 flex items-center gap-5">
            <button
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.04] text-slate-400 ring-1 ring-white/[0.06] backdrop-blur transition-all hover:bg-white/[0.08] hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
            </button>

            <div className="relative flex-1 max-w-lg">
              <svg viewBox="0 0 24 24" className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search communities..."
                className="h-11 w-full rounded-2xl bg-white/[0.04] pl-11 pr-10 text-[15px] text-white placeholder-slate-500 outline-none ring-1 ring-white/[0.06] backdrop-blur-md transition-all focus:bg-white/[0.07] focus:ring-nexe-500/40"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-1 text-slate-400 hover:text-white">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M18.3 5.71a1 1 0 0 0-1.42 0L12 10.59 7.12 5.71A1 1 0 0 0 5.7 7.12L10.59 12l-4.88 4.88a1 1 0 1 0 1.42 1.42L12 13.41l4.88 4.88a1 1 0 0 0 1.42-1.42L13.41 12l4.88-4.88a1 1 0 0 0 0-1.41z" /></svg>
                </button>
              )}
            </div>

            <div className="flex items-center rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/[0.06]">
              {[{v:"popular",l:"Popular"},{v:"newest",l:"New"},{v:"alphabetical",l:"A–Z"}].map((o) => (
                <button
                  key={o.v}
                  onClick={() => { setSort(o.v); setPage(0); }}
                  className={`rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all ${sort === o.v ? "bg-nexe-500 text-white shadow-lg shadow-nexe-500/30" : "text-slate-500 hover:text-slate-200"}`}
                >{o.l}</button>
              ))}
            </div>
          </div>

          {/* Title */}
          <h1 className="mb-1 text-[28px] font-extrabold tracking-tight text-white">
            Explore servers
          </h1>
          <p className="mb-5 text-[15px] text-slate-400">
            Find communities that match your interests
          </p>

          {/* Categories */}
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => { setCategory(c.id); setPage(0); }}
                className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold transition-all duration-150 ${
                  category === c.id
                    ? "bg-white text-dark-950 shadow-xl shadow-white/10 scale-[1.02]"
                    : "bg-white/[0.05] text-slate-300 ring-1 ring-white/[0.08] hover:bg-white/[0.09] hover:text-white hover:ring-white/[0.15]"
                }`}
              >
                <span className="text-lg leading-none">{c.emoji}</span>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ TAGS + FILTERS ═══ */}
      {(popularTags.length > 0 || selectedTag || search) && (
        <div className="shrink-0 border-b border-white/5 bg-dark-950">
          <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-10 py-2.5">
            {selectedTag && (
              <span className="flex items-center gap-1.5 rounded-full bg-purple-500/15 px-3 py-1 text-xs font-medium text-purple-400 ring-1 ring-purple-500/20">
                #{selectedTag}
                <button onClick={() => setSelectedTag("")} className="opacity-60 hover:opacity-100">&times;</button>
              </span>
            )}
            {!selectedTag && popularTags.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-slate-600">Tags</span>
                {popularTags.map((t) => (
                  <button
                    key={t}
                    onClick={() => { setSelectedTag(t); setPage(0); }}
                    className="shrink-0 rounded-full bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-white/[0.06] transition-all hover:bg-white/[0.08] hover:text-slate-300"
                  >#{t}</button>
                ))}
              </div>
            )}
            {(selectedTag || search) && (
              <button onClick={() => { setSelectedTag(""); setSearch(""); setPage(0); }} className="ml-auto text-[11px] text-slate-600 hover:text-slate-300">Clear filters</button>
            )}
          </div>
        </div>
      )}

      {/* ═══ GRID ═══ */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] px-10 py-6">

          {loading ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="overflow-hidden rounded-2xl bg-white/[0.02] ring-1 ring-white/[0.04]">
                  <div className="h-28 animate-pulse bg-white/[0.03]" />
                  <div className="space-y-2 p-4"><div className="h-4 w-2/3 animate-pulse rounded-lg bg-white/[0.04]" /><div className="h-3 w-full animate-pulse rounded-lg bg-white/[0.03]" /><div className="h-3 w-1/2 animate-pulse rounded-lg bg-white/[0.03]" /></div>
                </div>
              ))}
            </div>
          ) : guilds.length === 0 ? (
            <div className="flex min-h-[400px] items-center justify-center">
              <div className="flex flex-col items-center gap-5 text-center">
                <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-white/[0.03] ring-1 ring-white/[0.06]">
                  <span className="text-5xl">{CATEGORIES.find((c) => c.id === category)?.emoji || "🔍"}</span>
                </div>
                <div>
                  <p className="text-xl font-bold text-slate-200">No servers found</p>
                  <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
                    {search ? `No matches for "${search}". Try different keywords.` : "No public servers here yet — be the first to create one!"}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <p className="mb-4 text-[13px] font-medium text-slate-600">{total} server{total !== 1 && "s"}</p>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {guilds.map((guild) => {
                  const member = joined.has(guild.id);
                  const color = guild.accentColor || gc(guild.id);
                  const active = hovered === guild.id;

                  return (
                    <div
                      key={guild.id}
                      className="group relative flex flex-col overflow-hidden rounded-2xl bg-white/[0.02] ring-1 ring-white/[0.05] transition-all duration-200 hover:bg-white/[0.04] hover:ring-white/[0.12] hover:-translate-y-1 hover:shadow-2xl hover:shadow-black/30"
                      onMouseEnter={() => setHovered(guild.id)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      {/* Banner */}
                      <div className="relative h-28 shrink-0 overflow-hidden">
                        <div className="absolute inset-0" style={{ background: `linear-gradient(145deg, ${color}55, ${color}15 60%, transparent)` }} />
                        <div className="absolute inset-0 bg-gradient-to-t from-dark-950/90 via-dark-950/20 to-transparent" />

                        {guild.isStreamerServer && (
                          <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-purple-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-lg shadow-purple-500/30">
                            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" /></svg>
                            STREAMER
                          </div>
                        )}

                        {/* Member count badge floating on banner */}
                        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-medium text-white/80 backdrop-blur-sm">
                          <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current opacity-70"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          {fmt(guild.memberCount)}
                        </div>
                      </div>

                      {/* Icon overlapping */}
                      <div className="relative z-10 px-4">
                        <div
                          className="-mt-8 flex h-16 w-16 items-center justify-center rounded-[18px] shadow-xl ring-[3px] ring-dark-950 transition-transform duration-200 group-hover:scale-110"
                          style={{ backgroundColor: color }}
                        >
                          {guild.iconUrl ? (
                            <img src={guild.iconUrl} alt="" className="h-16 w-16 rounded-[18px] object-cover" />
                          ) : (
                            <span className="text-xl font-bold text-white/90 select-none">{guild.name.charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex flex-1 flex-col px-4 pb-4 pt-2.5">
                        <h3 className="truncate text-[15px] font-bold text-white">{guild.name}</h3>
                        <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-[12px] leading-relaxed text-slate-500">
                          {guild.description || "A community on Nexe"}
                        </p>

                        {guild.tags && guild.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {guild.tags.slice(0, 3).map((tag) => (
                              <button
                                key={tag}
                                onClick={(e) => { e.stopPropagation(); setSelectedTag(tag); setPage(0); }}
                                className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-white/[0.06] transition-colors hover:bg-nexe-500/10 hover:text-nexe-400 hover:ring-nexe-500/20"
                              >#{tag}</button>
                            ))}
                          </div>
                        )}

                        {/* Join button — bottom */}
                        <div className="mt-auto pt-4">
                          {member ? (
                            <button
                              onClick={() => { setActiveGuild(guild.id); onClose(); }}
                              className="w-full rounded-xl bg-white/[0.05] py-2.5 text-[13px] font-semibold text-slate-300 ring-1 ring-white/[0.08] transition-all hover:bg-white/[0.1] hover:text-white"
                            >Visit Server</button>
                          ) : (
                            <button
                              onClick={() => join(guild.id)}
                              disabled={joining === guild.id}
                              className={`w-full rounded-xl py-2.5 text-[13px] font-semibold text-white transition-all disabled:opacity-50 ${
                                active
                                  ? "bg-nexe-500 shadow-lg shadow-nexe-500/30"
                                  : "bg-nexe-600 hover:bg-nexe-500 hover:shadow-lg hover:shadow-nexe-500/25"
                              }`}
                            >
                              {joining === guild.id ? (
                                <span className="flex items-center justify-center gap-2">
                                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                  Joining...
                                </span>
                              ) : "Join Server"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {pages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="flex h-9 items-center gap-1.5 rounded-xl bg-white/[0.04] px-4 text-[13px] font-medium text-slate-400 ring-1 ring-white/[0.06] transition-all hover:bg-white/[0.08] hover:text-white disabled:opacity-25"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7" /></svg>
                    Prev
                  </button>
                  {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
                    const p = pages <= 7 ? i : Math.max(0, Math.min(page - 3, pages - 7)) + i;
                    return (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={`flex h-9 w-9 items-center justify-center rounded-xl text-[13px] font-semibold transition-all ${
                          page === p ? "bg-nexe-500 text-white shadow-lg shadow-nexe-500/25" : "text-slate-500 hover:bg-white/[0.05] hover:text-white"
                        }`}
                      >{p + 1}</button>
                    );
                  })}
                  <button
                    onClick={() => setPage(Math.min(pages - 1, page + 1))}
                    disabled={page >= pages - 1}
                    className="flex h-9 items-center gap-1.5 rounded-xl bg-white/[0.04] px-4 text-[13px] font-medium text-slate-400 ring-1 ring-white/[0.06] transition-all hover:bg-white/[0.08] hover:text-white disabled:opacity-25"
                  >
                    Next
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 5l7 7-7 7" /></svg>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
