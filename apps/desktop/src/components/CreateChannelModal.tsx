import { type FormEvent, useState } from "react";
import { useGuildStore } from "../stores/guild";
import { Modal, ModalTitle, ModalFooter, Button, Input, Alert } from "@nexe/ui";

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
    <Modal open onClose={onClose}>
      <ModalTitle>Create Channel</ModalTitle>

      {error && (
        <Alert variant="error" className="mb-4">{error}</Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Channel Name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="general"
          autoFocus
        />

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

        <ModalFooter>
          <Button variant="secondary" type="button" onClick={onClose} fullWidth>
            Cancel
          </Button>
          <Button type="submit" loading={loading} disabled={!name.trim()} fullWidth>
            Create Channel
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
