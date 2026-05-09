import { type FormEvent, useState } from "react";
import { useGuildStore } from "../stores/guild";

interface CreateGuildModalProps {
  onClose: () => void;
}

export default function CreateGuildModal({ onClose }: CreateGuildModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isStreamerServer, setIsStreamerServer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const createGuild = useGuildStore((s) => s.createGuild);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    setLoading(true);
    try {
      await createGuild(name.trim(), description.trim(), isStreamerServer);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-2xl bg-dark-850 p-6 shadow-2xl">
        <h2 className="mb-4 text-xl font-bold text-slate-100">
          Create a Server
        </h2>

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
              Server Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg border border-dark-700 bg-dark-900 px-4 py-2.5 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-500 focus:border-nexe-500"
              placeholder="My Awesome Server"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-dark-700 bg-dark-900 px-4 py-2.5 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-500 focus:border-nexe-500"
              placeholder="What is this server about?"
            />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isStreamerServer}
              onChange={(e) => setIsStreamerServer(e.target.checked)}
              className="h-4 w-4 rounded border-dark-700 bg-dark-900 text-nexe-500 focus:ring-nexe-500"
            />
            <span className="text-sm text-slate-300">Streamer Server</span>
          </label>

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
              disabled={loading || !name.trim()}
              className="flex-1 rounded-lg bg-nexe-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-nexe-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
