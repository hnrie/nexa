/** The tray (or menu bar) icon: open the app, mute or deafen from anywhere, check for updates, quit. */
import { Menu, Tray, nativeImage } from "electron";
import { resourcePath } from "./window";

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
  tray.setToolTip("nexa");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open nexa", click: actions.show },
      { type: "separator" },
      { label: "Mute", click: actions.mute },
      { label: "Deafen", click: actions.deafen },
      { type: "separator" },
      { label: "Check for Updates", click: actions.checkUpdates },
      { label: "Quit nexa", click: actions.quit },
    ]),
  );
  // Windows and Linux open the window on a click; macOS keeps the click for the menu
  if (process.platform !== "darwin") tray.on("click", actions.show);
  return tray;
}
