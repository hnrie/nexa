// AES-256-GCM, self-contained.
//
// The NDK exposes no crypto library an app may link against, and call frames
// have to be sealed exactly the way the web client seals them, so this is the
// whole of it: table-driven AES and a 4-bit-window GHASH, which together are
// far faster than the few hundred kilobytes a second a call actually needs.
#ifndef NEXA_AES_GCM_H_
#define NEXA_AES_GCM_H_

#include <stddef.h>
#include <stdint.h>

namespace nexa {

// The GCM authentication tag length, in bytes. Fixed at 16, as WebCrypto uses.
constexpr size_t kTagLen = 16;

class AesGcm {
 public:
  AesGcm() = default;

  // key must be 32 bytes (AES-256). Safe to call again to re-key.
  void Init(const uint8_t* key);

  // Writes plaintext_len bytes of ciphertext to out, then kTagLen tag bytes.
  void Seal(const uint8_t* iv, size_t iv_len,
            const uint8_t* aad, size_t aad_len,
            const uint8_t* plaintext, size_t plaintext_len,
            uint8_t* out) const;

  // ciphertext_len counts the trailing tag. Writes ciphertext_len - kTagLen
  // bytes to out; false (and nothing usable in out) if the tag is wrong.
  bool Open(const uint8_t* iv, size_t iv_len,
            const uint8_t* aad, size_t aad_len,
            const uint8_t* ciphertext, size_t ciphertext_len,
            uint8_t* out) const;

 private:
  void EncryptBlock(const uint8_t in[16], uint8_t out[16]) const;
  void Ctr(const uint8_t counter[16], const uint8_t* in, size_t len, uint8_t* out) const;
  void GhashUpdate(uint8_t y[16], const uint8_t* data, size_t len) const;
  void Tag(const uint8_t* iv, size_t iv_len, const uint8_t* aad, size_t aad_len,
           const uint8_t* ciphertext, size_t ciphertext_len, uint8_t out[16]) const;

  uint32_t rk_[60] = {};      // 14 rounds + 1 of round keys
  uint64_t hl_[16] = {};      // GHASH tables for H, 4 bits at a time
  uint64_t hh_[16] = {};
};

}  // namespace nexa

#endif  // NEXA_AES_GCM_H_
