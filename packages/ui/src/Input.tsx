import { type InputHTMLAttributes, type TextareaHTMLAttributes, forwardRef, type ReactNode } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = "", ...props }, ref) => {
    return (
      <div>
        {label && (
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`w-full rounded-lg border bg-dark-900 px-4 py-2.5 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-500 ${
            error
              ? "border-red-500 focus:border-red-400"
              : "border-dark-700 focus:border-nexe-500"
          } ${className}`}
          {...props}
        />
        {error && (
          <p className="mt-1 text-xs text-red-400">{error}</p>
        )}
        {hint && !error && (
          <p className="mt-1 text-xs text-slate-500">{hint}</p>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ label, error, className = "", ...props }, ref) => {
    return (
      <div>
        {label && (
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          className={`w-full resize-none rounded-lg border bg-dark-900 px-4 py-2.5 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-500 ${
            error
              ? "border-red-500 focus:border-red-400"
              : "border-dark-700 focus:border-nexe-500"
          } ${className}`}
          {...props}
        />
        {error && (
          <p className="mt-1 text-xs text-red-400">{error}</p>
        )}
      </div>
    );
  },
);

TextArea.displayName = "TextArea";

interface AlertProps {
  variant: "error" | "warning" | "info" | "success";
  children: ReactNode;
  className?: string;
}

const alertStyles: Record<AlertProps["variant"], string> = {
  error: "bg-red-500/10 text-red-400 border-red-500/20",
  warning: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  info: "bg-nexe-500/10 text-nexe-300 border-nexe-500/20",
  success: "bg-green-500/10 text-green-400 border-green-500/20",
};

function Alert({ variant, children, className = "" }: AlertProps) {
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${alertStyles[variant]} ${className}`}>
      {children}
    </div>
  );
}

export { Input, TextArea, Alert, type InputProps, type TextAreaProps, type AlertProps };
