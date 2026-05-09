import Link from "next/link";
import { getDocList } from "@/lib/docs";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const docs = getDocList();

  return (
    <div className="flex min-h-screen bg-dark-950">
      {/* Sidebar */}
      <aside className="fixed top-0 left-0 flex h-full w-64 flex-col border-r border-slate-800 bg-dark-900">
        <div className="flex h-16 items-center gap-2 border-b border-slate-800 px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-nexe-600 text-xs font-bold text-white">
              N
            </div>
            <span className="text-sm font-semibold text-white">
              Nexe Admin
            </span>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto p-4">
          <p className="mb-3 px-2 text-xs font-medium uppercase tracking-wider text-slate-500">
            Documentation
          </p>
          <ul className="space-y-1">
            {docs.map((doc) => (
              <li key={doc.slug}>
                <Link
                  href={`/admin/${doc.slug}`}
                  className="block rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-dark-800 hover:text-white"
                >
                  {doc.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-slate-800 p-4">
          <Link
            href="/"
            className="block rounded-lg px-3 py-2 text-center text-sm text-slate-500 transition-colors hover:bg-dark-800 hover:text-slate-300"
          >
            Back to site
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-64 flex-1 p-8">{children}</main>
    </div>
  );
}
