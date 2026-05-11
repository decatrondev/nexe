import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getCategorizedDocs } from "@/lib/docs";
import { LogoutButton } from "./logout-button";

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authenticated = await isAdminAuthenticated();

  if (!authenticated) {
    redirect("/admin/login");
  }

  const { documentation, roadmap } = getCategorizedDocs();

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
          <Link
            href="/admin/dashboard"
            className="mb-4 flex items-center gap-2 rounded-lg bg-nexe-600/10 px-3 py-2 text-sm font-medium text-nexe-400 transition-colors hover:bg-nexe-600/20"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            Dashboard
          </Link>

          <p className="mb-3 px-2 text-xs font-medium uppercase tracking-wider text-slate-500">
            Documentation
          </p>
          <ul className="space-y-1">
            {documentation.map((doc) => (
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

          {roadmap.length > 0 && (
            <>
              <p className="mb-3 mt-6 px-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                Roadmap
              </p>
              <ul className="space-y-1">
                {roadmap.map((doc) => (
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
            </>
          )}
        </nav>

        <div className="space-y-1 border-t border-slate-800 p-4">
          <Link
            href="/"
            className="block rounded-lg px-3 py-2 text-center text-sm text-slate-500 transition-colors hover:bg-dark-800 hover:text-slate-300"
          >
            Back to site
          </Link>
          <LogoutButton />
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-64 flex-1 p-8">{children}</main>
    </div>
  );
}
