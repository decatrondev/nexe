import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Max width class, e.g. "max-w-md", "max-w-lg" */
  maxWidth?: string;
  /** Show close button in top-right */
  showClose?: boolean;
}

function Modal({
  open,
  onClose,
  children,
  maxWidth = "max-w-md",
  showClose = false,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-modal-backdrop"
      onClick={onClose}
    >
      <div
        className={`relative w-full ${maxWidth} rounded-2xl bg-dark-850 p-6 shadow-2xl animate-modal-content`}
        onClick={(e) => e.stopPropagation()}
      >
        {showClose && (
          <button
            onClick={onClose}
            className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-dark-800 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

function ModalTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-1 text-xl font-bold text-slate-100">{children}</h2>;
}

function ModalDescription({ children }: { children: ReactNode }) {
  return <p className="mb-4 text-sm text-slate-400">{children}</p>;
}

function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="flex gap-3 pt-2">{children}</div>;
}

export { Modal, ModalTitle, ModalDescription, ModalFooter, type ModalProps };
