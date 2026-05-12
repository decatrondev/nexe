import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "../../apps/*/src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        nexe: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
        dark: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
          950: "#020617",
        },
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)",
        dropdown: "0 4px 12px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.3)",
        modal: "0 8px 30px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
        tooltip: "0 2px 8px rgba(0,0,0,0.4)",
        popover: "0 4px 20px rgba(0,0,0,0.45), 0 1px 6px rgba(0,0,0,0.3)",
      },
      zIndex: {
        sticky: "10",
        dropdown: "40",
        overlay: "50",
        modal: "60",
        popover: "70",
        tooltip: "100",
        select: "150",
        toast: "200",
      },
    },
  },
  plugins: [],
};

export default config;
