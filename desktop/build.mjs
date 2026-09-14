// Bundles the main process and the preload script into dist-app/ with esbuild.
// Everything the app needs at runtime is inside these two files, so the
// installer carries no node_modules.
import { build } from "esbuild";

const production = process.env.NODE_ENV !== "development";
const common = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  sourcemap: production ? false : "inline",
  minify: production,
  legalComments: "none",
  external: ["electron"],
  logLevel: "warning",
};
await Promise.all([
  build({ ...common, entryPoints: ["src/main/index.ts"], outfile: "dist-app/main.js" }),
  // a sandboxed preload may only require electron itself, so it is bundled whole
  build({ ...common, entryPoints: ["src/preload/index.ts"], outfile: "dist-app/preload.js" }),
]);
console.log("built dist-app/main.js and dist-app/preload.js");
