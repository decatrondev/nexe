import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";

export const metadata: Metadata = {
  title: "Download Nexe — Desktop App",
  description:
    "Download Nexe for Windows, macOS, or Linux. The communication platform built for streamers.",
};

const RELEASE_URL = "https://github.com/decatrondev/nexe/releases/latest";

const platforms = [
  {
    name: "Windows",
    icon: (
      <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
      </svg>
    ),
    formats: [".exe (Installer)", ".msi (Windows Installer)"],
    note: "Windows 10 or later",
    primary: true,
  },
  {
    name: "macOS",
    icon: (
      <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
      </svg>
    ),
    formats: [".dmg (Universal)"],
    note: "macOS 10.15 (Catalina) or later",
    primary: false,
  },
  {
    name: "Linux",
    icon: (
      <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.368 1.884 1.43.585.047 1.042-.245 1.15-.688.054-.135.085-.327.114-.664.029-.34.028-.775-.114-1.329-.095-.37-.186-.652-.242-.905-.064-.267-.106-.469-.07-.669.129-.635.249-.999.393-1.339.144-.336.321-.667.497-1.135.085-.21.155-.4.203-.601.026-.135.035-.267.012-.398a.84.84 0 00-.108-.299c-.145-.25-.372-.396-.598-.529-.226-.133-.468-.256-.654-.454-.09-.1-.178-.222-.245-.403-.067-.183-.104-.424-.078-.674.046-.499.158-.932.305-1.396.074-.24.157-.472.228-.713.09-.307.15-.627.123-.976-.02-.282-.095-.556-.254-.814a1.96 1.96 0 00-.313-.385c-.196-.2-.392-.355-.576-.488-.184-.133-.352-.249-.466-.394a1.478 1.478 0 01-.214-.357c-.104-.27-.148-.573-.165-.897a8.42 8.42 0 01.032-1.324c.058-.563.17-1.153.087-1.789-.085-.637-.327-1.308-.876-1.864C15.849.676 14.467 0 12.504 0z" />
      </svg>
    ),
    formats: [".deb (Ubuntu/Debian)", ".AppImage (Universal)"],
    note: "Ubuntu 20.04 or later",
    primary: false,
  },
];

function DetectBanner() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          (function() {
            var ua = navigator.userAgent;
            var os = 'Windows';
            if (ua.indexOf('Mac') !== -1) os = 'macOS';
            else if (ua.indexOf('Linux') !== -1) os = 'Linux';
            var el = document.getElementById('detected-os');
            if (el) el.textContent = os;
            var card = document.querySelector('[data-platform="' + os + '"]');
            if (card) {
              card.classList.add('ring-2', 'ring-nexe-500/50');
              var badge = card.querySelector('.recommended-badge');
              if (badge) badge.classList.remove('hidden');
            }
          })();
        `,
      }}
    />
  );
}

export default function DownloadPage() {
  return (
    <>
      <Navbar />
      <DetectBanner />

      <div className="min-h-screen bg-gradient-to-b from-dark-950 via-dark-900 to-dark-950 pt-28 px-6 pb-24">
        {/* Header */}
        <div className="mx-auto max-w-4xl text-center mb-16">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-nexe-500/20 bg-nexe-500/5 px-4 py-1.5 text-sm text-nexe-400">
            <span className="h-1.5 w-1.5 rounded-full bg-nexe-500" />
            v0.0.1 — Alpha
          </div>

          <h1 className="mb-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Download Nexe
          </h1>

          <p className="mx-auto max-w-xl text-lg text-slate-400">
            Get the desktop app for the best experience. Your OS was detected as{" "}
            <span id="detected-os" className="font-medium text-white">
              Windows
            </span>
            .
          </p>
        </div>

        {/* Platform cards */}
        <div className="mx-auto max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {platforms.map((p) => (
            <div
              key={p.name}
              data-platform={p.name}
              className="relative flex flex-col items-center rounded-xl border border-slate-800 bg-dark-800 p-8 transition-all hover:border-nexe-500/30"
            >
              <div className="recommended-badge hidden absolute -top-3 right-4 rounded-full bg-nexe-600 px-3 py-0.5 text-xs font-medium text-white">
                Recommended
              </div>

              <div className="mb-5 text-slate-300">{p.icon}</div>

              <h2 className="mb-1 text-xl font-semibold text-white">
                {p.name}
              </h2>
              <p className="mb-6 text-xs text-slate-500">{p.note}</p>

              <div className="mb-6 w-full space-y-2">
                {p.formats.map((fmt) => (
                  <a
                    key={fmt}
                    href={RELEASE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full rounded-lg border border-slate-700 bg-dark-900 px-4 py-2.5 text-sm text-slate-300 transition-all hover:border-nexe-500/40 hover:text-white"
                  >
                    <svg
                      className="h-4 w-4 shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                      />
                    </svg>
                    {fmt}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* System requirements */}
        <div className="mx-auto max-w-2xl mb-16">
          <h3 className="mb-6 text-center text-lg font-semibold text-white">
            System Requirements
          </h3>
          <div className="rounded-xl border border-slate-800 bg-dark-800 overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-slate-800/50">
                  <td className="px-6 py-3 font-medium text-slate-300">OS</td>
                  <td className="px-6 py-3 text-slate-400">
                    Windows 10+, macOS 10.15+, Ubuntu 20.04+
                  </td>
                </tr>
                <tr className="border-b border-slate-800/50">
                  <td className="px-6 py-3 font-medium text-slate-300">RAM</td>
                  <td className="px-6 py-3 text-slate-400">4 GB minimum</td>
                </tr>
                <tr className="border-b border-slate-800/50">
                  <td className="px-6 py-3 font-medium text-slate-300">
                    Disk
                  </td>
                  <td className="px-6 py-3 text-slate-400">
                    250 MB free space
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-3 font-medium text-slate-300">
                    Network
                  </td>
                  <td className="px-6 py-3 text-slate-400">
                    Broadband internet connection
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Web app link */}
        <div className="mx-auto max-w-2xl text-center mb-12">
          <div className="rounded-xl border border-slate-800 bg-dark-800 p-6">
            <p className="mb-3 text-sm text-slate-400">
              Don&apos;t want to install anything?
            </p>
            <a
              href="https://nexeapp.decatron.net"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-nexe-500/30 bg-nexe-600/10 px-6 text-sm font-medium text-nexe-400 transition-all hover:bg-nexe-600/20 hover:text-nexe-300"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
                />
              </svg>
              Or use Nexe in your browser
            </a>
          </div>
        </div>

        {/* All releases link */}
        <div className="text-center">
          <a
            href={RELEASE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-nexe-400 transition-colors hover:text-nexe-300"
          >
            View all releases on GitHub
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
              />
            </svg>
          </a>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-dark-950 px-6 py-12">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-nexe-600 text-xs font-bold text-white">
              N
            </div>
            <span className="text-sm font-medium text-slate-400">Nexe</span>
          </div>
          <p className="text-sm text-slate-600">
            &copy; 2026 Nexe. All rights reserved.
          </p>
        </div>
      </footer>
    </>
  );
}
