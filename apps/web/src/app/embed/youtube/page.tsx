export default async function EmbedYouTubePage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;

  if (!id) {
    return (
      <html>
        <body style={{ margin: 0, background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#64748b", fontFamily: "sans-serif" }}>
          Missing video ID
        </body>
      </html>
    );
  }

  return (
    <html>
      <body style={{ margin: 0, overflow: "hidden", background: "#000" }}>
        <iframe
          src={`https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`}
          width="100%"
          height="100%"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ border: 0, position: "absolute", inset: 0 }}
        />
      </body>
    </html>
  );
}
