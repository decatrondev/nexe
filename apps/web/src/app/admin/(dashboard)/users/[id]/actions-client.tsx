"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { banUser, unbanUser, updateUser, setUserTier } from "./actions";

const TIERS = [
  { value: "free", label: "Free", color: "text-slate-400", bg: "bg-slate-400/10" },
  { value: "pro", label: "Pro", color: "text-blue-400", bg: "bg-blue-400/10" },
  { value: "ultra", label: "Ultra", color: "text-amber-400", bg: "bg-amber-400/10" },
];

interface UserActionsProps {
  userId: string;
  username: string;
  disabled: boolean;
  currentTier: string;
  tierExpiresAt: string | null;
}

export function UserActions({ userId, username, disabled, currentTier, tierExpiresAt }: UserActionsProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [newUsername, setNewUsername] = useState(username);
  const [loading, setLoading] = useState(false);
  const [confirmBan, setConfirmBan] = useState(false);

  // Tier state
  const [tier, setTier] = useState(currentTier);
  const [expiresAt, setExpiresAt] = useState(tierExpiresAt || "");
  const [tierLoading, setTierLoading] = useState(false);
  const [tierFeedback, setTierFeedback] = useState<string | null>(null);

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

  async function handleSetTier() {
    setTierLoading(true);
    setTierFeedback(null);
    try {
      await setUserTier(userId, tier, expiresAt || null);
      setTierFeedback("Tier updated!");
      setTimeout(() => setTierFeedback(null), 3000);
      router.refresh();
    } catch (err) {
      setTierFeedback(err instanceof Error ? err.message : "Failed");
    } finally {
      setTierLoading(false);
    }
  }

  const tierInfo = TIERS.find((t) => t.value === currentTier) || TIERS[0];

  return (
    <div className="space-y-4">
      {/* Tier Management */}
      <div className="rounded-xl border border-slate-800 bg-dark-800 p-5">
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-500">
          Subscription Tier
        </h3>
        <div className="mb-3 flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${tierInfo.color} ${tierInfo.bg}`}>
            {tierInfo.label}
          </span>
          {tierExpiresAt && (
            <span className="text-[10px] text-slate-600">
              expires {new Date(tierExpiresAt).toLocaleDateString()}
            </span>
          )}
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Tier</label>
            <div className="flex gap-1.5">
              {TIERS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTier(t.value)}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                    tier === t.value
                      ? `${t.bg} ${t.color} ring-1 ring-current`
                      : "bg-dark-900 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Expires (optional)</label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-dark-900 px-3 py-2 text-sm text-white outline-none focus:border-nexe-500"
            />
            <p className="mt-1 text-[10px] text-slate-700">Leave empty = no expiry (permanent)</p>
          </div>
          {tierFeedback && (
            <p className={`text-xs ${tierFeedback.includes("!") ? "text-emerald-400" : "text-red-400"}`}>{tierFeedback}</p>
          )}
          <button
            onClick={handleSetTier}
            disabled={tierLoading || tier === currentTier}
            className="w-full rounded-lg bg-nexe-600 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-nexe-700 disabled:opacity-50"
          >
            {tierLoading ? "Updating..." : "Apply Tier"}
          </button>
        </div>
      </div>

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
                onClick={() => { setEditing(false); setNewUsername(username); }}
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
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-red-400">Danger Zone</h3>
        {disabled ? (
          <button onClick={handleUnban} disabled={loading} className="w-full rounded-lg bg-green-600 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50">
            {loading ? "Processing..." : "Unban User"}
          </button>
        ) : confirmBan ? (
          <div className="space-y-3">
            <p className="text-xs text-red-300">This will disable the account globally.</p>
            <div className="flex gap-2">
              <button onClick={handleBan} disabled={loading} className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {loading ? "Banning..." : "Confirm Ban"}
              </button>
              <button onClick={() => setConfirmBan(false)} className="flex-1 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-400 hover:bg-dark-900 hover:text-white">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmBan(true)} className="w-full rounded-lg border border-red-800 px-3 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-950 hover:text-red-300">
            Ban User Globally
          </button>
        )}
      </div>
    </div>
  );
}
