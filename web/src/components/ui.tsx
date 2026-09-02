import { formatUnits } from "viem";
import { cloneElement, isValidElement, useId } from "react";

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  // Identity comes from the border and the surface value. No coloured left-edge
  // stripe, no glass, no gradient: Universal.txt rules out all three, and the
  // luminance step is doing the work anyway.
  return (
    <div className={`rounded-2xl border border-moss-700/70 bg-ink-850 shadow-[0_8px_24px_rgba(0,20,8,0.16)] ${className}`}>{children}</div>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const styles = {
    primary: "bg-moss-600 text-ink-50 hover:bg-moss-500 disabled:bg-ink-700 disabled:text-ink-500",
    secondary: "border border-ink-600 text-ink-100 hover:border-ink-500 hover:bg-ink-800 disabled:text-ink-500",
    danger: "border border-clay-600 text-clay-400 hover:bg-clay-600/15 disabled:text-ink-500 disabled:border-ink-700",
    ghost: "text-ink-300 hover:bg-ink-800 hover:text-ink-100",
  }[variant];
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm
                  font-medium transition-colors duration-150 disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const inputId = `field-${id}`;
  const messageId = `field-message-${id}`;
  const describedBy = error || hint ? messageId : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id ?? inputId,
        "aria-invalid": error ? true : children.props["aria-invalid"],
        "aria-describedby": describedBy ?? children.props["aria-describedby"],
      })
    : children;

  return (
    <div className="block">
      <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-ink-300">{label}</label>
      {control}
      {error ? (
        <span id={messageId} role="alert" className="mt-1.5 block text-xs text-clay-400">{error}</span>
      ) : hint ? (
        <span id={messageId} className="mt-1.5 block text-xs text-ink-400">{hint}</span>
      ) : null}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm text-ink-100
                  placeholder:text-ink-500 transition-colors focus:border-moss-500
                  disabled:opacity-50 tnum ${props.className ?? ""}`}
    />
  );
}

/** Every figure in the app goes through here, so tabular numerals are not
 *  something anyone has to remember to add. */
export function Amount({
  value,
  decimals = 18,
  symbol,
  precision = 6,
  className = "",
}: {
  value: bigint;
  decimals?: number;
  symbol?: string;
  precision?: number;
  className?: string;
}) {
  const raw = formatUnits(value, decimals);
  const [whole, frac = ""] = raw.split(".");
  const shown = frac.slice(0, precision).padEnd(precision, "0");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (
    <span className={`tnum ${className}`}>
      {groupedWhole}
      {precision > 0 && <span className="text-ink-400">.{shown}</span>}
      {symbol && <span className="ml-1 text-ink-400">{symbol}</span>}
    </span>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "muted" | "warn";
}) {
  const styles = {
    neutral: "border-ink-600 text-ink-300",
    accent: "border-moss-600 text-moss-300",
    muted: "border-ink-700 text-ink-400",
    warn: "border-clay-600 text-clay-400",
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs ${styles}`}>
      {children}
    </span>
  );
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}
