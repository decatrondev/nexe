import { useState, type ReactNode } from "react";
import { Modal, ModalTitle, ModalDescription, ModalFooter } from "./Modal";
import { Button } from "./Button";

// ── Types ──────────────────────────────────────────────

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: ReactNode;
  /** Text for the confirm button. Default: "Confirm" */
  confirmLabel?: string;
  /** Text for the cancel button. Default: "Cancel" */
  cancelLabel?: string;
  /** Button variant for confirm. Default: "danger" */
  variant?: "danger" | "primary" | "success";
  /** If set, user must type this text to enable confirm */
  confirmText?: string;
}

// ── Component ──────────────────────────────────────────

function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  confirmText,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false);
  const [typed, setTyped] = useState("");

  const needsTyping = !!confirmText;
  const canConfirm = !needsTyping || typed === confirmText;

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // Keep dialog open on error
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (loading) return;
    setTyped("");
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} maxWidth="420px">
      <ModalTitle>{title}</ModalTitle>
      {description && <ModalDescription>{description}</ModalDescription>}

      {needsTyping && (
        <div className="mt-3">
          <p className="mb-2 text-sm text-slate-400">
            Type <span className="font-mono font-semibold text-white">{confirmText}</span> to confirm:
          </p>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="w-full rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 text-sm text-slate-200 outline-none focus:border-nexe-500"
            autoFocus
          />
        </div>
      )}

      <ModalFooter>
        <Button variant="ghost" onClick={handleClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant={variant}
          onClick={handleConfirm}
          loading={loading}
          disabled={!canConfirm}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export { ConfirmDialog };
export type { ConfirmDialogProps };
