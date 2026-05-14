import { useState } from "react";
import { api, type Invite } from "../lib/api";
import { copyToClipboard } from "../lib/utils";
import { Modal, ModalTitle, Button, Input, Alert, toast } from "@nexe/ui";

interface InviteModalProps {
  guildId: string;
  channelId: string;
  onClose: () => void;
}

const EXPIRE_OPTIONS = [
  { value: 1800, label: "30 minutes" },
  { value: 3600, label: "1 hour" },
  { value: 21600, label: "6 hours" },
  { value: 43200, label: "12 hours" },
  { value: 86400, label: "1 day" },
  { value: 604800, label: "7 days" },
  { value: 0, label: "Never" },
];

const USES_OPTIONS = [
  { value: 0, label: "No limit" },
  { value: 1, label: "1 use" },
  { value: 5, label: "5 uses" },
  { value: 10, label: "10 uses" },
  { value: 25, label: "25 uses" },
  { value: 50, label: "50 uses" },
  { value: 100, label: "100 uses" },
];

function formatExpiry(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function InviteModal({ guildId, channelId, onClose }: InviteModalProps) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [maxAge, setMaxAge] = useState(604800); // default 7 days
  const [maxUses, setMaxUses] = useState(0); // default no limit

  async function handleGenerate() {
    setError("");
    setLoading(true);
    try {
      const inv = await api.createInvite(
        guildId,
        channelId,
        maxAge || undefined,
        maxUses || undefined,
      );
      setInvite(inv);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!invite) return;
    const link = `https://nexe.decatron.net/invite/${invite.code}`;
    copyToClipboard(link);
    toast.success("Invite link copied!");
  }

  return (
    <Modal open onClose={onClose}>
      <ModalTitle>Invite People</ModalTitle>

      {error && (
        <Alert variant="error" className="mb-4">{error}</Alert>
      )}

      {!invite ? (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Expire After
            </label>
            <select
              value={maxAge}
              onChange={(e) => setMaxAge(Number(e.target.value))}
              className="w-full rounded-lg border border-dark-600 bg-dark-700 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-nexe-500"
            >
              {EXPIRE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Max Uses
            </label>
            <select
              value={maxUses}
              onChange={(e) => setMaxUses(Number(e.target.value))}
              className="w-full rounded-lg border border-dark-600 bg-dark-700 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-nexe-500"
            >
              {USES_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <Button
            variant="primary"
            onClick={handleGenerate}
            loading={loading}
            fullWidth
          >
            Generate Invite Link
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Invite Link
            </label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={`https://nexe.decatron.net/invite/${invite.code}`}
              />
              <Button variant="primary" onClick={handleCopy}>
                Copy
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-500">
            {invite.expiresAt ? (
              <span>Expires in {formatExpiry(invite.expiresAt)}</span>
            ) : (
              <span>Never expires</span>
            )}
            {invite.maxUses ? (
              <span>{invite.uses || 0}/{invite.maxUses} uses</span>
            ) : (
              <span>Unlimited uses</span>
            )}
          </div>

          <Button
            variant="secondary"
            onClick={() => setInvite(null)}
            fullWidth
            className="text-xs"
          >
            Generate New Link
          </Button>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
