import fs from "fs";
import path from "path";

const DOCS_DIR = "/var/www/html/nexe/docs";

export interface DocMeta {
  slug: string;
  name: string;
  title: string;
  preview: string;
  lastModified: Date;
}

export interface Doc extends DocMeta {
  content: string;
}

function slugFromFilename(filename: string): string {
  return filename.replace(/\.md$/, "").toLowerCase();
}

function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.md$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getDocList(): DocMeta[] {
  if (!fs.existsSync(DOCS_DIR)) {
    return [];
  }

  const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));

  return files
    .map((filename) => {
      const filePath = path.join(DOCS_DIR, filename);
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, "utf-8");
      const firstLines = content.split("\n").slice(0, 4).join(" ").trim();
      const preview =
        firstLines.length > 160
          ? firstLines.substring(0, 160) + "..."
          : firstLines;

      return {
        slug: slugFromFilename(filename),
        name: filename,
        title: titleFromFilename(filename),
        preview,
        lastModified: stat.mtime,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getDoc(slug: string): Doc | null {
  if (!fs.existsSync(DOCS_DIR)) {
    return null;
  }

  const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));
  const match = files.find((f) => slugFromFilename(f) === slug);

  if (!match) {
    return null;
  }

  const filePath = path.join(DOCS_DIR, match);
  const stat = fs.statSync(filePath);
  const content = fs.readFileSync(filePath, "utf-8");
  const firstLines = content.split("\n").slice(0, 4).join(" ").trim();
  const preview =
    firstLines.length > 160
      ? firstLines.substring(0, 160) + "..."
      : firstLines;

  return {
    slug: slugFromFilename(match),
    name: match,
    title: titleFromFilename(match),
    preview,
    lastModified: stat.mtime,
    content,
  };
}
