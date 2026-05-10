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

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 flex items-center gap-4">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-dark-800 px-3 py-1.5 text-sm text-slate-400 transition-colors hover:border-slate-700 hover:text-white"
        >
          &larr; Back
        </Link>
        <div>
          <h1 className="text-xl font-bold text-white">{doc.title}</h1>
          <p className="text-xs text-slate-500">
            {doc.name} — last modified{" "}
            {doc.lastModified.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-dark-800 p-8">
        <div className="prose-nexe">
          <MarkdownRenderer content={doc.content} />
        </div>
      </div>
    </div>
  );
}
