/**
 * Keeps two measurements of the on-screen keyboard on the document root:
 * --kb-inset, how much of the page's bottom it covers, and --vvh, the height
 * still visible above it. Bottom sheets use them to sit above the keyboard
 * instead of behind it. Chrome on Android already makes room for the keyboard
 * (the viewport asks it to resize the content), which leaves the inset at 0;
 * iOS Safari does not, and this is how the sheet learns where it went.
 */
export function installKeyboardInset(): void {
  if (typeof window === "undefined") return;
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let frame = 0;
  const update = (): void => {
    frame = 0;
    const covered = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    root.style.setProperty("--kb-inset", `${Math.round(covered)}px`);
    root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
  };
  const soon = (): void => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  vv.addEventListener("resize", soon);
  vv.addEventListener("scroll", soon);
  update();
}
