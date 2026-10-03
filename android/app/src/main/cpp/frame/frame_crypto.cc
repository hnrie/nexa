// Sealing and opening call frames, in the format web/src/voice/frameCrypto.ts
// describes: clear header | AES-256-GCM ciphertext and tag | iv (12) | key index (1).
//
// libwebrtc hands every encoded frame to a sender's encryptor before it is
// packetised, and every assembled frame to a receiver's decryptor before it
// is decoded. The key index is the conversation epoch's low byte, so a call
// keeps playing while its keys rotate.

#include <jni.h>
#include <stdlib.h>
#include <string.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <map>
#include <memory>
#include <mutex>
#include <shared_mutex>

#include "aes_gcm.h"
#include "sealed_frame.h"
#include "webrtc_abi.h"

namespace nexa {
namespace {

void RandomBytes(uint8_t* out, size_t len) {
  arc4random_buf(out, len);
}

// The keys of one call: the newest epochs this device holds, and which one seals.
class KeySet {
 public:
  void Set(const std::map<int, std::array<uint8_t, 32>>& keys, int send_index) {
    std::unique_lock<std::shared_mutex> lock(mu_);
    ciphers_.clear();
    for (const auto& [index, raw] : keys) ciphers_[index & 0xff].Init(raw.data());
    send_index_ = send_index;
  }

  // Runs `fn` with the cipher for `index`, if there is one.
  template <typename F>
  bool With(int index, F&& fn) {
    std::shared_lock<std::shared_mutex> lock(mu_);
    auto it = ciphers_.find(index);
    if (it == ciphers_.end()) return false;
    fn(it->second);
    return true;
  }

  template <typename F>
  bool WithSending(F&& fn) {
    std::shared_lock<std::shared_mutex> lock(mu_);
    if (send_index_ < 0) return false;
    auto it = ciphers_.find(send_index_ & 0xff);
    if (it == ciphers_.end()) return false;
    fn(it->second, send_index_ & 0xff);
    return true;
  }

  std::atomic<int64_t> sealed{0};
  std::atomic<int64_t> opened{0};
  std::atomic<int64_t> dropped{0};
  std::atomic<int64_t> oversize{0};

 private:
  // Rekeying is rare and sealing is not, so readers never queue behind each other.
  std::shared_mutex mu_;
  std::map<int, AesGcm> ciphers_;
  int send_index_ = -1;
};

using KeySetPtr = std::shared_ptr<KeySet>;

// Reference counting as libwebrtc expects it: whoever makes one holds the first
// reference, and libwebrtc's scoped_refptr adds and drops its own.
template <typename Base>
class RefCounted : public Base {
 public:
  void AddRef() const override { refs_.fetch_add(1, std::memory_order_relaxed); }

  webrtc::RefCountReleaseStatus Release() const override {
    if (refs_.fetch_sub(1, std::memory_order_acq_rel) == 1) {
      delete this;
      return webrtc::RefCountReleaseStatus::kDroppedLastRef;
    }
    return webrtc::RefCountReleaseStatus::kOtherRefsRemained;
  }

 protected:
  ~RefCounted() override = default;

 private:
  mutable std::atomic<int> refs_{1};
};

class Encryptor : public RefCounted<webrtc::FrameEncryptorInterface> {
 public:
  explicit Encryptor(KeySetPtr keys) : keys_(std::move(keys)) { RandomBytes(salt_, kSaltLen); }

  int Encrypt(webrtc::MediaType media_type,
              uint32_t /*ssrc*/,
              webrtc::ArrayView<const uint8_t> /*additional_data*/,
              webrtc::ArrayView<const uint8_t> frame,
              webrtc::ArrayView<uint8_t> encrypted_frame,
              size_t* bytes_written) override {
    const uint8_t* data = frame.data();
    const size_t len = frame.size();
    // DTX's empty frames carry nothing to protect (the audio channel never
    // hands one over; this is only belt and braces)
    if (len == 0) {
      *bytes_written = 0;
      return 0;
    }
    if (encrypted_frame.size() < len + kFrameOverhead) return -1;

    // 8 random bytes chosen per sender, then a counter: never the same iv
    // twice under one key. Receivers read the iv out of the frame, so how it
    // is put together is the sender's business.
    std::lock_guard<std::mutex> lock(iv_mu_);
    if (counter_ == 0xffffffffu) {
      RandomBytes(salt_, kSaltLen);
      counter_ = 0;
    }
    uint8_t iv[kIvLen];
    memcpy(iv, salt_, kSaltLen);
    const uint32_t counter = counter_++;
    iv[8] = uint8_t(counter >> 24);
    iv[9] = uint8_t(counter >> 16);
    iv[10] = uint8_t(counter >> 8);
    iv[11] = uint8_t(counter);

    const bool video = media_type == webrtc::MEDIA_TYPE_VIDEO;
    const bool ok = keys_->WithSending([&](const AesGcm& cipher, int index) {
      *bytes_written = SealFrame(cipher, index, iv, video, data, len, encrypted_frame.data());
    });
    // no key, nothing sent: never in the clear, never under another call's key
    if (!ok) {
      keys_->dropped.fetch_add(1, std::memory_order_relaxed);
      return -1;
    }
    keys_->sealed.fetch_add(1, std::memory_order_relaxed);
    return 0;
  }

  size_t GetMaxCiphertextByteSize(webrtc::MediaType /*media_type*/, size_t frame_size) override {
    return frame_size + kFrameOverhead;
  }

 private:
  KeySetPtr keys_;
  std::mutex iv_mu_;
  uint8_t salt_[kSaltLen] = {};
  uint32_t counter_ = 0;
};

class Decryptor : public RefCounted<webrtc::FrameDecryptorInterface> {
 public:
  explicit Decryptor(KeySetPtr keys) : keys_(std::move(keys)) {}

  Result Decrypt(webrtc::MediaType media_type,
                 const void* /*csrcs*/,
                 webrtc::ArrayView<const uint8_t> /*additional_data*/,
                 webrtc::ArrayView<const uint8_t> encrypted_frame,
                 webrtc::ArrayView<uint8_t> frame) override {
    seen_.fetch_add(1, std::memory_order_relaxed);
    const uint8_t* data = encrypted_frame.data();
    const size_t len = encrypted_frame.size();
    const int index = FrameKeyIndex(data, len);
    if (index < 0 || frame.size() < len - kTrailer - kTagLen) return Fail();

    const bool video = media_type == webrtc::MEDIA_TYPE_VIDEO;
    long written = -1;
    keys_->With(index, [&](const AesGcm& cipher) { written = OpenFrame(cipher, video, data, len, frame.data()); });
    if (written <= 0) return Fail();

    if (video) {
      // frameSize.ts: a key frame over the cap is never decoded, nor anything
      // after it until a key frame within the cap comes along
      int width = 0, height = 0;
      if (Vp8KeyFrameSize(frame.data(), size_t(written), &width, &height)) {
        if (!FitsVideoCap(width, height)) {
          blocked_.store(true, std::memory_order_relaxed);
          too_large_.store(width > 0 && height > 0, std::memory_order_relaxed);
          keys_->oversize.fetch_add(1, std::memory_order_relaxed);
          return Fail();
        }
        blocked_.store(false, std::memory_order_relaxed);
        too_large_.store(false, std::memory_order_relaxed);
      } else if (blocked_.load(std::memory_order_relaxed)) {
        return Fail();
      }
    }
    opened_.fetch_add(1, std::memory_order_relaxed);
    keys_->opened.fetch_add(1, std::memory_order_relaxed);
    return Result(Status::kOk, size_t(written));
  }

  size_t GetMaxPlaintextByteSize(webrtc::MediaType /*media_type*/, size_t encrypted_frame_size) override {
    return encrypted_frame_size;
  }

  int64_t seen() const { return seen_.load(std::memory_order_relaxed); }
  int64_t opened() const { return opened_.load(std::memory_order_relaxed); }
  bool too_large() const { return too_large_.load(std::memory_order_relaxed); }

 private:
  Result Fail() {
    keys_->dropped.fetch_add(1, std::memory_order_relaxed);
    return Result(Status::kFailedToDecrypt, 0);
  }

  KeySetPtr keys_;
  std::atomic<int64_t> seen_{0};
  std::atomic<int64_t> opened_{0};
  std::atomic<bool> blocked_{false};
  std::atomic<bool> too_large_{false};
};

// The handle Kotlin holds: a shared_ptr kept alive on the heap.
struct KeysHandle {
  KeySetPtr keys;
};

std::array<uint8_t, 32> KeyFrom(JNIEnv* env, jbyteArray raw) {
  std::array<uint8_t, 32> key{};
  env->GetByteArrayRegion(raw, 0, 32, reinterpret_cast<jbyte*>(key.data()));
  return key;
}

}  // namespace
}  // namespace nexa

using nexa::Decryptor;
using nexa::Encryptor;
using nexa::KeySet;
using nexa::KeysHandle;

extern "C" {

JNIEXPORT jlong JNICALL Java_fish_nexa_voice_FrameCryptoNative_nativeCreateKeys(JNIEnv*, jobject) {
  auto* handle = new KeysHandle{std::make_shared<KeySet>()};
  return reinterpret_cast<jlong>(handle);
}

JNIEXPORT void JNICALL Java_fish_nexa_voice_FrameCryptoNative_nativeSetKeys(
    JNIEnv* env, jobject, jlong handle_ptr, jintArray j_indices, jobjectArray j_keys, jint send_index) {
  auto* handle = reinterpret_cast<KeysHandle*>(handle_ptr);
  if (handle == nullptr) return;
  std::map<int, std::array<uint8_t, 32>> keys;
  // a mismatch would read past the end of one array, and a pending JNI
  // exception makes every call after it undefined
  const jsize count = std::min(env->GetArrayLength(j_indices), env->GetArrayLength(j_keys));
  jint* indices = env->GetIntArrayElements(j_indices, nullptr);
  if (indices == nullptr) return;
  for (jsize i = 0; i < count; i++) {
    auto raw = reinterpret_cast<jbyteArray>(env->GetObjectArrayElement(j_keys, i));
    if (raw == nullptr) continue;
    // in ascending epoch order: when two epochs share a low byte the newer wins
    if (env->GetArrayLength(raw) == 32) keys[indices[i] & 0xff] = nexa::KeyFrom(env, raw);
    env->DeleteLocalRef(raw);
  }
  env->ReleaseIntArrayElements(j_indices, indices, JNI_ABORT);
  handle->keys->Set(keys, send_index);
}

JNIEXPORT void JNICALL Java_fish_nexa_voice_FrameCryptoNative_nativeReleaseKeys(JNIEnv*, jobject, jlong handle_ptr) {
  delete reinterpret_cast<KeysHandle*>(handle_ptr);
}

JNIEXPORT jlong JNICALL Java_fish_nexa_voice_FrameCryptoNative_nativeCreateEncryptor(JNIEnv*, jobject, jlong handle_ptr) {
  auto* handle = reinterpret_cast<KeysHandle*>(handle_ptr);
  if (handle == nullptr) return 0;
  return reinterpret_cast<jlong>(static_cast<webrtc::FrameEncryptorInterface*>(new Encryptor(handle->keys)));
}

JNIEXPORT jlong JNICALL Java_fish_nexa_voice_FrameCryptoNative_nativeCreateDecryptor(JNIEnv*, jobject, jlong handle_ptr) {
  auto* handle = reinterpret_cast<KeysHandle*>(handle_ptr);
  if (handle == nullptr) return 0;
  return reinterpret_cast<jlong>(static_cast<webrtc::FrameDecryptorInterface*>(new Decryptor(handle->keys)));
}

JNIEXPORT void JNICALL Java_fish_nexa_voice_FrameCryptoNative_nativeReleaseEncryptor(JNIEnv*, jobject, jlong ptr) {
  if (ptr != 0) reinterpret_cast<webrtc::FrameEncryptorInterface*>(ptr)->Release();
}

JNIEXPORT void JNICALL Java_fish_nexa_voice_FrameCryptoNative_nativeReleaseDecryptor(JNIEnv*, jobject, jlong ptr) {
  if (ptr != 0) reinterpret_cast<webrtc::FrameDecryptorInterface*>(ptr)->Release();
}

JNIEXPORT jlongArray JNICALL Java_fish_nexa_voice_FrameCryptoNative_nativeStats(JNIEnv* env, jobject, jlong handle_ptr) {
  jlong out[4] = {0, 0, 0, 0};
  auto* handle = reinterpret_cast<KeysHandle*>(handle_ptr);
  if (handle != nullptr) {
    out[0] = handle->keys->sealed.load(std::memory_order_relaxed);
    out[1] = handle->keys->opened.load(std::memory_order_relaxed);
    out[2] = handle->keys->dropped.load(std::memory_order_relaxed);
    out[3] = handle->keys->oversize.load(std::memory_order_relaxed);
  }
  jlongArray arr = env->NewLongArray(4);
  if (arr == nullptr) return nullptr;
  env->SetLongArrayRegion(arr, 0, 4, out);
  return arr;
}

// {frames seen, frames opened, picture too large (0/1)} of one receiver.
JNIEXPORT jlongArray JNICALL Java_fish_nexa_voice_FrameCryptoNative_nativeDecryptorCounts(JNIEnv* env, jobject, jlong ptr) {
  jlong out[3] = {0, 0, 0};
  if (ptr != 0) {
    // the Decryptor is the only FrameDecryptorInterface this library makes
    auto* d = static_cast<Decryptor*>(reinterpret_cast<webrtc::FrameDecryptorInterface*>(ptr));
    out[0] = d->seen();
    out[1] = d->opened();
    out[2] = d->too_large() ? 1 : 0;
  }
  jlongArray arr = env->NewLongArray(3);
  if (arr == nullptr) return nullptr;
  env->SetLongArrayRegion(arr, 0, 3, out);
  return arr;
}

// Seals one frame with a given key, index and iv: for checking this build
// against the web client's vectors (voice.md 5.10).
JNIEXPORT jbyteArray JNICALL Java_fish_nexa_voice_FrameCryptoNative_nativeSealForTest(
    JNIEnv* env, jobject, jbyteArray j_key, jint index, jbyteArray j_iv, jboolean video, jbyteArray j_plain) {
  if (env->GetArrayLength(j_key) != 32 || env->GetArrayLength(j_iv) != 12) return nullptr;
  nexa::AesGcm cipher;
  auto key = nexa::KeyFrom(env, j_key);
  cipher.Init(key.data());
  uint8_t iv[12];
  env->GetByteArrayRegion(j_iv, 0, 12, reinterpret_cast<jbyte*>(iv));
  const jsize len = env->GetArrayLength(j_plain);
  std::unique_ptr<uint8_t[]> plain(new uint8_t[len > 0 ? len : 1]);
  env->GetByteArrayRegion(j_plain, 0, len, reinterpret_cast<jbyte*>(plain.get()));
  std::unique_ptr<uint8_t[]> out(new uint8_t[len + nexa::kFrameOverhead]);
  const size_t n = nexa::SealFrame(cipher, index, iv, video == JNI_TRUE, plain.get(), size_t(len), out.get());
  jbyteArray arr = env->NewByteArray(jsize(n));
  if (arr != nullptr) env->SetByteArrayRegion(arr, 0, jsize(n), reinterpret_cast<jbyte*>(out.get()));
  return arr;
}

JNIEXPORT jbyteArray JNICALL Java_fish_nexa_voice_FrameCryptoNative_nativeOpenForTest(
    JNIEnv* env, jobject, jbyteArray j_key, jboolean video, jbyteArray j_sealed) {
  if (env->GetArrayLength(j_key) != 32) return nullptr;
  nexa::AesGcm cipher;
  auto key = nexa::KeyFrom(env, j_key);
  cipher.Init(key.data());
  const jsize len = env->GetArrayLength(j_sealed);
  std::unique_ptr<uint8_t[]> sealed(new uint8_t[len > 0 ? len : 1]);
  env->GetByteArrayRegion(j_sealed, 0, len, reinterpret_cast<jbyte*>(sealed.get()));
  std::unique_ptr<uint8_t[]> out(new uint8_t[len > 0 ? len : 1]);
  const long n = nexa::OpenFrame(cipher, video == JNI_TRUE, sealed.get(), size_t(len), out.get());
  if (n < 0) return nullptr;
  jbyteArray arr = env->NewByteArray(jsize(n));
  if (arr != nullptr) env->SetByteArrayRegion(arr, 0, jsize(n), reinterpret_cast<jbyte*>(out.get()));
  return arr;
}

}  // extern "C"
