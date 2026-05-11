import { type FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useGuildStore } from "../stores/guild";
import { nexeWS } from "../lib/websocket";
import { useAuthStore } from "../stores/auth";
import { Modal, ModalTitle, ModalFooter, Button, Input, Alert } from "@nexe/ui";

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
        const currentGuilds = useGuildStore.getState().guilds;
        if (currentGuilds.length > 0) {
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
    <Modal open onClose={onClose}>
      <ModalTitle>Join a Server</ModalTitle>

      {loading && (
        <div className="mb-4 flex items-center gap-2 text-sm text-slate-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-nexe-500 border-t-transparent" />
          Joining server...
        </div>
      )}

      {error && (
        <Alert variant="error" className="mb-4">{error}</Alert>
      )}

      {!initialCode && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Invite Code or Link"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            required
            placeholder="ABCD1234 or https://nexe.decatron.net/invite/..."
            autoFocus
          />

          <ModalFooter>
            <Button variant="secondary" type="button" onClick={onClose} fullWidth>
              Cancel
            </Button>
            <Button type="submit" loading={loading} disabled={!input.trim()} fullWidth>
              Join Server
            </Button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  );
}
