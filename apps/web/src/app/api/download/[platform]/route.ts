import { NextRequest } from "next/server";

const GITHUB_REPO = "decatrondev/nexe";
const API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

// Cache the release data for 5 minutes in memory
let cachedRelease: { data: ReleaseData; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

interface ReleaseData {
  tag_name: string;
  assets: ReleaseAsset[];
}

async function getRelease(): Promise<ReleaseData | null> {
  if (cachedRelease && Date.now() - cachedRelease.fetchedAt < CACHE_TTL) {
    return cachedRelease.data;
  }
  try {
    const res = await fetch(API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) return cachedRelease?.data ?? null;
    const data = await res.json();
    cachedRelease = { data, fetchedAt: Date.now() };
    return data;
  } catch {
    return cachedRelease?.data ?? null;
  }
}

function findAsset(assets: ReleaseAsset[], platform: string): ReleaseAsset | null {
  const lower = (a: ReleaseAsset) => a.name.toLowerCase();

  switch (platform) {
    case "windows":
      return assets.find((a) => lower(a).endsWith(".exe")) ?? null;
    case "windows-msi":
      return assets.find((a) => lower(a).endsWith(".msi")) ?? null;
    case "mac":
    case "macos":
      return assets.find((a) => lower(a).endsWith(".dmg")) ?? null;
    case "linux":
    case "linux-deb":
      return assets.find((a) => lower(a).endsWith(".deb")) ?? null;
    case "linux-appimage":
      return assets.find((a) => lower(a).endsWith(".appimage")) ?? null;
    case "linux-rpm":
      return assets.find((a) => lower(a).endsWith(".rpm")) ?? null;
    default:
      return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  const release = await getRelease();

  if (!release || !release.assets.length) {
    return new Response("No release found", { status: 404 });
  }

  const asset = findAsset(release.assets, platform);
  if (!asset) {
    return new Response(
      `No asset for platform "${platform}". Valid: windows, windows-msi, macos, linux, linux-deb, linux-appimage, linux-rpm`,
      { status: 404 }
    );
  }

  // Stream the file from GitHub directly to the client
  const fileRes = await fetch(asset.browser_download_url, { cache: "no-store" });
  if (!fileRes.ok || !fileRes.body) {
    return new Response("Failed to fetch file", { status: 502 });
  }

  return new Response(fileRes.body, {
    status: 200,
    headers: {
      "Content-Type": asset.content_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${asset.name}"`,
      "Content-Length": String(asset.size),
      "Cache-Control": "public, max-age=300",
    },
  });
}
