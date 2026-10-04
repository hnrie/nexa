// The on-the-wire shape of a sealed call frame (web/src/voice/frameCrypto.ts),
// kept apart from the WebRTC and JNI plumbing so it can be checked on its own
// against the web client's vectors.
//
//   clear header | AES-256-GCM ciphertext and tag | iv (12) | key index (1)
//
// The clear header is what packetisers and the SFU read (Opus's TOC byte,
// VP8's payload header) and is authenticated as additional data, so it cannot
// be altered either.
//
// An H.264 frame is read at more places than its start (h264.h), so it is
// sealed where it lies: every NAL unit after a 4-byte start code, its
// readable part as it was and the rest sealed, all under one AES-GCM
// operation whose additional data is the readable parts joined, then the tag,
// the iv and the key index after the last unit.
#ifndef NEXA_SEALED_FRAME_H_
#define NEXA_SEALED_FRAME_H_

#include <stddef.h>
#include <stdint.h>

#include "aes_gcm.h"

namespace nexa {

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

// The picture size a VP8 frame declares (frameSize.ts vp8Header). Returns
// false for a frame that is not a key frame; for a key frame, true with the
// size, or with 0 x 0 when its header is broken.
bool Vp8KeyFrameSize(const uint8_t* data, size_t len, int* width, int* height);

// Within the cap every client holds pictures to (videoCap.ts): at most 8192 a
// side and 7680 x 4320 pixels.
bool FitsVideoCap(int width, int height);

// Seals `len` bytes into `out`, which needs room for len + kFrameOverhead.
// Returns how many bytes were written.
size_t SealFrame(const AesGcm& cipher, int key_index, const uint8_t iv[kIvLen], bool video,
                 const uint8_t* data, size_t len, uint8_t* out);

// The key index a sealed frame names, or -1 if it is too short to be one.
int FrameKeyIndex(const uint8_t* data, size_t len);

// Opens a sealed frame into `out`, which needs room for `len` bytes. Returns
// the plaintext length; -1 if the frame was altered or is malformed.
long OpenFrame(const AesGcm& cipher, bool video, const uint8_t* data, size_t len, uint8_t* out);

// What sealing adds after an H.264 frame's last NAL unit: the tag, the iv and the key index.
constexpr size_t kH264Trailer = kTagLen + kIvLen + 1;

// The most an H.264 frame of `len` bytes can take once sealed: every start
// code made 4 bytes long (one byte more at most for every 3 of the frame),
// then the trailer.
size_t MaxSealedH264(size_t len);

// Seals an H.264 frame into `out`, which needs MaxSealedH264(len) bytes.
// Returns how many bytes were written; 0 when it is not a frame this can
// seal, or when the sealed bytes happen to hold a start code, which would
// split a NAL unit in the packetiser: then seal again with the next iv.
size_t SealH264Frame(const AesGcm& cipher, int key_index, const uint8_t iv[kIvLen], const uint8_t* data, size_t len,
                     uint8_t* out);

// Opens a sealed H.264 frame into `out`, which needs room for `len` bytes.
// Returns the plaintext length; -1 if the frame was altered or is malformed.
long OpenH264Frame(const AesGcm& cipher, const uint8_t* data, size_t len, uint8_t* out);

}  // namespace nexa

#endif  // NEXA_SEALED_FRAME_H_
