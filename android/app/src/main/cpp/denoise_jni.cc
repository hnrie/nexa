// Enhanced noise suppression (voice.md 8.2): xiph's RNNoise on the
// microphone after echo cancellation and before the encoder, run from the
// audio processing module's capture post-processing hook. RNNoise works on
// 10 ms of 48 kHz mono (480 samples) in the 16-bit range, which is exactly
// one block of the processing module at 48 kHz; at a lower internal rate the
// block is stretched up to 48 kHz and back.
//
// The same pass applies the input volume (0 to 200 %) and measures the level
// voice activity and the speaking ring go by (RMS x 4, as LevelMeter).

#include <jni.h>
#include <math.h>
#include <stdint.h>
#include <string.h>

#include <algorithm>

extern "C" {
#include "rnnoise/rnnoise.h"
}

namespace {

constexpr int kFrame = 480;  // 10 ms at 48 kHz

struct Denoiser {
  DenoiseState* state = nullptr;
  float up[kFrame];
  float out[kFrame];
  float prev = 0.f;  // the last input sample of the block before, so stretching joins up
  long tone_at = 0;  // samples of test signal made so far
  uint32_t noise = 2463534242u;  // xorshift state of the test noise
};

// Linear stretch of `n` samples to `m`, continuing from `prev`.
void Stretch(const float* in, int n, float prev, float* out, int m) {
  for (int i = 0; i < m; i++) {
    const float pos = (float(i) + 1.f) * float(n) / float(m) - 1.f;
    const int a = int(floorf(pos));
    const float t = pos - float(a);
    const float x0 = a < 0 ? prev : in[std::min(a, n - 1)];
    const float x1 = in[std::min(a + 1, n - 1)];
    out[i] = x0 + (x1 - x0) * t;
  }
}

// A test signal in place of the microphone (debug builds): 1 is a steady 440 Hz
// tone, 2 the same in 1.5 s phrases with 1.5 s pauses, as the web's delay
// harness speaks, and 3 steady white noise (what noise suppression removes).
void Tone(Denoiser* d, float* data, int frames, int rate, int mode) {
  for (int i = 0; i < frames; i++) {
    const long n = d->tone_at++;
    if (mode == 3) {
      d->noise ^= d->noise << 13;
      d->noise ^= d->noise >> 17;
      d->noise ^= d->noise << 5;
      data[i] = (float(d->noise % 20001u) - 10000.f) * 0.4f;
      continue;
    }
    const double t = double(n) / double(rate);
    bool on = true;
    if (mode == 2) on = fmod(t, 3.0) < 1.5;
    data[i] = on ? float(sin(2.0 * M_PI * 440.0 * t) * 8000.0) : 0.f;
  }
}

}  // namespace

extern "C" {

JNIEXPORT jlong JNICALL Java_fish_nexa_voice_Denoise_nativeCreate(JNIEnv*, jobject) {
  auto* d = new Denoiser();
  d->state = rnnoise_create(nullptr);
  if (d->state == nullptr) {
    delete d;
    return 0;
  }
  return reinterpret_cast<jlong>(d);
}

JNIEXPORT void JNICALL Java_fish_nexa_voice_Denoise_nativeDestroy(JNIEnv*, jobject, jlong ptr) {
  auto* d = reinterpret_cast<Denoiser*>(ptr);
  if (d == nullptr) return;
  rnnoise_destroy(d->state);
  delete d;
}

// Processes one block in place. Returns its level (0..1), or -1 when the
// buffer could not be read. With `pass` off the block is measured and then
// silenced: voice activity still hears it, the encoder gets silence (and
// Opus's DTX sends next to nothing), and the stream's timestamps keep moving.
JNIEXPORT jfloat JNICALL Java_fish_nexa_voice_Denoise_nativeProcess(
    JNIEnv* env, jobject, jlong ptr, jobject buffer, jint frames, jint rate, jboolean denoise, jfloat gain, jint tone,
    jboolean pass) {
  auto* d = reinterpret_cast<Denoiser*>(ptr);
  auto* data = static_cast<float*>(env->GetDirectBufferAddress(buffer));
  const jlong capacity = env->GetDirectBufferCapacity(buffer);
  if (d == nullptr || data == nullptr || frames <= 0 || capacity < jlong(frames) * jlong(sizeof(float))) return -1.f;

  if (tone != 0) Tone(d, data, frames, rate > 0 ? rate : frames * 100, tone);

  if (denoise == JNI_TRUE && frames <= kFrame) {
    if (frames == kFrame) {
      rnnoise_process_frame(d->state, d->out, data);
      memcpy(data, d->out, sizeof(float) * kFrame);
    } else {
      const float last = data[frames - 1];
      Stretch(data, frames, d->prev, d->up, kFrame);
      rnnoise_process_frame(d->state, d->out, d->up);
      // and back down, sample for sample in time
      for (int i = 0; i < frames; i++) {
        const float pos = (float(i) + 1.f) * float(kFrame) / float(frames) - 1.f;
        const int a = std::max(0, std::min(kFrame - 1, int(lroundf(pos))));
        data[i] = d->out[a];
      }
      d->prev = last;
    }
  }

  double sum = 0;
  for (int i = 0; i < frames; i++) {
    float x = data[i];
    if (gain != 1.f) {
      x = std::max(-32768.f, std::min(32767.f, x * gain));
      data[i] = x;
    }
    const double s = double(x) / 32768.0;
    sum += s * s;
  }
  if (pass != JNI_TRUE) memset(data, 0, sizeof(float) * size_t(frames));
  return float(std::min(1.0, sqrt(sum / frames) * 4.0));
}

}  // extern "C"
