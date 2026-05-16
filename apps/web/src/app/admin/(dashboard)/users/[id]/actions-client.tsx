"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { banUser, unbanUser, updateUser } from "./actions";

interface UserActionsProps {
  userId: string;
  username: string;
  disabled: boolean;
}

export function UserActions({ userId, username, disabled }: UserActionsProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [newUsername, setNewUsername] = useState(username);
  const [loading, setLoading] = useState(false);
  const [confirmBan, setConfirmBan] = useState(false);

  async function handleBan() {
    setLoading(true);
    await banUser(userId);
    setConfirmBan(false);
    setLoading(false);
    router.refresh();
  }

  async function handleUnban() {
    setLoading(true);
    await unbanUser(userId);
    setLoading(false);
    router.refresh();
  }

  async function handleUpdate() {
    if (!newUsername.trim() || newUsername === username) {
      setEditing(false);
      return;
    }
    setLoading(true);
    await updateUser(userId, { username: newUsername.trim() });
    setLoading(false);
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Edit Username */}
      <div className="rounded-xl border border-slate-800 bg-dark-800 p-5">
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-500">
          Edit User
        </h3>
        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Username</label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-dark-900 px-3 py-2 text-sm text-white outline-none focus:border-nexe-500"
                maxLength={32}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleUpdate}
                disabled={loading}
                className="flex-1 rounded-lg bg-nexe-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-nexe-700 disabled:opacity-50"
              >
                {loading ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setNewUsername(username);
                }}
                className="flex-1 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-dark-900 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="w-full rounded-lg border border-slate-700 px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-dark-900 hover:text-white"
          >
            Edit Username
          </button>
        )}
      </div>

      {/* Ban/Unban */}
      <div className="rounded-xl border border-red-900/30 bg-dark-800 p-5">
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-red-400">
          Danger Zone
        </h3>
        {disabled ? (
          <button
            onClick={handleUnban}
            disabled={loading}
            className="w-full rounded-lg bg-green-600 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? "Processing..." : "Unban User"}
          </button>
        ) : confirmBan ? (
          <div className="space-y-3">
            <p className="text-xs text-red-300">
              This will disable the account globally. The user won&apos;t be able to log in.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleBan}
                disabled={loading}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? "Banning..." : "Confirm Ban"}
              </button>
              <button
                onClick={() => setConfirmBan(false)}
                className="flex-1 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-dark-900 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmBan(true)}
            className="w-full rounded-lg border border-red-800 px-3 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-950 hover:text-red-300"
          >
            Ban User Globally
          </button>
        )}
      </div>
    </div>
  );
}
