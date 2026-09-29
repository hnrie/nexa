/**
 * When the app pastes for the page: the bridge's `paste`, which Nexa's own
 * right-click menu on text uses (web/src/lib/textMenu.ts).
 *
 * The page may not read the clipboard (permissions.ts): the recovery key and
 * the two-factor backup codes pass through it, and a password manager's
 * output all day. Pasting for the page whenever it asked would hand the
 * clipboard over all the same, into a hidden box it then reads. So the app
 * pastes only the way a person pastes from a menu: a right click (or the menu
 * key, or Shift+F10) a little while ago, then a click (or Enter, or Space)
 * just now. Both are input the app saw arrive from the system, which a page
 * cannot make up, and each pair pastes once.
 */

/** How long a menu may stay open before its Paste is chosen. */
export const MENU_MS = 60_000;
/** How soon after the click that chose Paste the page's request has to arrive. */
export const CHOSEN_MS = 2_000;

export class PasteGate {
  private opened = Number.NEGATIVE_INFINITY;
  private chosen = Number.NEGATIVE_INFINITY;

  constructor(private readonly now: () => number = Date.now) {}

  /** A mouse button pressed or released in the window (webContents' input-event). */
  mouse(type: string, button: string | undefined): void {
    if ((type === "mouseDown" && button === "right") || type === "contextMenu") this.opened = this.now();
    else if (type === "mouseUp" && button === "left") this.chosen = this.now();
  }

  /** A key pressed in the window (webContents' before-input-event), by its DOM key name. */
  key(type: string, key: string, shift: boolean): void {
    if (type !== "keyDown") return;
    if (key === "ContextMenu" || (key === "F10" && shift)) this.opened = this.now();
    else if (key === "Enter" || key === " ") this.chosen = this.now();
  }

  /** Whether a paste asked for now follows a menu opened and a choice made in it. A pair pastes once. */
  allow(): boolean {
    const t = this.now();
    const ok = this.chosen >= this.opened && this.chosen - this.opened <= MENU_MS && t - this.chosen <= CHOSEN_MS;
    if (ok) {
      this.opened = Number.NEGATIVE_INFINITY;
      this.chosen = Number.NEGATIVE_INFINITY;
    }
    return ok;
  }
}
