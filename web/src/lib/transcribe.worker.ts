import { env, pipeline, Tensor } from "@huggingface/transformers";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import runtimeUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";

// The response CSP is set by the server, not hashed with this source. Keep
// changing this worker's content hash when that policy changes so immutable
// CDN entries cannot keep an obsolete CSP attached to the same URL.
// A single thread works without cross-origin isolation, including Electron and mobile browsers.
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
env.backends.onnx.wasm!.wasmPaths = { wasm: wasmUrl, mjs: runtimeUrl };
self.onmessage = async ({ data }: MessageEvent<Float32Array>) => {
  try {
    const model = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny", { dtype: "q8", device: "wasm", progress_callback: (info) => {
      if (info.status === "progress_total") self.postMessage({ phase: "loading", progress: Math.min(100, Math.max(0, Math.floor(info.progress))) });
    } });
    self.postMessage({ phase: "working" });
    try {
      // Whisper predicts a language token from the first window. The JS pipeline
      // currently defaults to English, so perform the model's detection pass explicitly.
      const features = await model.processor(data.subarray(0, 30 * 16000));
      const detection = await model.model({ input_features: features.input_features,
        decoder_input_ids: new Tensor("int64", [BigInt((model.model.config as unknown as { decoder_start_token_id: number }).decoder_start_token_id)], [1, 1]) });
      const logits = detection.logits as Tensor;
      const languages = (model.model.generation_config as unknown as { lang_to_id: Record<string, number> }).lang_to_id;
      let language = "en", score = -Infinity;
      for (const [token, id] of Object.entries(languages)) {
        const value = Number(logits.data[id]);
        if (value > score) { score = value; language = token.slice(2, -2); }
      }
      const result = await model(data, { language, chunk_length_s: 30, stride_length_s: 5, task: "transcribe" });
      self.postMessage({ text: Array.isArray(result) ? result.map((r) => r.text).join(" ") : result.text });
    } finally { await model.dispose(); }
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
