/**
 * Hand-drawn icon set. Universal.txt rules out Lucide; these are custom so the
 * stroke weight can sit with the muted palette instead of over-asserting.
 * One consistent 24-box, 1.5 stroke, round caps.
 */
type Name =
  | "streams" | "create" | "airdrop" | "account" | "check" | "close"
  | "chevron" | "external" | "wallet" | "warning" | "clock" | "lock";

const paths: Record<Name, React.ReactNode> = {
  streams: <><path d="M3 8h7a4 4 0 0 1 4 4v0a4 4 0 0 0 4 4h4" /><path d="M17 5l4 3-4 3" /></>,
  create: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  airdrop: <><path d="M12 3v10" /><path d="M8 9l4 4 4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>,
  account: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  close: <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>,
  chevron: <path d="M6 9l6 6 6-6" />,
  external: <><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M16 12h3" /></>,
  warning: <><path d="M12 4l9 16H3z" /><path d="M12 10v4" /><path d="M12 17.5v.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
};

export function Icon({ name, className = "w-5 h-5" }: { name: Name; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
