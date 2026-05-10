import { useEffect, useState } from "react";
import { api, type Invite } from "../lib/api";

interface InviteModalProps {
  guildId: string;
  channelId: string;
  onClose: () => void;
}

function copyToClipboard(text: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

export default function InviteModal({ guildId, channelId, onClose }: InviteModalProps) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    async function createInvite() {
      try {
        const inv = await api.createInvite(guildId, channelId);
        if (!cancelled) setInvite(inv);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to create invite");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    createInvite();
    return () => { cancelled = true; };
  }, [guildId, channelId]);

  function handleCopy() {
    if (!invite) return;
    const link = `https://nexe.decatron.net/invite/${invite.code}`;
    copyToClipboard(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-dark-850 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-xl font-bold text-slate-100">
          Invite People
        </h2>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-nexe-500 border-t-transparent" />
            <span className="ml-3 text-sm text-slate-400">Creating invite link...</span>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
            {error}
          </div>
        )}

        {invite && !loading && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
                Invite Link
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`https://nexe.decatron.net/invite/${invite.code}`}
                  className="flex-1 rounded-lg border border-dark-700 bg-dark-900 px-4 py-2.5 text-sm text-slate-200 outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-lg bg-nexe-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-nexe-600"
                >
                  {copied ? "Copied!" : "Copy Link"}
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Share this link with others to invite them to the server.
            </p>
          </div>
        )}

        {!loading && (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-dark-800 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-dark-700"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
