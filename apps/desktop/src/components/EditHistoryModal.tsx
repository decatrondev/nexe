import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatTimestamp } from "../lib/utils";
import { Modal, ModalTitle } from "@nexe/ui";

interface EditHistoryModalProps {
  messageId: string;
  currentContent: string;
  onClose: () => void;
}

interface EditEntry {
  id: string;
  messageId: string;
  oldContent: string;
  editedAt: string;
}

export default function EditHistoryModal({ messageId, currentContent, onClose }: EditHistoryModalProps) {
  const [edits, setEdits] = useState<EditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getEditHistory(messageId)
      .then((data) => setEdits(data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [messageId]);

  // Build full history: current version + all previous versions (newest first)
  const history = [
    { content: currentContent, editedAt: "", label: "Current" },
    ...edits.map((e, i) => ({
      content: e.oldContent,
      editedAt: e.editedAt,
      label: edits.length === 1 ? "Original" : i === edits.length - 1 ? "Original" : `Version ${edits.length - i}`,
    })),
  ];

  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg" showClose>
      <ModalTitle>Edit History</ModalTitle>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-nexe-500 border-t-transparent" />
        </div>
      ) : edits.length === 0 ? (
        <p className="py-4 text-sm text-slate-500">No edit history available.</p>
      ) : (
        <div className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1">
          {history.map((entry, idx) => (
            <div key={idx} className="rounded-lg border border-dark-700 bg-dark-900 p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className={`text-xs font-semibold ${idx === 0 ? "text-nexe-400" : "text-slate-500"}`}>
                  {entry.label}
                </span>
                {entry.editedAt && (
                  <span className="text-xs text-slate-600">
                    {formatTimestamp(entry.editedAt)}
                  </span>
                )}
              </div>
              <p className="text-sm leading-relaxed text-slate-300 whitespace-pre-wrap break-words">
                {entry.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
