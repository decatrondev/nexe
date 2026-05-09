import Navbar from "@/app/components/Navbar";

const features = [
  {
    icon: "[LIVE]",
    title: "Live Status",
    description:
      "Know when your streamer is live, automatically. Real-time notifications without third-party bots.",
  },
  {
    icon: "[ROLE]",
    title: "Auto Roles",
    description:
      "Twitch subs get roles instantly, no bots needed. Seamless integration with your subscriber tiers.",
  },
  {
    icon: "[USER]",
    title: "Steam-like Profiles",
    description:
      "Dynamic profiles with badges, levels, and showcase. Show off your streaming stats and achievements.",
  },
  {
    icon: "[CLIP]",
    title: "Native Clips",
    description:
      "Share Twitch clips directly in chat with rich embeds. No link previews — real native playback.",
  },
  {
    icon: "[SYNC]",
    title: "Chat Bridge",
    description:
      "Sync messages between Nexe and Twitch chat in real time. One conversation, two platforms.",
  },
  {
    icon: "[API]",
    title: "Bot API",
    description:
      "Build powerful bots from day one with a first-class API. No reverse engineering required.",
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
              href="#download"
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
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-nexe-600/10 font-mono text-xs font-bold text-nexe-400">
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
