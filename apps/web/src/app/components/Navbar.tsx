import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-dark-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-nexe-600 text-xs font-bold text-white sm:h-8 sm:w-8 sm:text-sm">
            N
          </div>
          <span className="text-base font-semibold text-white sm:text-lg">Nexe</span>
        </Link>

        <div className="flex items-center gap-4 sm:gap-8">
          <a
            href="#features"
            className="hidden text-sm text-slate-400 transition-colors hover:text-white sm:block"
          >
            Features
          </a>
          <a
            href="#open-source"
            className="hidden text-sm text-slate-400 transition-colors hover:text-white sm:block"
          >
            Open Source
          </a>
          <Link
            href="/download"
            className="rounded-lg bg-nexe-600 px-4 py-1.5 text-xs font-medium text-white transition-all hover:bg-nexe-700 sm:text-sm"
          >
            Download
          </Link>
        </div>
      </div>
    </nav>
  );
}
