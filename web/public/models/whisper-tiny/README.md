# Whisper Tiny

Model files are committed directly to Git so clients download only from Nexa.
Vite copies this directory to `/models/whisper-tiny/` in each web build.
Web and desktop use the quantized ONNX encoder and merged decoder with the JSON
configuration and tokenizer. Android uses `ggml-tiny.bin`. Transcription stays
on the device. Do not add these files to the initial page load or Android APK.

`manifest.json` records the exact upstream revisions, byte sizes and SHA-256
hashes. These are original upstream bytes. Whisper is MIT licensed; see LICENSE.
Keep the Android size and SHA-256 constants in Transcripts.kt in sync if replacing
the GGML weights. Keep the previous filenames available if changing model paths
so already open clients can still download them.
