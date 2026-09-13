import { useEffect, useState } from "react";

const QUERY = "(max-width: 767px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

export function useIsMobile(): boolean {
  return useMediaQuery(QUERY);
}

/**
 * Phones and tablets or narrow windows (up to 1099px), where the chat has no
 * room for a member list or search column beside it, so those open over it.
 */
export function useIsNarrow(): boolean {
  return useMediaQuery("(max-width: 1099px)");
}
