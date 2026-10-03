#include "sealed_frame.h"

#include <string.h>

#include <algorithm>

namespace nexa {

size_t ClearBytes(bool video, bool key_frame) {
  if (!video) return 1;
  return key_frame ? 10 : 3;
}

bool IsVp8KeyFrame(const uint8_t* data, size_t len) {
  return len >= 10 && (data[0] & 1) == 0 && data[3] == 0x9d && data[4] == 0x01 && data[5] == 0x2a;
}

bool Vp8KeyFrameSize(const uint8_t* data, size_t len, int* width, int* height) {
  *width = 0;
  *height = 0;
  if (len == 0 || (data[0] & 1) == 1) return false;
  if (len < 10 || data[3] != 0x9d || data[4] != 0x01 || data[5] != 0x2a) return true;
  *width = (data[6] | (data[7] << 8)) & 0x3fff;
  *height = (data[8] | (data[9] << 8)) & 0x3fff;
  return true;
}

bool FitsVideoCap(int width, int height) {
  return width > 0 && height > 0 && width <= 8192 && height <= 8192 &&
         static_cast<long long>(width) * height <= 7680LL * 4320LL;
}

size_t SealFrame(const AesGcm& cipher, int key_index, const uint8_t iv[kIvLen], bool video,
                 const uint8_t* data, size_t len, uint8_t* out) {
  const size_t clear = std::min(ClearBytes(video, video && IsVp8KeyFrame(data, len)), len);
  cipher.Seal(iv, kIvLen, data, clear, data + clear, len - clear, out + clear);
  memmove(out, data, clear);
  const size_t body = len + kTagLen;
  memcpy(out + body, iv, kIvLen);
  out[body + kIvLen] = uint8_t(key_index & 0xff);
  return body + kTrailer;
}

int FrameKeyIndex(const uint8_t* data, size_t len) {
  if (len < kFrameOverhead) return -1;
  return data[len - 1];
}

long OpenFrame(const AesGcm& cipher, bool video, const uint8_t* data, size_t len, uint8_t* out) {
  if (len < kFrameOverhead) return -1;
  const size_t body = len - kTrailer;
  const uint8_t* iv = data + body;
  // the header is still in the clear, so a key frame reads as one here too
  const size_t clear = std::min(ClearBytes(video, video && IsVp8KeyFrame(data, body)), body - kTagLen);
  if (!cipher.Open(iv, kIvLen, data, clear, data + clear, body - clear, out + clear)) return -1;
  memmove(out, data, clear);
  return static_cast<long>(body - kTagLen);
}

}  // namespace nexa
