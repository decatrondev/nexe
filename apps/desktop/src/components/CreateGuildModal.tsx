import { type FormEvent, useState } from "react";
import { useGuildStore } from "../stores/guild";
import { useAuthStore } from "../stores/auth";
import { FREE_TIER_LIMITS } from "../lib/limits";
import { Modal, ModalTitle, ModalDescription, ModalFooter, Button, Input, TextArea, Alert, Toggle } from "@nexe/ui";

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
  const guilds = useGuildStore((s) => s.guilds);
  const user = useAuthStore((s) => s.user);

  const ownedCount = guilds.filter((g) => g.ownerId === user?.id).length;
  const atLimit = ownedCount >= FREE_TIER_LIMITS.MAX_SERVERS_OWNED;

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
    <Modal open onClose={onClose}>
      <ModalTitle>Create a Server</ModalTitle>
      <ModalDescription>
        {ownedCount}/{FREE_TIER_LIMITS.MAX_SERVERS_OWNED} servers
      </ModalDescription>

      {atLimit && (
        <Alert variant="warning" className="mb-4">
          You've reached the maximum of {FREE_TIER_LIMITS.MAX_SERVERS_OWNED} servers
        </Alert>
      )}

      {error && (
        <Alert variant="error" className="mb-4">{error}</Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Server Name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="My Awesome Server"
          autoFocus
        />

        <TextArea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What is this server about?"
        />

        <Toggle
          checked={isStreamerServer}
          onChange={setIsStreamerServer}
          label="Streamer Server"
        />

        <ModalFooter>
          <Button variant="secondary" type="button" onClick={onClose} fullWidth>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={!name.trim() || atLimit}
            fullWidth
          >
            Create
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
