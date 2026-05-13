import Link from "next/link";
import { getCategorizedDocs, type DocMeta } from "@/lib/docs";

export const dynamic = "force-dynamic";

function DocCard({ doc }: { doc: DocMeta }) {
  return (
    <Link
      href={`/admin/${doc.slug}`}
      className="group rounded-xl border border-slate-800 bg-dark-800 p-5 transition-all hover:border-nexe-500/30 hover:bg-dark-850"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-white group-hover:text-nexe-400">
          {doc.title}
        </h2>
        <span className="rounded bg-dark-900 px-2 py-0.5 text-xs text-slate-500">
          .md
        </span>
      </div>
      <p className="mb-3 line-clamp-3 text-sm leading-relaxed text-slate-500">
        {doc.preview}
      </p>
      <p className="text-xs text-slate-600">
        Modified{" "}
        {doc.lastModified.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}
      </p>
    </Link>
  );
}

function Section({ title, docs, color }: { title: string; docs: DocMeta[]; color: string }) {
  if (docs.length === 0) return null;
  return (
    <div className="mb-10">
      <div className="mb-4 flex items-center gap-2">
        <div className={`h-3 w-3 rounded-full ${color}`} />
        <h2 className="text-lg font-bold text-white">{title}</h2>
        <span className="text-sm text-slate-500">({docs.length})</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {docs.map((doc) => (
          <DocCard key={doc.slug} doc={doc} />
        ))}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { documentation, roadmap, audit } = getCategorizedDocs();
  const total = documentation.length + roadmap.length + audit.length;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Documentation</h1>
        <p className="mt-1 text-sm text-slate-400">
          {total} document{total !== 1 ? "s" : ""} found.
        </p>
      </div>

      {total === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-dark-800 p-12 text-center">
          <p className="text-slate-400">No documentation files found.</p>
        </div>
      ) : (
        <>
          <Section title="Audit" docs={audit} color="bg-red-500" />
          <Section title="Roadmap" docs={roadmap} color="bg-nexe-500" />
          <Section title="Documentation" docs={documentation} color="bg-slate-500" />
        </>
      )}
    </div>
  );
}
