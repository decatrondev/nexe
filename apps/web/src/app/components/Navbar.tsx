import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-dark-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-nexe-600 text-sm font-bold text-white">
            N
          </div>
          <span className="text-lg font-semibold text-white">Nexe</span>
        </Link>

        <div className="flex items-center gap-8">
          <a
            href="#features"
            className="text-sm text-slate-400 transition-colors hover:text-white"
          >
            Features
          </a>
          <a
            href="#open-source"
            className="text-sm text-slate-400 transition-colors hover:text-white"
          >
            Open Source
          </a>
          <a
            href="#download"
            className="text-sm text-slate-400 transition-colors hover:text-white"
          >
            Download
          </a>
          <Link
            href="/admin"
            className="text-sm text-slate-500 transition-colors hover:text-slate-300"
          >
            Admin
          </Link>
        </div>
      </div>
    </nav>
  );
}
