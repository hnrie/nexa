// Wix Madefor Display, the app's own face, loaded before any frame is drawn
import { continueRender, delayRender, staticFile } from "remotion";

export const fontFamily = "Madefor";

if (typeof document !== "undefined") {
  const handle = delayRender("Loading Wix Madefor Display");
  const face = new FontFace(fontFamily, `url(${staticFile("fonts/madefor.woff2")}) format("woff2")`, { weight: "400 900" });
  face.load().then((f) => {
    document.fonts.add(f);
    continueRender(handle);
  });
}
