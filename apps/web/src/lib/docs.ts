import fs from "fs";
import path from "path";

const DOCS_DIR = "/var/www/html/nexe/docs";

export interface DocMeta {
  slug: string;
  name: string;
  title: string;
  preview: string;
  lastModified: Date;
  category?: string;
  /** Percentage extracted from roadmap files (0-100) */
  progress?: number;
  /** Status label: "CERRADO", "deferred", etc. */
  statusLabel?: string;
}

export interface Doc extends DocMeta {
  content: string;
}

function slugFromFilename(relativePath: string): string {
  return relativePath.replace(/\.md$/, "").toLowerCase().replace(/\//g, "--");
}

function titleFromFilename(relativePath: string): string {
  const name = path.basename(relativePath, ".md");
  return name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function categoryFromPath(relativePath: string): string | undefined {
  const dir = path.dirname(relativePath);
  if (dir === ".") return undefined;
  return dir;
}

function getAllMdFiles(dir: string, base = ""): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...getAllMdFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith(".md")) {
      results.push(rel);
    }
  }
  return results;
}

export function getDocList(): DocMeta[] {
  if (!fs.existsSync(DOCS_DIR)) {
    return [];
  }

  const files = getAllMdFiles(DOCS_DIR);

  return files
    .map((relativePath) => {
      const filePath = path.join(DOCS_DIR, relativePath);
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, "utf-8");
      const firstLines = content.split("\n").slice(0, 4).join(" ").trim();
      const preview =
        firstLines.length > 160
          ? firstLines.substring(0, 160) + "..."
          : firstLines;

      // Extract progress percentage from roadmap files
      let progress: number | undefined;
      let statusLabel: string | undefined;
      const basename = path.basename(relativePath).toUpperCase();
      if (basename.startsWith("ROADMAP")) {
        const pctMatch = content.match(/(\d{1,3})%/);
        if (pctMatch) progress = parseInt(pctMatch[1]);
        if (content.includes("CERRADO")) statusLabel = "CERRADO";
        else if (content.includes("deferred") || content.includes("Deferred")) statusLabel = "deferred";
      }

      return {
        slug: slugFromFilename(relativePath),
        name: relativePath,
        title: titleFromFilename(relativePath),
        preview,
        lastModified: stat.mtime,
        category: categoryFromPath(relativePath),
        progress,
        statusLabel,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export interface CategorizedDocs {
  documentation: DocMeta[];
  roadmap: DocMeta[];
  audit: DocMeta[];
}

export function getCategorizedDocs(): CategorizedDocs {
  const all = getDocList();
  const documentation: DocMeta[] = [];
  const roadmap: DocMeta[] = [];
  const audit: DocMeta[] = [];

  for (const doc of all) {
    const upper = doc.name.toUpperCase();
    if (upper.startsWith("AUDIT/")) {
      audit.push(doc);
    } else if (upper.startsWith("ROADMAPS/") || path.basename(upper).startsWith("ROADMAP-") || path.basename(upper) === "ROADMAP.MD") {
      roadmap.push(doc);
    } else {
      documentation.push(doc);
    }
  }

  return { documentation, roadmap, audit };
}

export function getDoc(slug: string): Doc | null {
  if (!fs.existsSync(DOCS_DIR)) {
    return null;
  }

  const files = getAllMdFiles(DOCS_DIR);
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
