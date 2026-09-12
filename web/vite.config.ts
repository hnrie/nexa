import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
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
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          crypto: ["@noble/curves", "@noble/hashes", "hash-wasm"],
        },
      },
    },
  },
  worker: { format: "es" },
});
