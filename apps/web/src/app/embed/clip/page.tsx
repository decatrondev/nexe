export default async function EmbedClipPage({ searchParams }: { searchParams: Promise<{ id?: string; parent?: string }> }) {
  const { id, parent } = await searchParams;

  if (!id) {
    return (
      <html>
        <body style={{ margin: 0, background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#64748b", fontFamily: "sans-serif" }}>
          Missing clip ID
        </body>
      </html>
    );
  }

  const parentDomain = parent || "nexe.decatron.net";

  return (
    <html>
      <body style={{ margin: 0, overflow: "hidden", background: "#000" }}>
        <iframe
          src={`https://clips.twitch.tv/embed?clip=${id}&parent=${parentDomain}&autoplay=false`}
          width="100%"
          height="100%"
          allowFullScreen
          style={{ border: 0, position: "absolute", inset: 0 }}
        />
      </body>
    </html>
  );
}
