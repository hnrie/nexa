/**
 * The picker's own page: screens first, then windows, each with the thumbnail
 * the main process captured, and a checkbox for the sound if this share can
 * carry any.
 *
 * It runs on a `file:` page with no network access and nothing on the window
 * but the three messages in preload.ts. Everything it draws comes from the one
 * offer it is handed; nothing here is ever built from a string the app did not
 * produce, and every label goes in as `textContent`.
 */
interface Source {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
  icon?: string;
}

interface Offer {
  sources: Source[];
  audio: boolean;
  dark: boolean;
}

declare const picker: {
  ready(onOffer: (offer: Offer) => void): void;
  choose(sourceId: string, withAudio: boolean): void;
  cancel(): void;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};

function draw(offer: Offer): void {
  document.documentElement.dataset.theme = offer.dark ? "dark" : "light";

  const root = document.getElementById("root")!;
  root.textContent = "";

  let chosen: string | null = null;
  const share = document.getElementById("share") as HTMLButtonElement;
  const sound = document.getElementById("sound") as HTMLInputElement;
  const soundRow = document.getElementById("soundRow")!;
  soundRow.hidden = !offer.audio;

  const select = (id: string, tile: HTMLElement) => {
    chosen = id;
    root.querySelectorAll<HTMLElement>(".tile").forEach((other) => { other.dataset.selected = String(other === tile); });
    share.disabled = false;
  };

  const group = (title: string, of: Source[]) => {
    if (of.length === 0) return;
    const heading = el("h2");
    heading.textContent = title;
    root.append(heading);
    const grid = el("div", "grid");
    for (const source of of) {
      const tile = el("button", "tile");
      tile.type = "button";
      tile.dataset.selected = "false";
      const shot = el("div", "shot");
      if (source.thumbnail) {
        const img = el("img");
        img.src = source.thumbnail;
        img.alt = "";
        shot.append(img);
      }
      const label = el("span", "label");
      if (source.icon) {
        const icon = el("img", "icon");
        icon.src = source.icon;
        icon.alt = "";
        label.append(icon);
      }
      const name = el("span", "name");
      name.textContent = source.name;
      label.append(name);
      tile.append(shot, label);
      tile.addEventListener("click", () => select(source.id, tile));
      // A double click is what everyone tries first, and it should not need
      // a second trip to the button in the corner.
      tile.addEventListener("dblclick", () => {
        select(source.id, tile);
        picker.choose(source.id, offer.audio && sound.checked);
      });
      grid.append(tile);
    }
    root.append(grid);
  };

  group("Screens", offer.sources.filter((s) => s.kind === "screen"));
  group("Windows", offer.sources.filter((s) => s.kind === "window"));

  if (offer.sources.length === 0) {
    const empty = el("p", "empty");
    empty.textContent = "This computer is not letting Nexa see the screen.";
    root.append(empty);
  }

  share.addEventListener("click", () => {
    if (chosen) picker.choose(chosen, offer.audio && sound.checked);
  });
  document.getElementById("cancel")!.addEventListener("click", () => picker.cancel());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") picker.cancel();
    if (e.key === "Enter" && chosen) picker.choose(chosen, offer.audio && sound.checked);
  });

  const first = root.querySelector<HTMLElement>(".tile");
  first?.focus();
}

picker.ready(draw);
