import Link from "next/link";
import { getDocList } from "@/lib/docs";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  const docs = getDocList();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Documentation</h1>
        <p className="mt-1 text-sm text-slate-400">
          {docs.length} document{docs.length !== 1 ? "s" : ""} found in the
          project docs directory.
        </p>
      </div>

      {docs.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-dark-800 p-12 text-center">
          <p className="text-slate-400">
            No documentation files found.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Add .md files to /var/www/html/nexe/docs/ to see them here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((doc) => (
            <Link
              key={doc.slug}
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
          ))}
        </div>
      )}
    </div>
  );
}
