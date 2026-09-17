/**
 * Reveals an element the first time it scrolls into view.
 *
 * It starts out shown. Hiding first and revealing later would leave a blank
 * page for anyone without JavaScript, without IntersectionObserver, or in a
 * crawler, so this only hides what it can prove is off screen: on mount, an
 * element already in view stays as it is, and one below the fold is hidden and
 * then animated in when it arrives.
 */
import { useEffect, useRef, useState } from "react";

export function useReveal<T extends HTMLElement>(margin = "0px 0px -12% 0px"): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const box = el.getBoundingClientRect();
    if (box.top < window.innerHeight) return; // already in view: leave it alone
    setSeen(false);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);

  return [ref, seen];
}
