import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders into document.body.
 *
 * PART 10: an ancestor carrying transform, filter or will-change becomes the
 * containing block for position:fixed, so a menu nested inside one resolves
 * against that ancestor instead of the viewport and lands clipped or off-screen.
 * Framer Motion applies a transform for the duration of every animation, which
 * makes this the most likely cause in this app specifically. Portalling to the
 * document root sidesteps it entirely rather than auditing every ancestor.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = document.createElement("div");
    el.setAttribute("data-portal", "");
    document.body.appendChild(el);
    setHost(el);
    return () => {
      document.body.removeChild(el);
    };
  }, []);

  if (!host) return null;
  return createPortal(children, host);
}
