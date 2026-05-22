import type { Metadata } from "next";
import { headers } from "next/headers";

export const metadata: Metadata = {
  title: "Nexe Status",
  description: "Real-time status of Nexe platform services",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StatusLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  // Force no cache
  h.get("x-force-dynamic");
  return <>{children}</>;
}
