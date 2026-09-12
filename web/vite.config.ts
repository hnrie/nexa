import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8090",
      "/media": "http://127.0.0.1:8090",
      "/gateway": { target: "ws://127.0.0.1:8090", ws: true },
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
