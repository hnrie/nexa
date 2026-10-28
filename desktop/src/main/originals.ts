import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const TYPES = new Set([
  "image/png", "image/apng", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon",
  "video/mp4", "video/webm", "video/ogg", "video/quicktime",
]);
const MAX_BYTES = 256 * 1024 * 1024;
const LIFETIME = 10 * 60_000;

/** Hand a decrypted original to the default browser without uploading it or writing it to disk. */
export class Originals {
  private files = new Map<string, { bytes: Buffer; type: string; name: string; timer: ReturnType<typeof setTimeout> }>();
  private listening: Promise<string> | undefined;
  private closed = false;
  private server = createServer((req, res) => {
    const address = this.server.address();
    const file = this.files.get(req.url ?? "");
    if (!address || typeof address === "string" || req.headers.host !== `127.0.0.1:${address.port}` || !file || (req.method !== "GET" && req.method !== "HEAD")) {
      res.writeHead(404, { "Cache-Control": "no-store" });
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": file.type,
      "Content-Length": file.bytes.length,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    res.end(req.method === "HEAD" ? undefined : file.bytes);
  });

  constructor(private launch: (url: string) => Promise<void>) {}

  private base(): Promise<string> {
    this.listening ??= new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.removeListener("error", reject);
        this.server.unref();
        const address = this.server.address();
        if (!address || typeof address === "string") return reject(new Error("no local address"));
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    return this.listening;
  }

  async open(bytes: unknown, type: unknown, name: unknown): Promise<void> {
    if (this.closed || !(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES || typeof type !== "string" || !TYPES.has(type) || typeof name !== "string") throw new Error("invalid original");
    let used = [...this.files.values()].reduce((total, file) => total + file.bytes.length, 0);
    while (used + bytes.byteLength > MAX_BYTES || this.files.size >= 8) {
      const oldest = this.files.keys().next().value!;
      used -= this.files.get(oldest)!.bytes.length;
      this.forget(oldest);
    }
    const filename = name.slice(0, 160).replace(/[\uD800-\uDFFF]/gu, "_").replace(/[\x00-\x1f\x7f/\\]/g, "_").trim() || "original";
    const path = `/${randomBytes(32).toString("hex")}/${encodeURIComponent(filename)}`;
    const timer = setTimeout(() => this.forget(path), LIFETIME);
    timer.unref();
    this.files.set(path, { bytes: Buffer.from(bytes), type, name: filename, timer });
    try {
      const base = await this.base();
      if (this.closed) throw new Error("originals closed");
      await this.launch(base + path);
    } catch (err) {
      this.forget(path);
      throw err;
    }
  }

  private forget(path: string): void {
    const file = this.files.get(path);
    if (file) clearTimeout(file.timer);
    this.files.delete(path);
  }

  dispose(): void {
    this.closed = true;
    for (const path of this.files.keys()) this.forget(path);
    this.server.close();
    this.server.closeAllConnections();
  }
}
