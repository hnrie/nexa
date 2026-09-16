// Sealing and opening call frames, in the format web/src/voice/frameCrypto.ts
// describes: clear header | AES-256-GCM ciphertext and tag | iv (12) | key index (1).
//
// The clear header is what packetisers and the SFU read (Opus's TOC byte,
// VP8's payload header) and is authenticated as additional data. The key index
// is the conversation epoch's low byte, so a call keeps playing while keys rotate.

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

namespace evilion {
namespace {

void RandomBytes(uint8_t* out, size_t len) {
  arc4random_buf(out, len);
}

// The keys of one call: every epoch this device holds, and which one seals.
class KeySet {
 public:
  void Set(const std::map<int, std::array<uint8_t, 32>>& keys, int send_index) {
    std::unique_lock<std::shared_mutex> lock(mu_);
    ciphers_.clear();
    for (const auto& [index, raw] : keys) {
      ciphers_[index].Init(raw.data());
    }
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
    auto it = ciphers_.find(send_index_);
    if (it == ciphers_.end()) return false;
    fn(it->second, send_index_);
    return true;
  }

  std::atomic<int64_t> sealed{0};
  std::atomic<int64_t> opened{0};
  std::atomic<int64_t> dropped{0};

 private:
  // Rekeying is rare and sealing is not, so readers do not queue behind each other.
  std::shared_mutex mu_;
  std::map<int, AesGcm> ciphers_;
  int send_index_ = -1;
};

using KeySetPtr = std::shared_ptr<KeySet>;

// Reference counting as libwebrtc expects it: the caller hands out one
// reference, and scoped_refptr in libwebrtc adds and drops its own.
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
    if (encrypted_frame.size() < len + kFrameOverhead) return -1;

    // 8 random bytes chosen per sender, then a counter: never the same iv
    // twice under one key. Receivers read the iv out of the frame, so how it
    // is put together is the sender's business.
    uint8_t iv[kIvLen];
    memcpy(iv, salt_, kSaltLen);
    const uint32_t counter = counter_.fetch_add(1, std::memory_order_relaxed);
    if (counter == 0xffffffffu) RandomBytes(salt_, kSaltLen);  // wrapped: start a new salt
    iv[8] = uint8_t(counter >> 24);
    iv[9] = uint8_t(counter >> 16);
    iv[10] = uint8_t(counter >> 8);
    iv[11] = uint8_t(counter);

    const bool video = media_type == webrtc::MEDIA_TYPE_VIDEO;
    const bool ok = keys_->WithSending([&](const AesGcm& cipher, int index) {
      *bytes_written = SealFrame(cipher, index, iv, video, data, len, encrypted_frame.data());
    });
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
  uint8_t salt_[kSaltLen] = {};
  std::atomic<uint32_t> counter_{0};
};

class Decryptor : public RefCounted<webrtc::FrameDecryptorInterface> {
 public:
  explicit Decryptor(KeySetPtr keys) : keys_(std::move(keys)) {}

  Result Decrypt(webrtc::MediaType media_type,
                 const void* /*csrcs*/,
                 webrtc::ArrayView<const uint8_t> /*additional_data*/,
                 webrtc::ArrayView<const uint8_t> encrypted_frame,
                 webrtc::ArrayView<uint8_t> frame) override {
    const uint8_t* data = encrypted_frame.data();
    const size_t len = encrypted_frame.size();
    const int index = FrameKeyIndex(data, len);
    if (index < 0 || frame.size() < len - kFrameOverhead + kTagLen) return Fail();

    const bool video = media_type == webrtc::MEDIA_TYPE_VIDEO;
    size_t written = 0;
    keys_->With(index, [&](const AesGcm& cipher) {
      written = OpenFrame(cipher, video, data, len, frame.data());
    });
    if (written == 0) return Fail();
    keys_->opened.fetch_add(1, std::memory_order_relaxed);
    return Result(Status::kOk, written);
  }

  size_t GetMaxPlaintextByteSize(webrtc::MediaType /*media_type*/, size_t encrypted_frame_size) override {
    return encrypted_frame_size;
  }

 private:
  Result Fail() {
    keys_->dropped.fetch_add(1, std::memory_order_relaxed);
    return Result(Status::kFailedToDecrypt, 0);
  }

  KeySetPtr keys_;
};

// The handle Kotlin holds: a shared_ptr kept alive on the heap.
struct KeysHandle {
  KeySetPtr keys;
};

}  // namespace
}  // namespace evilion

using evilion::Decryptor;
using evilion::Encryptor;
using evilion::KeySet;
using evilion::KeysHandle;

extern "C" {

JNIEXPORT jlong JNICALL Java_xyz_evilion_chat_voice_FrameCryptoNative_nativeCreateKeys(JNIEnv*, jobject) {
  auto* handle = new KeysHandle{std::make_shared<KeySet>()};
  return reinterpret_cast<jlong>(handle);
}

JNIEXPORT void JNICALL Java_xyz_evilion_chat_voice_FrameCryptoNative_nativeSetKeys(
    JNIEnv* env, jobject, jlong handle_ptr, jintArray j_indices, jobjectArray j_keys, jint send_index) {
  auto* handle = reinterpret_cast<KeysHandle*>(handle_ptr);
  if (handle == nullptr) return;

  std::map<int, std::array<uint8_t, 32>> keys;
  const jsize count = env->GetArrayLength(j_indices);
  jint* indices = env->GetIntArrayElements(j_indices, nullptr);
  for (jsize i = 0; i < count; i++) {
    auto raw = reinterpret_cast<jbyteArray>(env->GetObjectArrayElement(j_keys, i));
    if (raw == nullptr) continue;
    if (env->GetArrayLength(raw) == 32) {
      std::array<uint8_t, 32> key{};
      env->GetByteArrayRegion(raw, 0, 32, reinterpret_cast<jbyte*>(key.data()));
      keys[indices[i]] = key;
    }
    env->DeleteLocalRef(raw);
  }
  env->ReleaseIntArrayElements(j_indices, indices, JNI_ABORT);
  handle->keys->Set(keys, send_index);
}

JNIEXPORT void JNICALL Java_xyz_evilion_chat_voice_FrameCryptoNative_nativeReleaseKeys(JNIEnv*, jobject, jlong handle_ptr) {
  delete reinterpret_cast<KeysHandle*>(handle_ptr);
}

JNIEXPORT jlong JNICALL Java_xyz_evilion_chat_voice_FrameCryptoNative_nativeCreateEncryptor(JNIEnv*, jobject, jlong handle_ptr) {
  auto* handle = reinterpret_cast<KeysHandle*>(handle_ptr);
  if (handle == nullptr) return 0;
  return reinterpret_cast<jlong>(static_cast<webrtc::FrameEncryptorInterface*>(new Encryptor(handle->keys)));
}

JNIEXPORT jlong JNICALL Java_xyz_evilion_chat_voice_FrameCryptoNative_nativeCreateDecryptor(JNIEnv*, jobject, jlong handle_ptr) {
  auto* handle = reinterpret_cast<KeysHandle*>(handle_ptr);
  if (handle == nullptr) return 0;
  return reinterpret_cast<jlong>(static_cast<webrtc::FrameDecryptorInterface*>(new Decryptor(handle->keys)));
}

JNIEXPORT void JNICALL Java_xyz_evilion_chat_voice_FrameCryptoNative_nativeReleaseEncryptor(JNIEnv*, jobject, jlong ptr) {
  if (ptr != 0) reinterpret_cast<webrtc::FrameEncryptorInterface*>(ptr)->Release();
}

JNIEXPORT void JNICALL Java_xyz_evilion_chat_voice_FrameCryptoNative_nativeReleaseDecryptor(JNIEnv*, jobject, jlong ptr) {
  if (ptr != 0) reinterpret_cast<webrtc::FrameDecryptorInterface*>(ptr)->Release();
}

JNIEXPORT jlongArray JNICALL Java_xyz_evilion_chat_voice_FrameCryptoNative_nativeStats(JNIEnv* env, jobject, jlong handle_ptr) {
  jlong out[3] = {0, 0, 0};
  auto* handle = reinterpret_cast<KeysHandle*>(handle_ptr);
  if (handle != nullptr) {
    out[0] = handle->keys->sealed.load(std::memory_order_relaxed);
    out[1] = handle->keys->opened.load(std::memory_order_relaxed);
    out[2] = handle->keys->dropped.load(std::memory_order_relaxed);
  }
  jlongArray arr = env->NewLongArray(3);
  env->SetLongArrayRegion(arr, 0, 3, out);
  return arr;
}

}  // extern "C"
