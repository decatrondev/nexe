import Navbar from "@/app/components/Navbar";
import { type ReactNode } from "react";

const features: { icon: ReactNode; title: string; description: string }[] = [
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79M12 12h.008v.007H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
    ),
    title: "Live Status",
    description:
      "Know when your streamer is live, automatically. Real-time notifications without third-party bots.",
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    title: "Auto Roles",
    description:
      "Twitch subs get roles instantly, no bots needed. Seamless integration with your subscriber tiers.",
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
    title: "Steam-like Profiles",
    description:
      "Dynamic profiles with badges, levels, and showcase. Show off your streaming stats and achievements.",
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
      </svg>
    ),
    title: "Native Clips",
    description:
      "Share Twitch clips directly in chat with rich embeds. No link previews — real native playback.",
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
    title: "Chat Bridge",
    description:
      "Sync messages between Nexe and Twitch chat in real time. One conversation, two platforms.",
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
    title: "Bot API",
    description:
      "Build powerful bots from day one with a first-class API. No reverse engineering required.",
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
      </svg>
    ),
    title: "Voice Channels",
    description:
      "Crystal-clear voice chat powered by LiveKit. Join, mute, deafen — all built-in, no third-party needed.",
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
    ),
    title: "Smart Notifications",
    description:
      "Mentions, replies, @everyone — all with real-time push notifications. Per-server preferences.",
  },
];

const comparisons = [
  {
    feature: "Live stream notifications",
    nexe: "Built-in",
    discord: "Requires bot",
  },
  {
    feature: "Twitch sub auto-roles",
    nexe: "Native",
    discord: "Requires bot + OAuth",
  },
  {
    feature: "Clip embeds",
    nexe: "Native player",
    discord: "Link preview only",
  },
  {
    feature: "Twitch chat bridge",
    nexe: "Built-in",
    discord: "Not available",
  },
  {
    feature: "User profiles with levels",
    nexe: "Built-in",
    discord: "Requires bot",
  },
  {
    feature: "Open source",
    nexe: "Yes",
    discord: "No",
  },
];

export default function Home() {
  return (
    <>
      <Navbar />

      {/* Hero */}
      <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-dark-950 via-dark-900 to-dark-950 px-6 pt-16">
        {/* Glow effect */}
        <div className="pointer-events-none absolute top-1/3 left-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-nexe-600/10 blur-[120px]" />

        <div className="relative z-10 mx-auto max-w-4xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-nexe-500/20 bg-nexe-500/5 px-4 py-1.5 text-sm text-nexe-400">
            <span className="h-1.5 w-1.5 rounded-full bg-nexe-500" />
            Open Source Communication Platform
          </div>

          <h1 className="mb-6 text-6xl font-bold tracking-tight text-white sm:text-7xl lg:text-8xl">
            Nexe
          </h1>

          <p className="mb-4 text-xl text-slate-300 sm:text-2xl">
            The communication platform built for streamers
          </p>

          <p className="mx-auto mb-10 max-w-2xl text-lg text-slate-500">
            Everything Discord needs bots for, Nexe does natively.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row" id="download">
            <a
              href="/download"
              className="inline-flex h-12 items-center justify-center rounded-lg bg-nexe-600 px-8 text-sm font-medium text-white transition-all hover:bg-nexe-700 hover:shadow-lg hover:shadow-nexe-600/25"
            >
              Download Desktop
            </a>
            <a
              href="#features"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-slate-700 px-8 text-sm font-medium text-slate-300 transition-all hover:border-slate-600 hover:text-white"
            >
              Learn More
            </a>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
          <div className="h-8 w-5 rounded-full border-2 border-slate-700 p-1">
            <div className="h-2 w-1 animate-bounce rounded-full bg-slate-500" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="bg-dark-950 px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold text-white sm:text-4xl">
              Built for streamers, not bolted on
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-slate-400">
              Every feature designed from the ground up for the streaming
              community. No bots, no workarounds, no compromises.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group rounded-xl border border-slate-800 bg-dark-800 p-6 transition-all hover:border-nexe-500/30 hover:bg-dark-850"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-nexe-600/10 text-nexe-400">
                  {feature.icon}
                </div>
                <h3 className="mb-2 text-lg font-semibold text-white">
                  {feature.title}
                </h3>
                <p className="text-sm leading-relaxed text-slate-400">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="border-y border-slate-800 bg-dark-900 px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-white sm:text-4xl">
              Why Nexe over Discord?
            </h2>
            <p className="text-lg text-slate-400">
              A side-by-side look at what you get out of the box.
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800 bg-dark-800">
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">
                    Feature
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-nexe-400">
                    Nexe
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-500">
                    Discord
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map((row, i) => (
                  <tr
                    key={row.feature}
                    className={
                      i < comparisons.length - 1
                        ? "border-b border-slate-800/50"
                        : ""
                    }
                  >
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {row.feature}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-emerald-400">
                      {row.nexe}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {row.discord}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Open Source */}
      <section id="open-source" className="bg-dark-950 px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-dark-800 px-4 py-1.5 text-sm text-slate-300">
            Open Source
          </div>

          <h2 className="mb-4 text-3xl font-bold text-white sm:text-4xl">
            Built in the open
          </h2>
          <p className="mb-8 text-lg text-slate-400">
            Nexe is fully open source. Audit the code, contribute features, or
            self-host your own instance. No lock-in, no hidden agendas.
          </p>
          <a
            href="https://github.com/nexe"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center gap-2 rounded-lg border border-slate-700 bg-dark-800 px-6 text-sm font-medium text-white transition-all hover:border-slate-600 hover:bg-dark-700"
          >
            <svg
              className="h-5 w-5"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
            View on GitHub
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-dark-950 px-6 py-12">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-nexe-600 text-xs font-bold text-white">
              N
            </div>
            <span className="text-sm font-medium text-slate-400">Nexe</span>
          </div>

          <div className="flex gap-8">
            <a
              href="#features"
              className="text-sm text-slate-500 transition-colors hover:text-slate-300"
            >
              Features
            </a>
            <a
              href="#open-source"
              className="text-sm text-slate-500 transition-colors hover:text-slate-300"
            >
              Open Source
            </a>
            <a
              href="https://github.com/nexe"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-slate-500 transition-colors hover:text-slate-300"
            >
              GitHub
            </a>
          </div>

          <p className="text-sm text-slate-600">
            &copy; 2026 Nexe. All rights reserved.
          </p>
        </div>
      </footer>
    </>
  );
}
