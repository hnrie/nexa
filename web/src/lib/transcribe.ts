/** Whisper Tiny runs in a disposable worker. Only model files are downloaded; audio and text stay in memory. */
export type TranscriptPhase = "loading" | "working";
export async function transcribeVoice(src: string, phase: (value: TranscriptPhase) => void, signal: AbortSignal): Promise<string> {
  phase("loading");
  signal.throwIfAborted();
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error("audio unavailable");
  const bytes = await response.arrayBuffer();
  const decoder = new AudioContext({ sampleRate: 16000 });
  let pcm: Float32Array;
  try {
    const audio = await decoder.decodeAudioData(bytes);
    if (audio.duration > 601) throw new Error("recording too long");
    const offline = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000);
    const source = offline.createBufferSource();
    source.buffer = audio;
    source.connect(offline.destination);
    source.start();
    pcm = (await offline.startRendering()).getChannelData(0);
  } finally {
    await decoder.close();
  }
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./transcribe.worker.ts", import.meta.url), { type: "module" });
    const finish = () => { worker.terminate(); signal.removeEventListener("abort", abort); };
    const abort = () => { finish(); reject(new DOMException("Cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<{ phase?: TranscriptPhase; text?: string; error?: boolean }>) => {
      if (data.phase) phase(data.phase);
      else { finish(); if (data.error) reject(new Error("transcription failed")); else resolve(data.text?.trim() ?? ""); }
    };
    worker.onerror = () => { finish(); reject(new Error("transcription worker failed")); };
    worker.postMessage(pcm, [pcm.buffer]);
  });
}
