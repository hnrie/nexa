/**
 * Reading electron-builder's update manifests (latest.yml and friends) and
 * comparing versions. The manifests are a small, fixed shape of YAML, so they
 * are read here rather than with a YAML library.
 */

export interface ManifestFile {
  url: string;
  sha512: string;
  size: number;
}

export interface Manifest {
  version: string;
  files: ManifestFile[];
  releaseDate?: string;
}

function scalar(v: string): string {
  const s = v.trim();
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) return s.slice(1, -1);
  return s;
}

export function parseManifest(text: string): Manifest {
  const lines = text.split(/\r?\n/);
  const out: Manifest = { version: "", files: [] };
  let inFiles = false;
  let current: Partial<ManifestFile> | null = null;
  const push = () => {
    if (current?.url && current.sha512) out.files.push({ url: current.url, sha512: current.sha512, size: Number(current.size ?? 0) });
    current = null;
  };
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const top = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (top) {
      push();
      inFiles = top[1] === "files" && top[2] === "";
      if (top[1] === "version") out.version = scalar(top[2]!);
      if (top[1] === "releaseDate") out.releaseDate = scalar(top[2]!);
      continue;
    }
    if (!inFiles) continue;
    const item = /^\s*-\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    const field = /^\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (item) {
      push();
      current = {};
      (current as Record<string, string>)[item[1]!] = scalar(item[2]!);
    } else if (field && current) {
      (current as Record<string, string>)[field[1]!] = scalar(field[2]!);
    }
  }
  push();
  return out;
}

/** -1, 0 or 1 as a is older than, the same as, or newer than b (x.y.z, pre-release tags older). */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre] = v.replace(/^v/, "").split("-", 2);
    return { nums: (core ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? "" };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}
