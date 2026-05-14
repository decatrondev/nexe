import { type FormEvent, useState } from "react";
import { useGuildStore } from "../stores/guild";
import { Modal, ModalTitle, ModalFooter, Button, Input, Alert } from "@nexe/ui";

interface CreateChannelModalProps {
  defaultCategoryId?: string;
  onClose: () => void;
}

const channelTypes = [
  {
    value: "text",
    label: "Text",
    description: "Send messages, images, and links",
    icon: (
      <span className="text-2xl leading-none text-slate-400">#</span>
    ),
  },
  {
    value: "voice",
    label: "Voice",
    description: "Talk with voice and video",
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current text-slate-400">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-3.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
      </svg>
    ),
  },
  {
    value: "announcements",
    label: "Announcements",
    description: "Important updates from admins",
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current text-slate-400">
        <path d="M18 11v2h4v-2h-4zm-2 6.61c.96.71 2.21 1.65 3.2 2.39.4-.53.8-1.07 1.2-1.6-.99-.74-2.24-1.68-3.2-2.4-.4.54-.8 1.08-1.2 1.61zM20.4 5.6c-.4-.53-.8-1.07-1.2-1.6-.99.74-2.24 1.68-3.2 2.4.4.53.8 1.07 1.2 1.6.96-.72 2.21-1.65 3.2-2.4zM4 9c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2h1l5 3V6L5 9H4zm11.5 3c0-1.33-.58-2.53-1.5-3.35v6.69c.92-.81 1.5-2.01 1.5-3.34z" />
      </svg>
    ),
  },
  {
    value: "rules",
    label: "Rules",
    description: "Server rules and guidelines",
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current text-slate-400">
        <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-6h8v2H8v-2zm0-4h8v2H8v-2zm0 8h5v2H8v-2z" />
      </svg>
    ),
  },
];

export default function CreateChannelModal({
  defaultCategoryId,
  onClose,
}: CreateChannelModalProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState("text");
  const [categoryId, setCategoryId] = useState(defaultCategoryId || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const createChannel = useGuildStore((s) => s.createChannel);
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const allCategories = useGuildStore((s) => s.categories);
  const categories = activeGuildId ? allCategories[activeGuildId] || [] : [];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    setLoading(true);
    try {
      await createChannel(
        name.trim().toLowerCase().replace(/\s+/g, "-"),
        type,
        categoryId || undefined,
      );
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
        {/* Channel Type */}
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Channel Type
          </label>
          <div className="space-y-1.5">
            {channelTypes.map((ct) => (
              <button
                key={ct.value}
                type="button"
                onClick={() => setType(ct.value)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  type === ct.value
                    ? "border-nexe-500/50 bg-nexe-500/10"
                    : "border-dark-600 bg-dark-700 hover:border-dark-500 hover:bg-dark-650"
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-dark-800">
                  {ct.icon}
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${type === ct.value ? "text-white" : "text-slate-200"}`}>
                    {ct.label}
                  </p>
                  <p className="text-xs text-slate-500">{ct.description}</p>
                </div>
                <div className="ml-auto">
                  <div className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                    type === ct.value ? "border-nexe-500" : "border-dark-500"
                  }`}>
                    {type === ct.value && <div className="h-2.5 w-2.5 rounded-full bg-nexe-500" />}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Channel Name */}
        <Input
          label="Channel Name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="general"
          autoFocus
        />

        {/* Category */}
        {categories.length > 0 && (
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Category
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-lg border border-dark-600 bg-dark-700 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-nexe-500"
            >
              <option value="">No category</option>
              {categories
                .sort((a, b) => a.position - b.position)
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
          </div>
        )}

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
