import { useEffect, useState } from "react";
import { api, type Invite } from "../lib/api";
import { copyToClipboard } from "../lib/utils";
import { Modal, ModalTitle, Button, Input, Alert } from "@nexe/ui";

interface InviteModalProps {
  guildId: string;
  channelId: string;
  onClose: () => void;
}

export default function InviteModal({ guildId, channelId, onClose }: InviteModalProps) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

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
    <Modal open onClose={onClose}>
      <ModalTitle>Invite People</ModalTitle>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-nexe-500 border-t-transparent" />
          <span className="ml-3 text-sm text-slate-400">Creating invite link...</span>
        </div>
      )}

      {error && (
        <Alert variant="error" className="mb-4">{error}</Alert>
      )}

      {invite && !loading && (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
              Invite Link
            </label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={`https://nexe.decatron.net/invite/${invite.code}`}
              />
              <Button
                variant={copied ? "success" : "primary"}
                onClick={handleCopy}
              >
                {copied ? "Copied!" : "Copy Link"}
              </Button>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Share this link with others to invite them to the server.
          </p>
        </div>
      )}

      {!loading && (
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </Modal>
  );
}
