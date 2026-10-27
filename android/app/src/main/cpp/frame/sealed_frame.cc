#include "sealed_frame.h"

#include <string.h>

#include <algorithm>
#include <vector>

#include "h264.h"

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
  if (!cipher.Seal(iv, kIvLen, data, clear, data + clear, len - clear, out + clear)) return 0;
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

namespace {

// An H.264 frame's NAL units and how many bytes of each stay readable.
struct H264Layout {
  std::vector<Nalu> nalus;
  std::vector<size_t> clear;
};

bool LayOut(const uint8_t* data, size_t len, H264Layout* out) {
  out->nalus = NaluIndices(data, len);
  if (out->nalus.empty() || out->nalus[0].start != 0) return false;
  out->clear.clear();
  for (const Nalu& n : out->nalus) {
    const long c = NaluClearBytes(data, n);
    if (c < 0) return false;
    out->clear.push_back(size_t(c));
  }
  return true;
}

// The readable parts joined (the additional data), and the rest joined (what is sealed).
void JoinParts(const uint8_t* data, const H264Layout& l, std::vector<uint8_t>* aad, std::vector<uint8_t>* secret) {
  for (size_t i = 0; i < l.nalus.size(); i++) {
    const Nalu& n = l.nalus[i];
    const size_t mid = n.payload + l.clear[i];
    aad->insert(aad->end(), data + n.payload, data + mid);
    secret->insert(secret->end(), data + mid, data + n.end);
  }
}

}  // namespace

size_t MaxSealedH264(size_t len) {
  return len + len / 3 + 1 + kH264Trailer;
}

size_t SealH264Frame(const AesGcm& cipher, int key_index, const uint8_t iv[kIvLen], const uint8_t* data, size_t len,
                     uint8_t* out) {
  H264Layout l;
  if (!LayOut(data, len, &l)) return 0;
  std::vector<uint8_t> aad, secret;
  JoinParts(data, l, &aad, &secret);
  std::vector<uint8_t> sealed(secret.size() + kTagLen);
  if (!cipher.Seal(iv, kIvLen, aad.data(), aad.size(), secret.data(), secret.size(), sealed.data())) return 0;
  size_t o = 0;
  size_t c = 0;
  for (size_t i = 0; i < l.nalus.size(); i++) {
    const Nalu& n = l.nalus[i];
    static const uint8_t kStartCode[4] = {0, 0, 0, 1};
    memcpy(out + o, kStartCode, 4);
    o += 4;
    memcpy(out + o, data + n.payload, l.clear[i]);
    o += l.clear[i];
    const size_t rest = n.end - n.payload - l.clear[i];
    memcpy(out + o, sealed.data() + c, rest);
    o += rest;
    c += rest;
  }
  memcpy(out + o, sealed.data() + c, kTagLen);
  o += kTagLen;
  memcpy(out + o, iv, kIvLen);
  o += kIvLen;
  out[o++] = uint8_t(key_index & 0xff);
  // the packetiser has to find the units it was given, and nothing more
  const std::vector<Nalu> found = NaluIndices(out, o);
  if (found.size() != l.nalus.size()) return 0;
  for (size_t i = 0; i < found.size(); i++) {
    const size_t want = l.nalus[i].end - l.nalus[i].payload + (i + 1 == found.size() ? kH264Trailer : 0);
    if (found[i].end - found[i].payload != want) return 0;
  }
  return o;
}

long OpenH264Frame(const AesGcm& cipher, const uint8_t* data, size_t len, uint8_t* out) {
  if (len < kH264Trailer + 5) return -1;
  const size_t body = len - kH264Trailer;
  H264Layout l;
  if (!LayOut(data, body, &l)) return -1;
  std::vector<uint8_t> aad, secret;
  JoinParts(data, l, &aad, &secret);
  secret.insert(secret.end(), data + body, data + body + kTagLen);
  std::vector<uint8_t> plain(secret.size() - kTagLen + 1);
  if (!cipher.Open(data + body + kTagLen, kIvLen, aad.data(), aad.size(), secret.data(), secret.size(), plain.data())) {
    return -1;
  }
  memmove(out, data, body);
  size_t c = 0;
  for (size_t i = 0; i < l.nalus.size(); i++) {
    const size_t mid = l.nalus[i].payload + l.clear[i];
    const size_t size = l.nalus[i].end - mid;
    memcpy(out + mid, plain.data() + c, size);
    c += size;
  }
  return long(body);
}

}  // namespace nexa
