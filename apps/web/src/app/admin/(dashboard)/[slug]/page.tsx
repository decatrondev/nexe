import { notFound } from "next/navigation";
import Link from "next/link";
import { getDoc } from "@/lib/docs";
import { MarkdownRenderer } from "./markdown-renderer";

export const dynamic = "force-dynamic";

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = getDoc(slug);

  if (!doc) {
    notFound();
  }

  // Determine breadcrumb category
  const upper = doc.name.toUpperCase();
  const category = upper.startsWith("AUDIT/")
    ? { label: "Audit", color: "text-red-400" }
    : upper.startsWith("ROADMAPS/") || upper.startsWith("ROADMAP")
    ? { label: "Roadmap", color: "text-nexe-400" }
    : { label: "Docs", color: "text-slate-400" };

  return (
    <div className="mx-auto max-w-4xl">
      {/* Breadcrumb + Meta */}
      <div className="mb-6">
        <div className="mb-3 flex items-center gap-2 text-[13px]">
          <Link href="/admin/dashboard" className="text-slate-500 hover:text-slate-300 transition-colors">Admin</Link>
          <span className="text-slate-600">/</span>
          <span className={category.color}>{category.label}</span>
          <span className="text-slate-600">/</span>
          <span className="text-slate-300">{doc.title}</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{doc.title}</h1>
        <p className="mt-1 text-xs text-slate-500">
          {doc.name} &middot; Modified {doc.lastModified.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* Content */}
      <div className="rounded-xl border border-white/[0.06] bg-[#12141a] p-8">
        <div className="prose-nexe">
          <MarkdownRenderer content={doc.content} />
        </div>
      </div>
    </div>
  );
}
