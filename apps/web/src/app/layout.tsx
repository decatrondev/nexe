import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexe — Communication for Streamers",
  description:
    "The communication platform built for streamers. Everything Discord needs bots for, Nexe does natively.",
  openGraph: {
    title: "Nexe — Communication for Streamers",
    description: "Real-time chat, voice, Twitch integration, auto-roles — all native. Open source.",
    url: "https://nexe.decatron.net",
    siteName: "Nexe",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Nexe — Communication for Streamers",
    description: "Real-time chat, voice, Twitch integration, auto-roles — all native. Open source.",
  },
  metadataBase: new URL("https://nexe.decatron.net"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
