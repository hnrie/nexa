import { useEffect, useState } from "react";

let held = false;
const listeners = new Set<(v: boolean) => void>();

function set(v: boolean): void {
  if (held === v) return;
  held = v;
  for (const l of listeners) l(v);
}

if (typeof window !== "undefined") {
  // one pair of listeners for the whole app, however many rows subscribe
  window.addEventListener("keydown", (e) => e.key === "Shift" && set(true));
  window.addEventListener("keyup", (e) => e.key === "Shift" && set(false));
  window.addEventListener("blur", () => set(false));
}

/** True while Shift is held; message rows swap their hover toolbar for quick actions. */
export function useShiftHeld(): boolean {
  const [v, setV] = useState(held);
  useEffect(() => {
    listeners.add(setV);
    setV(held);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}
