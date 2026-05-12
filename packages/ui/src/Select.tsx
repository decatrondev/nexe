import { useState, useRef, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

// ── Types ──────────────────────────────────────────────

interface SelectOption {
  value: string;
  label: string;
  /** Optional icon/element before the label */
  icon?: ReactNode;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  /** Accent color class for focus ring (default: nexe-500) */
  accentClass?: string;
}

// ── Component ──────────────────────────────────────────

function Select({
  options,
  value,
  onChange,
  placeholder = "Select...",
  label,
  disabled = false,
  className = "",
  accentClass = "border-nexe-500",
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });

  const selected = options.find((o) => o.value === value);

  // Position dropdown
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropHeight = Math.min(options.length * 36 + 8, 240);

    setDropPos({
      top: spaceBelow >= dropHeight ? rect.bottom + 4 : rect.top - dropHeight - 4,
      left: rect.left,
      width: rect.width,
    });
  }, [open, options.length]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div className={className}>
      {label && (
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center justify-between rounded-lg border bg-dark-900 px-3 py-2 text-sm transition-colors ${
          open ? `${accentClass} ring-1 ring-nexe-500/30` : "border-dark-600"
        } ${disabled ? "cursor-not-allowed opacity-50" : "hover:border-dark-500"}`}
      >
        <span className={`flex items-center gap-2 truncate ${selected ? "text-slate-200" : "text-slate-500"}`}>
          {selected?.icon}
          {selected?.label ?? placeholder}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-select overflow-y-auto rounded-lg border border-dark-700 bg-dark-900 py-1 shadow-dropdown animate-fade-in"
            style={{ top: dropPos.top, left: dropPos.left, width: dropPos.width, maxHeight: 240 }}
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  opt.value === value
                    ? "bg-nexe-600/15 text-white"
                    : "text-slate-300 hover:bg-dark-800 hover:text-white"
                }`}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export { Select };
export type { SelectProps, SelectOption };
