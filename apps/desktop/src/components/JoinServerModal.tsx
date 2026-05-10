import { type FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useGuildStore } from "../stores/guild";
import { nexeWS } from "../lib/websocket";
import { useAuthStore } from "../stores/auth";

interface JoinServerModalProps {
  onClose: () => void;
  initialCode?: string;
}

function parseInviteCode(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/invite\/([A-Za-z0-9]+)$/);
  if (match) return match[1];
  return trimmed;
}

export default function JoinServerModal({ onClose, initialCode }: JoinServerModalProps) {
  const [input, setInput] = useState(initialCode || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loadGuilds = useGuildStore((s) => s.loadGuilds);
  const setActiveGuild = useGuildStore((s) => s.setActiveGuild);
  const token = useAuthStore((s) => s.token);

  // Auto-submit if initialCode is provided
  useEffect(() => {
    if (initialCode) {
      handleJoin(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleJoin(code: string) {
    setError("");
    setLoading(true);
    try {
      await api.joinByInvite(code);
      await loadGuilds();

      // Reconnect WS so gateway picks up new guild subscription
      if (token) {
        nexeWS.disconnect();
        setTimeout(() => nexeWS.connect(token), 500);
      }

      // Navigate to the newly joined server (last in list)
      const updated = useGuildStore.getState().guilds;
      if (updated.length > 0) {
        const newest = updated[updated.length - 1];
        await setActiveGuild(newest.id);
      }

      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to join server";
      // If already a member, navigate to that server
      if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("member")) {
        // Find the server in our list and navigate to it
        const currentGuilds = useGuildStore.getState().guilds;
        if (currentGuilds.length > 0) {
          // We don't know which server the invite was for, just close
          onClose();
          return;
        }
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const code = parseInviteCode(input);
    if (!code) return;
    await handleJoin(code);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-dark-850 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-xl font-bold text-slate-100">
          Join a Server
        </h2>

        {loading && (
          <div className="mb-4 flex items-center gap-2 text-sm text-slate-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-nexe-500 border-t-transparent" />
            Joining server...
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
            {error}
          </div>
        )}

        {!initialCode && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
                Invite Code or Link
              </label>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                required
                className="w-full rounded-lg border border-dark-700 bg-dark-900 px-4 py-2.5 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-500 focus:border-nexe-500"
                placeholder="ABCD1234 or https://nexe.decatron.net/invite/..."
                autoFocus
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg bg-dark-800 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-dark-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="flex-1 rounded-lg bg-nexe-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-nexe-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Joining..." : "Join Server"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
