#!/usr/bin/env node
/**
 * Refuses to build unless the build is meant to go live.
 *
 * There is no deploy step in this project: `vite build` writes into
 * `web/dist`, and `web/dist` is the directory chatd serves — the daemon's
 * `WEB_DIST` is `./web/dist` and its working directory is the repository root.
 * So `npm run build`, run for any reason at all, publishes whatever is in the
 * working tree to chat.evilion.xyz, immediately, with no confirmation and no
 * way back except building again.
 *
 * That is fine when the person running it means it. It is not fine as the
 * default behaviour of the most ordinary command in a JavaScript project,
 * which is what someone reaches for to check that their change compiles — and
 * it is genuinely dangerous when several people, or several agents, have
 * unfinished work in the tree at once.
 *
 * So the deploy says so. `make web` sets it. To check a build without
 * publishing one, use `npm run typecheck`, or build somewhere else:
 *
 *   npx vite build --outDir /tmp/dist-check --emptyOutDir
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..", "dist");

// Only the real serving directory is guarded; a build aimed anywhere else
// cannot publish anything and needs no ceremony.
const target = process.argv.slice(2).includes("--outDir") ? null : out;

if (target && process.env.DEPLOY !== "1") {
  const live = existsSync(resolve(target, "index.html"));
  console.error(
    `\nRefusing to build into ${target}.\n\n` +
      `That directory is what chat.evilion.xyz serves${live ? ", and it currently holds a live build" : ""}.\n` +
      `Building here publishes the working tree to everyone, at once.\n\n` +
      `  npm run typecheck                                   check it compiles\n` +
      `  npx vite build --outDir /tmp/dist-check --emptyOutDir   build it somewhere harmless\n` +
      `  DEPLOY=1 npm run build                              publish it, on purpose\n`,
  );
  process.exit(1);
}
