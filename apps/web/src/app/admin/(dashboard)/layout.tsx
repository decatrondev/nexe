import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getCategorizedDocs, type DocMeta } from "@/lib/docs";
import { LogoutButton } from "./logout-button";

function ProgressBadge({ doc }: { doc: DocMeta }) {
  if (doc.progress === undefined) return null;
  const pct = doc.progress;
  const color =
    pct >= 97 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
    pct >= 50 ? "text-amber-400 bg-amber-500/10 border-amber-500/20" :
    pct > 0  ? "text-blue-400 bg-blue-500/10 border-blue-500/20" :
               "text-slate-500 bg-slate-500/10 border-slate-500/20";
  return (
    <span className={`ml-auto shrink-0 rounded border px-1.5 py-px text-[10px] font-semibold tabular-nums ${color}`}>
      {pct}%
    </span>
  );
}

function SidebarSection({ title, icon, color, items }: {
  title: string;
  icon: React.ReactNode;
  color: string;
  items: DocMeta[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-5">
      <div className={`mb-2 flex items-center gap-2 px-2 ${color}`}>
        {icon}
        <span className="text-[11px] font-bold uppercase tracking-widest">{title}</span>
        <span className="ml-auto text-[10px] font-medium opacity-50">{items.length}</span>
      </div>
      <ul className="space-y-px">
        {items.map((doc) => (
          <li key={doc.slug}>
            <Link
              href={`/admin/${doc.slug}`}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-slate-200"
            >
              <span className="flex-1 truncate">{doc.title}</span>
              <ProgressBadge doc={doc} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) redirect("/admin/login");

  const { documentation, roadmap, audit } = getCategorizedDocs();

  // Split roadmaps: Fase 1 (numbered), Fase 2, Master
  const masterRoadmap = roadmap.filter((d) => d.name.toLowerCase().endsWith("roadmap.md"));
  const fase2 = roadmap.filter((d) => d.name.toLowerCase().includes("fase2"));
  const fase1 = roadmap.filter(
    (d) => !d.name.toLowerCase().endsWith("roadmap.md") && !d.name.toLowerCase().includes("fase2")
  );

  return (
    <div className="flex min-h-screen bg-dark-950">
      {/* Sidebar */}
      <aside className="fixed top-0 left-0 z-30 flex h-full w-[272px] flex-col border-r border-white/[0.06] bg-[#0d0f13]">
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-white/[0.06] px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-nexe-500 to-nexe-700 text-[11px] font-black text-white shadow-lg shadow-nexe-600/20">
              N
            </div>
            <div>
              <span className="text-sm font-semibold text-white">Nexe</span>
              <span className="ml-1.5 rounded bg-white/[0.06] px-1.5 py-px text-[10px] font-medium text-slate-500">Admin</span>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 accent-scrollbar">
          {/* Main nav */}
          <div className="mb-6 space-y-px">
            <Link
              href="/admin/dashboard"
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              <svg className="h-4 w-4 text-nexe-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
              Dashboard
            </Link>
            <Link
              href="/admin/users"
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
              Users
            </Link>
            <Link
              href="/admin/tiers"
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
              </svg>
              Tiers
            </Link>
          </div>

          <div className="mb-5 h-px bg-white/[0.04]" />

          {/* Documentation */}
          <SidebarSection
            title="Documentation"
            color="text-slate-500"
            icon={
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            }
            items={documentation}
          />

          {/* Roadmap — Master + Fase 1 */}
          <SidebarSection
            title="Roadmap — Fase 1"
            color="text-nexe-400"
            icon={
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            }
            items={[...masterRoadmap, ...fase1]}
          />

          {/* Roadmap — Fase 2 */}
          {fase2.length > 0 && (
            <SidebarSection
              title="Roadmap — Fase 2"
              color="text-purple-400"
              icon={
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                </svg>
              }
              items={fase2}
            />
          )}

          {/* Audit */}
          <SidebarSection
            title="Audit Reports"
            color="text-red-400"
            icon={
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            }
            items={audit}
          />
        </nav>

        {/* Footer */}
        <div className="shrink-0 space-y-1 border-t border-white/[0.06] p-3">
          <Link
            href="/"
            className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[13px] text-slate-500 transition-colors hover:bg-white/[0.04] hover:text-slate-300"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            </svg>
            Back to site
          </Link>
          <LogoutButton />
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-[272px] flex-1 min-h-screen">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
