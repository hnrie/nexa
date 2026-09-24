import { defineConfig } from "vitest/config";
import { searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // the legal documents live in docs/legal, as in vite.config.ts
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), fileURLToPath(new URL("../docs/legal", import.meta.url))] } },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
