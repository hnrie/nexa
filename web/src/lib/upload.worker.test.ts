import type { PieceRequest } from "./upload.worker";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("sends exactly the remaining view after a partial upload, without its skipped prefix", async () => {
  vi.useFakeTimers();
  const scope = { onmessage: null as ((e: MessageEvent<PieceRequest>) => void) | null, postMessage: vi.fn() };
  let sent: Blob | undefined;
  class XHR {
    upload = {};
    open = vi.fn();
    setRequestHeader = vi.fn();
    abort = vi.fn();
    send(body: Blob): void { sent = body; }
  }
  vi.stubGlobal("self", scope);
  vi.stubGlobal("XMLHttpRequest", XHR);
  await import("./upload.worker");
  const body = new Uint8Array([11, 22, 33, 44, 55]);
  scope.onmessage!({ data: { url: "/upload", method: "PATCH", headers: {}, body: body.buffer, offset: 2, length: 2 } } as MessageEvent<PieceRequest>);
  expect(new Uint8Array(await sent!.arrayBuffer())).toEqual(new Uint8Array([33, 44]));
});
