// AES-256-GCM through the maintained RustCrypto backend in android/frame-crypto.
// The wire format is unchanged. Contexts use hardware acceleration where
// available and a constant-time portable implementation otherwise.
#ifndef NEXA_AES_GCM_H_
#define NEXA_AES_GCM_H_
#include <stddef.h>
#include <stdint.h>
#include <memory>

namespace nexa {
constexpr size_t kTagLen = 16;
class AesGcm {
 public:
  AesGcm() = default;
  // Exactly 32 key bytes. Context ownership is shared when a key set is copied.
  void Init(const uint8_t* key);
  // Nonces are exactly 12 bytes. Output holds plaintext_len + kTagLen bytes.
  bool Seal(const uint8_t* iv, size_t iv_len, const uint8_t* aad, size_t aad_len,
            const uint8_t* plaintext, size_t plaintext_len, uint8_t* out) const;
  bool Open(const uint8_t* iv, size_t iv_len, const uint8_t* aad, size_t aad_len,
            const uint8_t* ciphertext, size_t ciphertext_len, uint8_t* out) const;
 private:
  std::shared_ptr<void> context_;
};
} // namespace nexa
#endif
