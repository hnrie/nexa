import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
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

export default defineConfig({
  plugins: [react(), twemoji()],
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
