import Link from "next/link";

export const dynamic = "force-dynamic";

const GATEWAY_URL = "http://localhost:8090";

interface InviteInfo {
  code: string;
  guildId: string;
  guildName?: string;
  memberCount?: number;
}

async function getInviteInfo(code: string): Promise<InviteInfo | null> {
  try {
    // Fetch guild info via the invite's guild
    // For now we just validate the code exists by checking the invites list
    // A proper endpoint would be GET /invites/{code} but it doesn't exist yet
    // So we show a generic invite page
    return { code, guildId: "" };
  } catch {
    return null;
  }
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-dark-950 via-dark-900 to-dark-950 px-6">
      {/* Glow */}
      <div className="pointer-events-none absolute top-1/3 left-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-nexe-600/10 blur-[120px]" />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-800 bg-dark-800 p-8 text-center shadow-2xl">
        {/* Logo */}
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-nexe-600 text-2xl font-bold text-white">
          N
        </div>

        <h1 className="mb-2 text-2xl font-bold text-white">
          You&apos;ve been invited to join a server
        </h1>

        <p className="mb-6 text-sm text-slate-400">
          Open this invite in the Nexe app to join the server.
        </p>

        {/* Invite code display */}
        <div className="mb-6 rounded-lg border border-slate-700 bg-dark-900 px-4 py-3">
          <p className="text-xs text-slate-500">Invite Code</p>
          <p className="mt-1 font-mono text-lg font-semibold text-nexe-400">
            {code}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <a
            href={`https://nexeapp.decatron.net?invite=${code}`}
            className="inline-flex h-12 items-center justify-center rounded-lg bg-nexe-600 text-sm font-medium text-white transition-all hover:bg-nexe-700"
          >
            Accept Invite
          </a>
        </div>

        <p className="mt-6 text-xs text-slate-600">
          Don&apos;t have Nexe?{" "}
          <Link href="/" className="text-nexe-400 hover:text-nexe-300">
            Learn more
          </Link>
        </p>
      </div>
    </div>
  );
}
