#include "aes_gcm.h"
extern "C" {
void* nexa_aead_new(const uint8_t* key);
void nexa_aead_free(void* context);
bool nexa_aead_seal(const void*, const uint8_t*, size_t, const uint8_t*, size_t, const uint8_t*, size_t, uint8_t*);
bool nexa_aead_open(const void*, const uint8_t*, size_t, const uint8_t*, size_t, const uint8_t*, size_t, uint8_t*);
}
namespace nexa {
void AesGcm::Init(const uint8_t* key) { context_.reset(nexa_aead_new(key), nexa_aead_free); }
bool AesGcm::Seal(const uint8_t* iv, size_t iv_len, const uint8_t* aad, size_t aad_len,
                  const uint8_t* plaintext, size_t plaintext_len, uint8_t* out) const {
  return context_ && nexa_aead_seal(context_.get(), iv, iv_len, aad, aad_len, plaintext, plaintext_len, out);
}
bool AesGcm::Open(const uint8_t* iv, size_t iv_len, const uint8_t* aad, size_t aad_len,
                  const uint8_t* ciphertext, size_t ciphertext_len, uint8_t* out) const {
  return context_ && nexa_aead_open(context_.get(), iv, iv_len, aad, aad_len, ciphertext, ciphertext_len, out);
}
} // namespace nexa
