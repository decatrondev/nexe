import { type ReactNode } from "react";

// ── Toggle / Switch ────────────────────────────────────

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}

function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  size = "md",
  className = "",
}: ToggleProps) {
  const trackSize = size === "sm" ? "h-4 w-7" : "h-5 w-9";
  const thumbSize = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const thumbTranslate = size === "sm" ? "translate-x-3" : "translate-x-4";

  return (
    <label className={`flex items-center gap-3 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${className}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex shrink-0 rounded-full transition-colors duration-200 ${trackSize} ${
          checked ? "bg-nexe-500" : "bg-dark-600"
        }`}
      >
        <span
          className={`inline-block rounded-full bg-white shadow-sm transition-transform duration-200 ${thumbSize} ${
            checked ? thumbTranslate : "translate-x-0.5"
          } translate-y-0.5`}
        />
      </button>
      {(label || description) && (
        <div className="flex-1">
          {label && <span className="text-sm text-slate-200">{label}</span>}
          {description && <p className="text-xs text-slate-500">{description}</p>}
        </div>
      )}
    </label>
  );
}

// ── Checkbox ───────────────────────────────────────────

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

function Checkbox({ checked, onChange, label, disabled = false, className = "" }: CheckboxProps) {
  return (
    <label className={`flex items-center gap-2.5 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${className}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition-colors ${
          checked
            ? "border-nexe-500 bg-nexe-500 text-white"
            : "border-dark-500 bg-dark-900 hover:border-dark-400"
        }`}
      >
        {checked && (
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
      {label && <span className="text-sm text-slate-300">{label}</span>}
    </label>
  );
}

// ── Radio Group ────────────────────────────────────────

interface RadioOption {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
}

interface RadioGroupProps {
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  /** "card" renders bordered cards, "simple" renders inline dots */
  variant?: "card" | "simple";
  disabled?: boolean;
  className?: string;
}

function RadioGroup({
  options,
  value,
  onChange,
  variant = "card",
  disabled = false,
  className = "",
}: RadioGroupProps) {
  if (variant === "simple") {
    return (
      <div className={`space-y-2 ${className}`}>
        {options.map((opt) => (
          <label
            key={opt.value}
            className={`flex items-center gap-2.5 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
          >
            <span
              onClick={() => !disabled && onChange(opt.value)}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                value === opt.value
                  ? "border-nexe-500"
                  : "border-dark-500 hover:border-dark-400"
              }`}
            >
              {value === opt.value && (
                <span className="h-2 w-2 rounded-full bg-nexe-500" />
              )}
            </span>
            <span className="text-sm text-slate-200">{opt.label}</span>
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className={`flex gap-3 ${className}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={`flex flex-1 items-center gap-2 rounded-lg border px-4 py-3 transition-colors ${
            value === opt.value
              ? "border-nexe-500 bg-nexe-500/10"
              : "border-dark-700 bg-dark-900 hover:border-dark-600"
          } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
        >
          {opt.icon}
          <div>
            <span className="text-sm text-slate-200">{opt.label}</span>
            {opt.description && <p className="text-xs text-slate-500">{opt.description}</p>}
          </div>
        </button>
      ))}
    </div>
  );
}

export { Toggle, Checkbox, RadioGroup };
export type { ToggleProps, CheckboxProps, RadioGroupProps, RadioOption };
