import { useState } from "react";

// ── Default preset colors (Discord-inspired) ───────────

const DEFAULT_PRESETS = [
  "#5865F2", "#57F287", "#FEE75C", "#EB459E", "#ED4245",
  "#F47B67", "#E67E22", "#1ABC9C", "#3498DB", "#9B59B6",
  "#E91E63", "#2ECC71", "#00BCD4", "#FF9800", "#8BC34A",
  "#99AAB5",
];

// ── Types ──────────────────────────────────────────────

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  /** Preset color swatches. Uses default palette if not provided. */
  presets?: string[];
  /** Label above the picker */
  label?: string;
  className?: string;
}

// ── Component ──────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  label,
  className = "",
}: ColorPickerProps) {
  const [customOpen, setCustomOpen] = useState(false);

  return (
    <div className={className}>
      {label && (
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </label>
      )}

      <div className="flex flex-wrap gap-1.5">
        {presets.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onChange(color)}
            className={`h-7 w-7 rounded-full transition-all ${
              value === color
                ? "ring-2 ring-white ring-offset-2 ring-offset-dark-900 scale-110"
                : "hover:scale-110"
            }`}
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}

        {/* Custom color picker */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setCustomOpen(!customOpen)}
            className={`flex h-7 w-7 items-center justify-center rounded-full border border-dashed transition-colors ${
              !presets.includes(value)
                ? "border-white"
                : "border-slate-500 text-slate-400 hover:border-slate-400"
            }`}
            style={!presets.includes(value) ? { backgroundColor: value } : undefined}
            title="Custom color"
          >
            {presets.includes(value) && (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                <path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0 1 12 22zm0-18c-4.41 0-8 3.59-8 8s3.59 8 8 8c.28 0 .5-.22.5-.5a.54.54 0 0 0-.14-.35c-.41-.46-.63-1.05-.63-1.65a2.5 2.5 0 0 1 2.5-2.5H16c2.21 0 4-1.79 4-4 0-3.86-3.59-7-8-7z" />
              </svg>
            )}
          </button>

          {customOpen && (
            <div className="absolute left-0 top-full z-10 mt-2 rounded-lg border border-dark-700 bg-dark-800 p-3 shadow-xl animate-fade-in">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <input
                  type="text"
                  value={value}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
                  }}
                  className="w-20 rounded border border-dark-600 bg-dark-900 px-2 py-1 font-mono text-xs text-slate-200 outline-none focus:border-nexe-500"
                  maxLength={7}
                  placeholder="#000000"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { ColorPicker, DEFAULT_PRESETS };
export type { ColorPickerProps };
