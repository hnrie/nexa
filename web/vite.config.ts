import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync } from "node:fs";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const API = process.env["VITE_API_TARGET"] ?? "http://127.0.0.1:8090";

const TWEMOJI_DIR = fileURLToPath(new URL("./node_modules/@twemoji/svg", import.meta.url));

/**
 * Serves Twemoji from this instance instead of a CDN, so rendering an emoji
 * never tells a third party who is reading what.
 */
function twemoji(): Plugin {
  return {
    name: "twemoji-assets",
    configureServer(server) {
      server.middlewares.use("/twemoji", (req, res, next) => {
        const name = (req.url ?? "").replace(/^\//, "").split("?")[0] ?? "";
        const file = `${TWEMOJI_DIR}/${name}`;
        if (!/^[0-9a-f-]+\.svg$/.test(name) || !existsSync(file)) return next();
        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        createReadStream(file).pipe(res);
      });
    },
    async closeBundle() {
      const out = fileURLToPath(new URL("./dist/twemoji", import.meta.url));
      await mkdir(out, { recursive: true });
      await cp(TWEMOJI_DIR, out, { recursive: true, filter: (src) => !src.endsWith(".json") && !src.endsWith(".md") && !src.endsWith("license") });
    },
  };
}

/**
 * Marks the app's own tags so a CDN leaves them alone. Cloudflare's Rocket
 * Loader rewrites `type="module"` into a private type and loads the script
 * itself later, which breaks the module graph and makes a dynamic import fail
 * at random. `data-cfasync="false"` is the documented way to opt a tag out.
 */
function keepScriptsIntact(): Plugin {
  return {
    name: "keep-scripts-intact",
    transformIndexHtml(html) {
      return html
        .replace(/<script (?![^>]*data-cfasync)/g, '<script data-cfasync="false" ')
        .replace(/<link (?![^>]*data-cfasync)/g, '<link data-cfasync="false" ');
    },
  };
}

/** How long a replaced build's files stay reachable. */
const KEEP_ASSETS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deletes hashed files from builds older than a week. Names carry their own
 * content hash, so nothing here is ever overwritten, only added to.
 */
function pruneOldAssets(): Plugin {
  return {
    name: "prune-old-assets",
    async closeBundle() {
      const dir = fileURLToPath(new URL("./dist/assets", import.meta.url));
      if (!existsSync(dir)) return;
      const cutoff = Date.now() - KEEP_ASSETS_MS;
      for (const name of await readdir(dir)) {
        const file = `${dir}/${name}`;
        const info = await stat(file);
        if (info.isFile() && info.mtimeMs < cutoff) await rm(file, { force: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), twemoji(), keepScriptsIntact(), pruneOldAssets()],
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      // VITE_API_TARGET points the dev server at a throwaway chatd instead of
      // the one running for real on this box.
      "/api": API,
      "/media": API,
      "/gateway": { target: API.replace(/^http/, "ws"), ws: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    // A page that is already open still asks for the files its own build was
    // compiled with. Wiping them on every deploy is what makes an open tab
    // break; they are kept for a week instead and pruned below.
    emptyOutDir: false,
    rollupOptions: {
      input: { main: fileURLToPath(new URL("./index.html", import.meta.url)), sw: fileURLToPath(new URL("./src/sw.ts", import.meta.url)) },
      output: {
        entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
        manualChunks: (id) => {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router")) return "react";
          if (id.includes("@noble") || id.includes("hash-wasm")) return "crypto";
          return undefined;
        },
      },
    },
  },
  worker: { format: "es" },
});
