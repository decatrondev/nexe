import Link from "next/link";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface InviteData {
  guildName: string;
  guildIcon: string;
  memberCount: number;
  inviterName: string;
}

async function getInviteData(code: string): Promise<InviteData | null> {
  try {
    const rows = await query<{
      guild_name: string;
      icon_url: string;
      member_count: number;
      inviter_name: string;
    }>(
      `SELECT g.name as guild_name, g.icon_url, g.member_count,
              u.username as inviter_name
       FROM invites i
       JOIN guilds g ON g.id = i.guild_id
       JOIN users u ON u.id = i.created_by
       WHERE i.code = $1 AND (i.expires_at IS NULL OR i.expires_at > NOW())
       LIMIT 1`,
      [code]
    );
    if (rows.length === 0) return null;
    return {
      guildName: rows[0].guild_name,
      guildIcon: rows[0].icon_url || "",
      memberCount: rows[0].member_count,
      inviterName: rows[0].inviter_name,
    };
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
  const invite = await getInviteData(code);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-dark-950 via-dark-900 to-dark-950 px-6">
      <div className="pointer-events-none absolute top-1/3 left-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-nexe-600/10 blur-[120px]" />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-800 bg-dark-800 p-8 text-center shadow-2xl">
        {invite ? (
          <>
            {/* Server icon */}
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-nexe-600/20 text-3xl font-bold text-nexe-400">
              {invite.guildIcon ? (
                <img src={invite.guildIcon} alt={invite.guildName} className="h-20 w-20 rounded-2xl object-cover" />
              ) : (
                invite.guildName.charAt(0).toUpperCase()
              )}
            </div>

            <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">
              You&apos;ve been invited to join
            </p>
            <h1 className="mb-2 text-2xl font-bold text-white">
              {invite.guildName}
            </h1>

            <div className="mb-6 flex items-center justify-center gap-4 text-sm text-slate-400">
              <span className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-slate-500" />
                {invite.memberCount} member{invite.memberCount !== 1 ? "s" : ""}
              </span>
              <span>
                Invited by <span className="text-slate-300">{invite.inviterName}</span>
              </span>
            </div>

            <a
              href={`https://nexeapp.decatron.net?invite=${code}`}
              className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-nexe-600 text-sm font-semibold text-white transition-all hover:bg-nexe-700"
            >
              Accept Invite
            </a>
          </>
        ) : (
          <>
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/20 text-2xl">
              <svg className="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="mb-2 text-xl font-bold text-white">
              Invalid or Expired Invite
            </h1>
            <p className="mb-6 text-sm text-slate-400">
              This invite link is no longer valid. Ask the server owner for a new one.
            </p>
          </>
        )}

        <p className="mt-6 text-xs text-slate-600">
          Don&apos;t have Nexe?{" "}
          <Link href="/" className="text-nexe-400 hover:text-nexe-300">
            Learn more
          </Link>
          {" · "}
          <Link href="/download" className="text-nexe-400 hover:text-nexe-300">
            Download
          </Link>
        </p>
      </div>
    </div>
  );
}
