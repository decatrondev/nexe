import { useState } from "react";
import { useRelationshipStore } from "../stores/relationships";
import { useAuthStore } from "../stores/auth";
import { useGuildStore } from "../stores/guild";
import { useDMStore } from "../stores/dm";
import { userColor } from "../lib/utils";
import { toast } from "@nexe/ui";

export default function CreateGroupDMModal({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const myId = useAuthStore((s) => s.user?.id) ?? "";
  const relationships = useRelationshipStore((s) => s.relationships);
  const usernames = useGuildStore((s) => s.usernames);
  const avatarMap = useGuildStore((s) => s.avatarMap);

  const friends = relationships
    .filter((r) => r.type === "friend")
    .map((r) => r.userId === myId ? r.targetId : r.userId);

  const filtered = search
    ? friends.filter((id) => (usernames[id] || "").toLowerCase().includes(search.toLowerCase()))
    : friends;

  function toggle(id: string) {
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : s.length < 9 ? [...s, id] : s);
  }

  async function handleCreate() {
    if (selected.length < 1) return;
    setLoading(true);
    try {
      const groupName = name.trim() || selected.map((id) => usernames[id] || "User").join(", ");
      const ch = await useDMStore.getState().openGroupDM(groupName, selected);
      if (ch) onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create group DM");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[440px] rounded-xl bg-dark-800 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 pt-5 pb-2">
          <h2 className="text-lg font-bold text-white">Create Group DM</h2>
          <p className="mt-1 text-xs text-slate-400">
            Select friends to add. You can add up to 9 friends.
          </p>
        </div>

        {/* Group name */}
        <div className="px-5 pb-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name (optional)"
            className="w-full rounded-md bg-dark-900 px-3 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-nexe-500"
            maxLength={100}
          />
        </div>

        {/* Selected chips */}
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1 px-5 pb-2">
            {selected.map((id) => (
              <span
                key={id}
                className="flex items-center gap-1 rounded-full bg-nexe-500/20 px-2.5 py-0.5 text-xs font-medium text-nexe-300"
              >
                {usernames[id] || "User"}
                <button
                  onClick={() => toggle(id)}
                  className="ml-0.5 text-nexe-400 hover:text-white"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="px-5 pb-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search friends"
            className="w-full rounded-md bg-dark-900 px-3 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-500"
            autoFocus
          />
        </div>

        {/* Friend list */}
        <div className="max-h-52 overflow-y-auto px-3 pb-2">
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">
              {friends.length === 0 ? "No friends to add" : "No matches"}
            </p>
          ) : (
            filtered.map((id) => {
              const isSelected = selected.includes(id);
              const avatarUrl = avatarMap[id];
              const uname = usernames[id] || "User";
              const color = userColor(id);

              return (
                <button
                  key={id}
                  onClick={() => toggle(id)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                    isSelected ? "bg-nexe-500/10" : "hover:bg-dark-700/50"
                  }`}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={uname} className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {uname.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="flex-1 text-sm text-slate-200">{uname}</span>
                  <div className={`flex h-5 w-5 items-center justify-center rounded border ${
                    isSelected
                      ? "border-nexe-500 bg-nexe-500 text-white"
                      : "border-slate-600"
                  }`}>
                    {isSelected && (
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-dark-700 px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-slate-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={selected.length < 1 || loading}
            className="rounded-md bg-nexe-500 px-4 py-2 text-sm font-medium text-white hover:bg-nexe-600 disabled:opacity-50"
          >
            {loading ? "Creating..." : `Create Group DM${selected.length > 0 ? ` (${selected.length + 1})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
