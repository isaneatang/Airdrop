import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import { Portal } from "./Portal";
import { Icon } from "./Icon";

/**
 * Bottom sheet on narrow viewports and in wallet WebViews, anchored panel on
 * desktop. This is the single control that replaces every dropdown in the app.
 *
 * PART 10 lists four independent reasons native <select> and fixed-position menus
 * misbehave in wallet in-app browsers: the shell intercepts the system picker, a
 * transform ancestor captures position:fixed, 100vh includes the native toolbar,
 * and the wallet's own overlays collide in the stacking order. A portalled sheet
 * sized in dvh with an explicit z-index answers all four at once, and gives a
 * larger tap target while it is at it.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => focusable()[0]?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open, onClose]);

  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={onClose}
              className="fixed inset-0 bg-ink-950/70"
              style={{ zIndex: "var(--z-overlay)" }}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              ref={dialogRef}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 340 }}
              className="fixed inset-x-0 bottom-0 sm:inset-0 sm:m-auto sm:h-fit sm:max-w-md
                         rounded-t-2xl sm:rounded-2xl border border-ink-700 bg-ink-850
                         shadow-[0_-8px_40px_rgba(0,0,0,0.45)] sm:shadow-[0_8px_40px_rgba(0,0,0,0.5)]"
              style={{ zIndex: "var(--z-sheet)", maxHeight: "calc(var(--app-height) - 3rem)" }}
            >
              <div className="flex items-center justify-between border-b border-ink-700 px-5 py-4">
                 <h2 id={titleId} className="text-sm font-semibold text-ink-100">{title}</h2>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="rounded-lg p-1 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
                >
                  <Icon name="close" className="h-5 w-5" />
                </button>
              </div>
              <div className="safe-bottom overflow-y-auto px-5 py-4">{children}</div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </Portal>
  );
}

export interface Option<T> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * The dropdown replacement. Renders as a button plus a Sheet, never as a native
 * <select>, which is the control PART 10 identifies as failing outright inside
 * the wallet shell.
 */
export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonId = useId();
  const current = options.find((o) => o.value === value);

  return (
    <>
      <button
        type="button"
        id={buttonId}
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-xl border border-ink-600
                   bg-ink-900 px-4 py-3 text-left transition-colors hover:border-ink-500
                   disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="min-w-0">
          <span className="block text-xs text-ink-400">{label}</span>
          <span className="block truncate text-sm text-ink-100">{current?.label ?? "Select"}</span>
        </span>
        <Icon name="chevron" className="h-4 w-4 shrink-0 text-ink-400" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <ul className="space-y-1">
          {options.map((o) => {
            const active = o.value === value;
            return (
              <li key={String(o.value)}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition-colors
                    ${active ? "bg-moss-700/30 text-ink-50" : "text-ink-200 hover:bg-ink-800"}`}
                >
                  <span>
                    <span className="block text-sm">{o.label}</span>
                    {o.hint && <span className="block text-xs text-ink-400">{o.hint}</span>}
                  </span>
                  {active && <Icon name="check" className="h-4 w-4 text-moss-400" />}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}
