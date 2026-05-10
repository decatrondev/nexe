import { type FormEvent, useEffect, useState } from "react";
import { useGuildStore } from "../stores/guild";

interface CreateChannelModalProps {
  onClose: () => void;
}

export default function CreateChannelModal({
  onClose,
}: CreateChannelModalProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState("text");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const createChannel = useGuildStore((s) => s.createChannel);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    setLoading(true);
    try {
      await createChannel(name.trim().toLowerCase().replace(/\s+/g, "-"), type);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create channel",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-dark-850 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-xl font-bold text-slate-100">
          Create Channel
        </h2>

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400 border border-red-500/20">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
              Channel Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg border border-dark-700 bg-dark-900 px-4 py-2.5 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-500 focus:border-nexe-500"
              placeholder="general"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
              Channel Type
            </label>
            <div className="flex gap-3">
              <label
                className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-4 py-3 transition-colors ${
                  type === "text"
                    ? "border-nexe-500 bg-nexe-500/10"
                    : "border-dark-700 bg-dark-900 hover:border-dark-600"
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value="text"
                  checked={type === "text"}
                  onChange={() => setType("text")}
                  className="hidden"
                />
                <span className="text-lg text-slate-400">#</span>
                <span className="text-sm text-slate-200">Text</span>
              </label>
              <label
                className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-4 py-3 transition-colors ${
                  type === "voice"
                    ? "border-nexe-500 bg-nexe-500/10"
                    : "border-dark-700 bg-dark-900 hover:border-dark-600"
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value="voice"
                  checked={type === "voice"}
                  onChange={() => setType("voice")}
                  className="hidden"
                />
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 fill-current text-slate-400"
                >
                  <path d="M12 3a1 1 0 0 0-.707.293l-7 7a1 1 0 0 0 0 1.414l7 7A1 1 0 0 0 13 18v-4.28c3.526.36 5.47 2.03 6.136 3.636a1 1 0 0 0 1.864-.728C20.143 14.07 17.368 11 13 10.29V6a1 1 0 0 0-1-1z" />
                </svg>
                <span className="text-sm text-slate-200">Voice</span>
              </label>
            </div>
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
              disabled={loading || !name.trim()}
              className="flex-1 rounded-lg bg-nexe-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-nexe-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Creating..." : "Create Channel"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
