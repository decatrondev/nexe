import { useState, useEffect, useCallback, type ReactNode } from "react";

// ── Types ──────────────────────────────────────────────

type ToastVariant = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
}

interface ToastOptions {
  message: string;
  variant?: ToastVariant;
  /** Duration in ms. 0 = persistent until dismissed. Default: 4000 */
  duration?: number;
}

// ── Global store (pub/sub) ─────────────────────────────

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();
let nextId = 0;

function notify() {
  listeners.forEach((fn) => fn([...toasts]));
}

function addToast(options: ToastOptions): string {
  const id = `toast-${++nextId}`;
  const toast: Toast = {
    id,
    message: options.message,
    variant: options.variant ?? "info",
    duration: options.duration ?? 4000,
  };
  toasts = [...toasts, toast];
  notify();
  return id;
}

function removeToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

/** Global toast API — import and call from anywhere */
const toast = {
  show: (options: ToastOptions) => addToast(options),
  success: (message: string, duration?: number) => addToast({ message, variant: "success", duration }),
  error: (message: string, duration?: number) => addToast({ message, variant: "error", duration }),
  warning: (message: string, duration?: number) => addToast({ message, variant: "warning", duration }),
  info: (message: string, duration?: number) => addToast({ message, variant: "info", duration }),
  dismiss: (id: string) => removeToast(id),
};

// ── Hook ───────────────────────────────────────────────

function useToasts() {
  const [state, setState] = useState<Toast[]>(toasts);

  useEffect(() => {
    listeners.add(setState);
    return () => { listeners.delete(setState); };
  }, []);

  return state;
}

// ── Icons ──────────────────────────────────────────────

const icons: Record<ToastVariant, ReactNode> = {
  success: (
    <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
    <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  warning: (
    <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86l-8.58 14.86A1 1 0 002.56 20h18.88a1 1 0 00.85-1.28l-8.58-14.86a1 1 0 00-1.42 0z" />
    </svg>
  ),
  info: (
    <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
    </svg>
  ),
};

// ── Renderer ───────────────────────────────────────────

function ToastItem({ t }: { t: Toast }) {
  const [exiting, setExiting] = useState(false);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => removeToast(t.id), 200);
  }, [t.id]);

  useEffect(() => {
    if (t.duration <= 0) return;
    const timer = setTimeout(dismiss, t.duration);
    return () => clearTimeout(timer);
  }, [t.duration, dismiss]);

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-dark-700 bg-dark-900 px-4 py-3 shadow-lg transition-all duration-200 ${
        exiting ? "animate-fade-out" : "animate-slide-up"
      }`}
    >
      {icons[t.variant]}
      <p className="flex-1 text-sm text-slate-200">{t.message}</p>
      <button
        onClick={dismiss}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-500 transition-colors hover:text-slate-300"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function ToastContainer() {
  const items = useToasts();

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-toast flex flex-col-reverse gap-2" style={{ maxWidth: 380 }}>
      {items.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}

// ── Exports ────────────────────────────────────────────

export { toast, ToastContainer, useToasts };
export type { Toast, ToastVariant, ToastOptions };
