// The on-the-wire shape of a sealed call frame, kept apart from the WebRTC
// and JNI plumbing so it can be tested on its own against the web client's.
//
//   clear header | AES-256-GCM ciphertext and tag | iv (12) | key index (1)
//
// The clear header is what packetisers and the SFU read, and is authenticated
// as additional data, so it cannot be altered either.
#ifndef EVILION_SEALED_FRAME_H_
#define EVILION_SEALED_FRAME_H_

#include <stddef.h>
#include <stdint.h>

#include "aes_gcm.h"

namespace evilion {

constexpr size_t kIvLen = 12;
constexpr size_t kSaltLen = 8;
constexpr size_t kTrailer = kIvLen + 1;
// What sealing adds to a frame: the tag, the iv and the key index.
constexpr size_t kFrameOverhead = kTrailer + kTagLen;

// How many leading bytes stay readable: Opus's TOC byte, VP8's payload header
// (10 on key frames, 3 otherwise).
size_t ClearBytes(bool video, bool key_frame);

// A VP8 key frame: the frame tag's low bit is 0, and the start code follows it.
bool IsVp8KeyFrame(const uint8_t* data, size_t len);

// Seals `len` bytes into `out`, which needs room for len + kFrameOverhead.
// Returns how many bytes were written.
size_t SealFrame(const AesGcm& cipher, int key_index, const uint8_t iv[kIvLen], bool video,
                 const uint8_t* data, size_t len, uint8_t* out);

// The key index a sealed frame names, or -1 if it is too short to be one.
int FrameKeyIndex(const uint8_t* data, size_t len);

// Opens a sealed frame into `out`, which needs room for `len` bytes. Returns
// the plaintext length, or 0 if the frame was altered or is malformed.
size_t OpenFrame(const AesGcm& cipher, bool video, const uint8_t* data, size_t len, uint8_t* out);

}  // namespace evilion

#endif  // EVILION_SEALED_FRAME_H_
