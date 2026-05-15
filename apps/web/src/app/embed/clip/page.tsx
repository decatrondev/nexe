"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function ClipEmbed() {
  const params = useSearchParams();
  const id = params.get("id");

  if (!id) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0f172a", color: "#64748b", fontFamily: "sans-serif", fontSize: 14 }}>
        Missing clip ID
      </div>
    );
  }

  return (
    <iframe
      src={`https://clips.twitch.tv/embed?clip=${id}&parent=nexe.decatron.net&autoplay=false`}
      width="100%"
      height="100%"
      allowFullScreen
      style={{ border: 0, position: "absolute", inset: 0 }}
    />
  );
}

export default function EmbedClipPage() {
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", background: "#0f172a", overflow: "hidden" }}>
      <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0f172a", color: "#64748b" }}>Loading...</div>}>
        <ClipEmbed />
      </Suspense>
    </div>
  );
}
