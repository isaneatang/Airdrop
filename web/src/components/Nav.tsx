import { Icon } from "./Icon";
import type { Route } from "../hooks/useRoute";

const ITEMS = [
  { key: "streams", href: "#/streams", label: "Streams", icon: "streams" },
  { key: "create", href: "#/create", label: "Create", icon: "create" },
  { key: "airdrop", href: "#/airdrop", label: "Airdrop", icon: "airdrop" },
  { key: "account", href: "#/account", label: "Account", icon: "account" },
] as const;

function activeKey(route: Route): string {
  return route.name === "stream" ? "streams" : route.name;
}

/**
 * Bottom bar on mobile, top rail on desktop.
 *
 * Universal.txt asks for bottom navigation on mobile with multiple destinations.
 * It also sits naturally with the bottom sheets that replaced every dropdown, so
 * the two PART 10 remedies reinforce each other instead of competing for the
 * bottom edge.
 */
export function Nav({ route }: { route: Route }) {
  const active = activeKey(route);

  return (
    <>
      {/* Desktop */}
      <nav className="hidden border-b border-ink-700 bg-ink-900/95 sm:block" style={{ zIndex: "var(--z-nav)" }}>
        <div className="mx-auto flex max-w-3xl items-center gap-1 px-6 py-3">
          <span className="mr-4 text-sm font-semibold text-ink-100">Vested Distribution</span>
          {ITEMS.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                active === item.key ? "bg-ink-800 text-ink-50" : "text-ink-400 hover:text-ink-100"
              }`}
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      {/* Mobile */}
      <nav
        className="safe-bottom fixed inset-x-0 bottom-0 border-t border-ink-700 bg-ink-900/98 backdrop-blur-none sm:hidden"
        style={{ zIndex: "var(--z-nav)" }}
      >
        <ul className="flex">
          {ITEMS.map((item) => (
            <li key={item.key} className="flex-1">
              <a
                href={item.href}
                aria-current={active === item.key ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors ${
                  active === item.key ? "text-moss-400" : "text-ink-400"
                }`}
              >
                <Icon name={item.icon} className="h-5 w-5" />
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
