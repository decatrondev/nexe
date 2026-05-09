import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexe — Communication for Streamers",
  description:
    "The communication platform built for streamers. Everything Discord needs bots for, Nexe does natively.",
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
