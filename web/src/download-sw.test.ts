import { encryptFile } from "./crypto/file";

afterEach(() => vi.unstubAllGlobals());

it("transfers an authenticated download stream to a chosen file without navigating a frame", async () => {
  const plain = new Uint8Array([10, 20, 30, 40]);
  const { key, blob } = await encryptFile(new Blob([plain]));
  const listeners = new Map<string, (event: unknown) => void>();
  vi.stubGlobal("self", {
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    location: new URL("https://nexa.test/download-sw.js"),
  });
  let cipher = blob;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(cipher)));
  await import("./download-sw");
  const channel = new MessageChannel();
  try {
    const body = new Promise<ReadableStream<Uint8Array>>((resolve, reject) => {
      channel.port1.onmessage = (event) => {
        if (event.data.type === "file") resolve(event.data.body);
        if (event.data.type === "error") reject(new Error(event.data.message));
      };
    });
    listeners.get("message")!({ data: {
      type: "download", toFile: true, id: "a".repeat(32),
      url: "https://nexa.test/media/attachments/123", token: null,
      key, name: "original.bin", size: plain.length,
    }, ports: [channel.port2] });
    const received: number[] = [];
    await (await body).pipeTo(new WritableStream({ write(bytes) { received.push(...bytes); } }));
    expect(received).toEqual([...plain]);
    // A corrupt encrypted body must abort the chosen file, never close a
    // partial file as though it had saved successfully.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    bytes[bytes.length - 1]! ^= 1;
    cipher = new Blob([bytes]);
    const failed = new Promise<ReadableStream<Uint8Array>>((resolve) => {
      channel.port1.onmessage = (event) => {
        if (event.data.type === "file") resolve(event.data.body);
      };
    });
    listeners.get("message")!({ data: {
      type: "download", toFile: true, id: "b".repeat(32),
      url: "https://nexa.test/media/attachments/123", token: null,
      key, name: "original.bin", size: plain.length,
    }, ports: [channel.port2] });
    const abort = vi.fn();
    const close = vi.fn();
    await expect((await failed).pipeTo(new WritableStream({ abort, close }))).rejects.toThrow();
    expect(abort).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();

  } finally {
    channel.port1.close();
    channel.port2.close();
  }
});
