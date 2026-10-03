#include "aes_gcm.h"

#include <string.h>

namespace nexa {
namespace {

const uint8_t kSbox[256] = {
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16};

const uint32_t kRcon[11] = {0x00000000, 0x01000000, 0x02000000, 0x04000000, 0x08000000, 0x10000000,
                            0x20000000, 0x40000000, 0x80000000, 0x1b000000, 0x36000000};

// The four T-tables, built once from the S-box rather than written out.
struct Tables {
  uint32_t te0[256], te1[256], te2[256], te3[256];
  Tables() {
    for (int i = 0; i < 256; i++) {
      const uint32_t s = kSbox[i];
      const uint32_t s2 = (s << 1) ^ ((s & 0x80) ? 0x11b : 0);
      const uint32_t s3 = s2 ^ s;
      te0[i] = (s2 << 24) | (s << 16) | (s << 8) | s3;
      te1[i] = (te0[i] >> 8) | (te0[i] << 24);
      te2[i] = (te0[i] >> 16) | (te0[i] << 16);
      te3[i] = (te0[i] >> 24) | (te0[i] << 8);
    }
  }
};

const Tables& T() {
  static const Tables t;  // thread-safe initialisation since C++11
  return t;
}

inline uint32_t Load32(const uint8_t* p) {
  return (uint32_t(p[0]) << 24) | (uint32_t(p[1]) << 16) | (uint32_t(p[2]) << 8) | uint32_t(p[3]);
}

inline void Store32(uint32_t v, uint8_t* p) {
  p[0] = uint8_t(v >> 24);
  p[1] = uint8_t(v >> 16);
  p[2] = uint8_t(v >> 8);
  p[3] = uint8_t(v);
}

inline uint64_t Load64(const uint8_t* p) {
  uint64_t v = 0;
  for (int i = 0; i < 8; i++) v = (v << 8) | p[i];
  return v;
}

inline void Store64(uint64_t v, uint8_t* p) {
  for (int i = 7; i >= 0; i--) {
    p[i] = uint8_t(v);
    v >>= 8;
  }
}

inline uint32_t SubWord(uint32_t w) {
  return (uint32_t(kSbox[(w >> 24) & 0xff]) << 24) | (uint32_t(kSbox[(w >> 16) & 0xff]) << 16) |
         (uint32_t(kSbox[(w >> 8) & 0xff]) << 8) | uint32_t(kSbox[w & 0xff]);
}

// The low nibble's reduction, for GHASH's 4-bit window.
const uint64_t kLast4[16] = {0x0000, 0x1c20, 0x3840, 0x2460, 0x7080, 0x6ca0, 0x48c0, 0x54e0,
                             0xe100, 0xfd20, 0xd940, 0xc560, 0x9180, 0x8da0, 0xa9c0, 0xb5e0};

}  // namespace

void AesGcm::Init(const uint8_t* key) {
  // AES-256: 8 key words, 14 rounds.
  for (int i = 0; i < 8; i++) rk_[i] = Load32(key + 4 * i);
  for (int i = 8; i < 60; i++) {
    uint32_t t = rk_[i - 1];
    if (i % 8 == 0) {
      t = SubWord((t << 8) | (t >> 24)) ^ kRcon[i / 8];
    } else if (i % 8 == 4) {
      t = SubWord(t);
    }
    rk_[i] = rk_[i - 8] ^ t;
  }

  // H = E_K(0), then the 4-bit multiplication tables for it.
  uint8_t zero[16] = {};
  uint8_t h[16];
  EncryptBlock(zero, h);

  uint64_t vh = Load64(h), vl = Load64(h + 8);
  hl_[8] = vl;
  hh_[8] = vh;
  hl_[0] = 0;
  hh_[0] = 0;
  for (int i = 4; i > 0; i >>= 1) {
    const uint32_t t = uint32_t(vl & 1) * 0xe1000000u;
    vl = (vh << 63) | (vl >> 1);
    vh = (vh >> 1) ^ (uint64_t(t) << 32);
    hl_[i] = vl;
    hh_[i] = vh;
  }
  for (int i = 2; i <= 8; i *= 2) {
    vh = hh_[i];
    vl = hl_[i];
    for (int j = 1; j < i; j++) {
      hh_[i + j] = vh ^ hh_[j];
      hl_[i + j] = vl ^ hl_[j];
    }
  }
}

void AesGcm::EncryptBlock(const uint8_t in[16], uint8_t out[16]) const {
  const Tables& t = T();
  uint32_t s0 = Load32(in) ^ rk_[0];
  uint32_t s1 = Load32(in + 4) ^ rk_[1];
  uint32_t s2 = Load32(in + 8) ^ rk_[2];
  uint32_t s3 = Load32(in + 12) ^ rk_[3];
  uint32_t t0, t1, t2, t3;

  for (int round = 1; round < 14; round++) {
    const uint32_t* rk = rk_ + 4 * round;
    t0 = t.te0[s0 >> 24] ^ t.te1[(s1 >> 16) & 0xff] ^ t.te2[(s2 >> 8) & 0xff] ^ t.te3[s3 & 0xff] ^ rk[0];
    t1 = t.te0[s1 >> 24] ^ t.te1[(s2 >> 16) & 0xff] ^ t.te2[(s3 >> 8) & 0xff] ^ t.te3[s0 & 0xff] ^ rk[1];
    t2 = t.te0[s2 >> 24] ^ t.te1[(s3 >> 16) & 0xff] ^ t.te2[(s0 >> 8) & 0xff] ^ t.te3[s1 & 0xff] ^ rk[2];
    t3 = t.te0[s3 >> 24] ^ t.te1[(s0 >> 16) & 0xff] ^ t.te2[(s1 >> 8) & 0xff] ^ t.te3[s2 & 0xff] ^ rk[3];
    s0 = t0;
    s1 = t1;
    s2 = t2;
    s3 = t3;
  }

  const uint32_t* rk = rk_ + 56;
  t0 = (uint32_t(kSbox[s0 >> 24]) << 24) | (uint32_t(kSbox[(s1 >> 16) & 0xff]) << 16) |
       (uint32_t(kSbox[(s2 >> 8) & 0xff]) << 8) | uint32_t(kSbox[s3 & 0xff]);
  t1 = (uint32_t(kSbox[s1 >> 24]) << 24) | (uint32_t(kSbox[(s2 >> 16) & 0xff]) << 16) |
       (uint32_t(kSbox[(s3 >> 8) & 0xff]) << 8) | uint32_t(kSbox[s0 & 0xff]);
  t2 = (uint32_t(kSbox[s2 >> 24]) << 24) | (uint32_t(kSbox[(s3 >> 16) & 0xff]) << 16) |
       (uint32_t(kSbox[(s0 >> 8) & 0xff]) << 8) | uint32_t(kSbox[s1 & 0xff]);
  t3 = (uint32_t(kSbox[s3 >> 24]) << 24) | (uint32_t(kSbox[(s0 >> 16) & 0xff]) << 16) |
       (uint32_t(kSbox[(s1 >> 8) & 0xff]) << 8) | uint32_t(kSbox[s2 & 0xff]);
  Store32(t0 ^ rk[0], out);
  Store32(t1 ^ rk[1], out + 4);
  Store32(t2 ^ rk[2], out + 8);
  Store32(t3 ^ rk[3], out + 12);
}

// y = (y ^ block) * H, one 16-byte block at a time; a short tail is zero-padded.
void AesGcm::GhashUpdate(uint8_t y[16], const uint8_t* data, size_t len) const {
  size_t off = 0;
  while (off < len) {
    const size_t n = (len - off < 16) ? (len - off) : 16;
    for (size_t i = 0; i < n; i++) y[i] ^= data[off + i];
    off += n;

    uint8_t lo = y[15] & 0xf;
    uint64_t zh = hh_[lo], zl = hl_[lo];
    for (int i = 15; i >= 0; i--) {
      lo = y[i] & 0xf;
      const uint8_t hi = (y[i] >> 4) & 0xf;
      if (i != 15) {
        const uint8_t rem = uint8_t(zl & 0xf);
        zl = (zh << 60) | (zl >> 4);
        zh = (zh >> 4) ^ (kLast4[rem] << 48);
        zh ^= hh_[lo];
        zl ^= hl_[lo];
      }
      const uint8_t rem = uint8_t(zl & 0xf);
      zl = (zh << 60) | (zl >> 4);
      zh = (zh >> 4) ^ (kLast4[rem] << 48);
      zh ^= hh_[hi];
      zl ^= hl_[hi];
    }
    Store64(zh, y);
    Store64(zl, y + 8);
  }
}

void AesGcm::Ctr(const uint8_t counter[16], const uint8_t* in, size_t len, uint8_t* out) const {
  uint8_t ctr[16];
  memcpy(ctr, counter, 16);
  uint8_t stream[16];
  size_t off = 0;
  while (off < len) {
    EncryptBlock(ctr, stream);
    const size_t n = (len - off < 16) ? (len - off) : 16;
    for (size_t i = 0; i < n; i++) out[off + i] = in[off + i] ^ stream[i];
    off += n;
    for (int i = 15; i >= 12; i--) {  // the low 32 bits are the block counter
      if (++ctr[i] != 0) break;
    }
  }
}

void AesGcm::Tag(const uint8_t* iv, size_t iv_len, const uint8_t* aad, size_t aad_len,
                 const uint8_t* ciphertext, size_t ciphertext_len, uint8_t out[16]) const {
  uint8_t j0[16] = {};
  if (iv_len == 12) {
    memcpy(j0, iv, 12);
    j0[15] = 1;
  } else {
    GhashUpdate(j0, iv, iv_len);
    uint8_t lens[16] = {};
    Store64(uint64_t(iv_len) * 8, lens + 8);
    GhashUpdate(j0, lens, 16);
  }

  uint8_t y[16] = {};
  if (aad_len) GhashUpdate(y, aad, aad_len);
  if (ciphertext_len) GhashUpdate(y, ciphertext, ciphertext_len);
  uint8_t lens[16];
  Store64(uint64_t(aad_len) * 8, lens);
  Store64(uint64_t(ciphertext_len) * 8, lens + 8);
  GhashUpdate(y, lens, 16);

  uint8_t s[16];
  EncryptBlock(j0, s);
  for (int i = 0; i < 16; i++) out[i] = y[i] ^ s[i];
}

// The counter blocks for the data start at J0 + 1.
static void CounterStart(const uint8_t* iv, size_t iv_len, uint8_t out[16],
                         const AesGcm* /*self*/, const uint8_t* j0_general) {
  if (iv_len == 12) {
    memcpy(out, iv, 12);
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 2;
    return;
  }
  memcpy(out, j0_general, 16);
  for (int i = 15; i >= 12; i--) {
    if (++out[i] != 0) break;
  }
}

void AesGcm::Seal(const uint8_t* iv, size_t iv_len, const uint8_t* aad, size_t aad_len,
                  const uint8_t* plaintext, size_t plaintext_len, uint8_t* out) const {
  uint8_t j0[16] = {};
  if (iv_len != 12) {
    GhashUpdate(j0, iv, iv_len);
    uint8_t lens[16] = {};
    Store64(uint64_t(iv_len) * 8, lens + 8);
    GhashUpdate(j0, lens, 16);
  }
  uint8_t ctr[16];
  CounterStart(iv, iv_len, ctr, this, j0);
  Ctr(ctr, plaintext, plaintext_len, out);
  Tag(iv, iv_len, aad, aad_len, out, plaintext_len, out + plaintext_len);
}

bool AesGcm::Open(const uint8_t* iv, size_t iv_len, const uint8_t* aad, size_t aad_len,
                  const uint8_t* ciphertext, size_t ciphertext_len, uint8_t* out) const {
  if (ciphertext_len < kTagLen) return false;
  const size_t body = ciphertext_len - kTagLen;

  uint8_t want[16];
  Tag(iv, iv_len, aad, aad_len, ciphertext, body, want);
  uint8_t diff = 0;
  for (size_t i = 0; i < kTagLen; i++) diff |= want[i] ^ ciphertext[body + i];
  if (diff) return false;

  uint8_t j0[16] = {};
  if (iv_len != 12) {
    GhashUpdate(j0, iv, iv_len);
    uint8_t lens[16] = {};
    Store64(uint64_t(iv_len) * 8, lens + 8);
    GhashUpdate(j0, lens, 16);
  }
  uint8_t ctr[16];
  CounterStart(iv, iv_len, ctr, this, j0);
  Ctr(ctr, ciphertext, body, out);
  return true;
}

}  // namespace nexa
