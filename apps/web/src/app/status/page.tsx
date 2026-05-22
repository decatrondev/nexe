"use client";

import { useEffect, useState, useCallback } from "react";

const API = "https://nexeapi.decatron.net";

interface ServiceStatus {
  name: string;
  status: string;
  latencyMs: number;
  uptime24h: number;
  uptime7d: number;
  uptime30d: number;
}

interface HistoryPoint {
  status: string;
  latencyMs: number;
  time: string;
}

interface StatusData {
  services: ServiceStatus[];
  incidents: { id: string; title: string; description: string; status: string; severity: string; createdAt: string; resolvedAt?: string }[];
  overallUp: boolean;
  checkedAt: string;
}

const LABELS: Record<string, string> = {
  gateway: "API Gateway",
  guilds: "Guilds & Servers",
  messaging: "Messaging",
  presence: "Presence",
  voice: "Voice & Video",
  notifications: "Notifications",
};

const ORDER = ["gateway", "guilds", "messaging", "presence", "voice", "notifications"];
const TZ = "America/Lima";

function toDateKey(date: Date): string {
  return date.toLocaleDateString("sv-SE", { timeZone: TZ });
}

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function build90DayGrid(history: HistoryPoint[]): { date: string; status: string; uptime: number; latency: number }[] {
  const days: Record<string, { up: number; total: number; latSum: number }> = {};

  for (let i = 89; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = toDateKey(d);
    days[key] = { up: 0, total: 0, latSum: 0 };
  }

  for (const p of history) {
    const key = toDateKey(new Date(p.time));
    if (days[key]) {
      days[key].total++;
      if (p.status === "up") days[key].up++;
      days[key].latSum += p.latencyMs;
    }
  }

  return Object.entries(days).sort().map(([date, d]) => ({
    date,
    status: d.total === 0 ? "no-data" : d.up === d.total ? "up" : d.up / d.total > 0.95 ? "degraded" : "down",
    uptime: d.total === 0 ? 100 : (d.up / d.total) * 100,
    latency: d.total === 0 ? 0 : Math.round(d.latSum / d.total),
  }));
}

function DayBar({ day, index }: { day: { date: string; status: string; uptime: number; latency: number }; index: number }) {
  const [hover, setHover] = useState(false);
  const colors: Record<string, string> = {
    up: "bg-emerald-500 hover:bg-emerald-400",
    degraded: "bg-yellow-500 hover:bg-yellow-400",
    down: "bg-red-500 hover:bg-red-400",
    "no-data": "bg-white/[0.04] hover:bg-white/[0.08]",
  };

  const d = new Date(day.date + "T12:00:00");
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });

  return (
    <div className="relative flex-1 min-w-0" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div
        className={`h-8 sm:h-9 lg:h-10 w-full rounded-[1px] sm:rounded-sm transition-all duration-100 ${colors[day.status]} ${hover ? "scale-y-125 brightness-125" : ""}`}
        style={{ animationDelay: `${index * 8}ms` }}
      />
      {hover && (
        <div className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-[#111118] px-3 py-2 text-xs shadow-2xl shadow-black/50">
          <p className="font-semibold text-white">{label}</p>
          <p className="text-slate-400">
            {day.status === "no-data" ? "No data" : `${day.uptime.toFixed(2)}% uptime`}
          </p>
          {day.latency > 0 && <p className="text-slate-500">{day.latency}ms avg</p>}
          <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-[#111118]" />
        </div>
      )}
    </div>
  );
}

function Sparkline({ points, width = 120, height = 28 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const step = width / (points.length - 1);
  const path = points.map((p, i) => {
    const x = i * step;
    const y = height - (p / max) * height * 0.85 - 2;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const areaPath = path + ` L${width},${height} L0,${height} Z`;

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(99, 102, 241)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="rgb(99, 102, 241)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sparkGrad)" />
      <path d={path} fill="none" stroke="rgb(99, 102, 241)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function StatusPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [histories, setHistories] = useState<Record<string, HistoryPoint[]>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/status`);
      if (res.ok) setData(await res.json());
    } catch { /* */ }

    for (const svc of ORDER) {
      try {
        const res = await fetch(`${API}/status/history?service=${svc}&hours=2160`);
        if (res.ok) {
          const pts = await res.json();
          setHistories(prev => ({ ...prev, [svc]: pts || [] }));
        }
      } catch { /* */ }
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/status`);
        if (res.ok) setData(await res.json());
      } catch { /* */ }
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  const services = data?.services?.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name)) ?? [];
  const allUp = data?.overallUp ?? true;
  const incidents = data?.incidents ?? [];

  return (
    <div className="min-h-screen bg-[#08080d] text-white antialiased">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className={`absolute inset-0 transition-colors duration-1000 ${allUp ? "bg-gradient-to-b from-emerald-900/[0.06] via-transparent to-transparent" : "bg-gradient-to-b from-red-900/[0.08] via-transparent to-transparent"}`} />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[600px] w-[900px] lg:w-[1200px] rounded-full bg-nexe-500/[0.03] blur-[150px]" />
      </div>

      <div className="relative mx-auto max-w-[720px] md:max-w-3xl lg:max-w-4xl xl:max-w-5xl 2xl:max-w-6xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="flex items-center justify-between pt-8 pb-10 sm:pt-10 sm:pb-12 lg:pt-14 lg:pb-16">
          <a href="https://nexe.decatron.net" className="flex items-center gap-2.5 group">
            <div className="flex h-9 w-9 lg:h-10 lg:w-10 items-center justify-center rounded-xl bg-white/[0.05] ring-1 ring-white/[0.08] transition-all group-hover:ring-nexe-500/30">
              <img src="/logo.png" alt="Nexe" className="h-5 w-5 lg:h-6 lg:w-6" />
            </div>
            <span className="text-[15px] lg:text-base font-bold tracking-tight">Nexe</span>
            <span className="text-[13px] lg:text-sm text-slate-600 font-medium">Status</span>
          </a>
          <div className="flex items-center gap-2 text-[12px] lg:text-[13px] text-slate-600">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500/60 animate-pulse" />
            Auto-refreshes
          </div>
        </header>

        {/* Overall status */}
        <div className={`mb-8 sm:mb-10 lg:mb-12 rounded-2xl border p-5 sm:p-6 lg:p-8 backdrop-blur-sm transition-all ${
          allUp
            ? "border-emerald-500/20 bg-emerald-500/[0.04]"
            : "border-red-500/20 bg-red-500/[0.04]"
        }`}>
          <div className="flex items-center gap-4 lg:gap-5">
            <div className={`flex h-12 w-12 lg:h-14 lg:w-14 items-center justify-center rounded-2xl ${
              allUp ? "bg-emerald-500/15" : "bg-red-500/15"
            }`}>
              {allUp ? (
                <svg viewBox="0 0 24 24" className="h-6 w-6 lg:h-7 lg:w-7 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-6 w-6 lg:h-7 lg:w-7 text-red-400" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4m0 4h.01" /><circle cx="12" cy="12" r="9" /></svg>
              )}
            </div>
            <div>
              <h1 className="text-lg sm:text-xl lg:text-2xl font-bold">
                {allUp ? "All Systems Operational" : "Experiencing Issues"}
              </h1>
              <p className="mt-0.5 text-[13px] lg:text-sm text-slate-500">
                {data ? `Updated ${timeAgo(data.checkedAt)}` : "Connecting..."}
              </p>
            </div>
          </div>
        </div>

        {/* Services */}
        <div className="space-y-3 sm:space-y-4 lg:space-y-5">
          {loading ? (
            [...Array(6)].map((_, i) => (
              <div key={i} className="rounded-2xl border border-white/[0.04] bg-white/[0.015] p-4 sm:p-5 lg:p-6">
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <div className="h-4 w-32 animate-pulse rounded bg-white/[0.05]" />
                  <div className="h-4 w-20 animate-pulse rounded bg-white/[0.05]" />
                </div>
                <div className="flex gap-[1px] sm:gap-[2px]">
                  {[...Array(90)].map((_, j) => (
                    <div key={j} className="flex-1 h-8 sm:h-9 lg:h-10 animate-pulse rounded-sm bg-white/[0.03]" style={{ animationDelay: `${j * 15}ms` }} />
                  ))}
                </div>
              </div>
            ))
          ) : services.map((svc) => {
            const grid = build90DayGrid(histories[svc.name] || []);
            const latencyPoints = (histories[svc.name] || []).slice(-60).map(p => p.latencyMs);

            return (
              <div key={svc.name} className="group rounded-2xl border border-white/[0.04] bg-white/[0.015] p-4 sm:p-5 lg:p-6 transition-all hover:border-white/[0.08] hover:bg-white/[0.02]">
                {/* Service header */}
                <div className="mb-3 sm:mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <h3 className="text-[13px] sm:text-[14px] lg:text-[15px] font-semibold">{LABELS[svc.name] || svc.name}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] lg:text-[11px] font-semibold ${
                      svc.status === "up" ? "bg-emerald-500/10 text-emerald-400" :
                      svc.status === "degraded" ? "bg-yellow-500/10 text-yellow-400" :
                      "bg-red-500/10 text-red-400"
                    }`}>
                      {svc.status === "up" ? "Operational" : svc.status === "degraded" ? "Degraded" : "Outage"}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 sm:gap-4 lg:gap-6">
                    <div className="hidden sm:block lg:hidden opacity-40 group-hover:opacity-100 transition-opacity">
                      <Sparkline points={latencyPoints} width={100} height={26} />
                    </div>
                    <div className="hidden lg:block opacity-40 group-hover:opacity-100 transition-opacity">
                      <Sparkline points={latencyPoints} width={160} height={30} />
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] lg:text-[12px] tabular-nums text-slate-500">{svc.latencyMs}ms</p>
                      <p className="text-[10px] lg:text-[11px] tabular-nums text-slate-700">{svc.uptime30d.toFixed(2)}%</p>
                    </div>
                  </div>
                </div>

                {/* 90-day uptime grid — bars fill available width */}
                <div className="flex items-end gap-[1px] sm:gap-[2px]">
                  {grid.map((day, i) => (
                    <DayBar key={day.date} day={day} index={i} />
                  ))}
                </div>

                {/* Timeline labels */}
                <div className="mt-2 flex justify-between text-[10px] lg:text-[11px] text-slate-700">
                  <span>90 days ago</span>
                  <span>Today</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Incidents */}
        <div className="mt-10 sm:mt-12 lg:mt-16 mb-6">
          <h2 className="mb-4 text-[11px] lg:text-[12px] font-bold uppercase tracking-[0.15em] text-slate-600">Past Incidents</h2>

          {incidents.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.04] bg-white/[0.01] px-5 py-10 lg:py-14 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/[0.06]">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-500/60" fill="none" stroke="currentColor" strokeWidth={2}><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <p className="text-sm lg:text-base text-slate-500">No incidents reported</p>
              <p className="mt-1 text-[12px] lg:text-[13px] text-slate-700">All services running smoothly for the past 30 days</p>
            </div>
          ) : (
            <div className="space-y-3">
              {incidents.map((inc) => (
                <div key={inc.id} className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4 lg:p-5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`h-2 w-2 rounded-full ${
                      inc.severity === "critical" ? "bg-red-500" : inc.severity === "major" ? "bg-orange-500" : "bg-yellow-500"
                    }`} />
                    <span className="text-[12px] lg:text-[13px] font-semibold text-white">{inc.title}</span>
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] lg:text-[11px] font-medium ${
                      inc.status === "resolved" ? "bg-emerald-500/10 text-emerald-400" : "bg-blue-500/10 text-blue-400"
                    }`}>{inc.status}</span>
                  </div>
                  {inc.description && <p className="text-[12px] lg:text-[13px] text-slate-500 ml-4">{inc.description}</p>}
                  <p className="mt-1.5 text-[11px] lg:text-[12px] text-slate-700 ml-4">{timeAgo(inc.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="border-t border-white/[0.04] py-8 lg:py-10 text-center">
          <p className="text-[11px] lg:text-[12px] text-slate-700">
            Nexe Platform Status — Monitored every 60 seconds
          </p>
          <div className="mt-2 flex items-center justify-center gap-4 text-[11px] lg:text-[12px]">
            <a href="https://nexe.decatron.net" className="text-slate-600 transition-colors hover:text-slate-400">Home</a>
            <span className="text-slate-800">|</span>
            <a href="https://nexeapp.decatron.net" className="text-slate-600 transition-colors hover:text-slate-400">App</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
