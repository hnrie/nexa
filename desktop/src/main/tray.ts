/** The tray (or menu bar) icon: open the app, mute or deafen from anywhere, check for updates, quit. */
import { Menu, Tray, nativeImage } from "electron";
import { resourcePath } from "./window";
import { nativeStrings } from "./strings";

export interface TrayActions {
  show(): void;
  mute(): void;
  deafen(): void;
  checkUpdates(): void;
  quit(): void;
}

export function createTray(actions: TrayActions): Tray {
  const image = nativeImage.createFromPath(resourcePath(process.platform === "darwin" ? "trayTemplate.png" : "tray.png"));
  if (process.platform === "darwin") image.setTemplateImage(true);
  const tray = new Tray(image);
  tray.setToolTip("Nexa");
  fillTray(tray, actions);
  // Windows and Linux open the window on a click; macOS keeps the click for the menu
  if (process.platform !== "darwin") tray.on("click", actions.show);
  return tray;
}

/** Builds the menu from the words in use; called again when the language changes. */
export function fillTray(tray: Tray, actions: TrayActions): void {
  const s = nativeStrings();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: s.open, click: actions.show },
      { type: "separator" },
      { label: s.mute, click: actions.mute },
      { label: s.deafen, click: actions.deafen },
      { type: "separator" },
      { label: s.checkForUpdates, click: actions.checkUpdates },
      { label: s.quit, click: actions.quit },
    ]),
  );
}
