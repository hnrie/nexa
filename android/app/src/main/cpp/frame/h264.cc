#include "h264.h"

namespace nexa {
namespace {

// Reads the bits of a NAL unit's RBSP: the bytes after its header, with each
// emulation prevention byte (the 03 in 00 00 03) skipped. Nothing past the
// byte holding the last bit read is ever looked at, so on a sealed frame the
// readable part decides alone how much of it a reading takes (Pos).
class Bits {
 public:
  Bits(const uint8_t* data, size_t from, size_t end) : data_(data), byte_(from), end_(end), last_(from - 1) {}

  // Just past the byte holding the last bit read.
  size_t Pos() const { return last_ + 1; }

  // One bit, or -1 past the end.
  int Read() {
    if (bit_ == 0) {
      if (zeros_ >= 2 && byte_ < end_ && data_[byte_] == 3) {
        byte_++;
        zeros_ = 0;
      }
      if (byte_ >= end_) return -1;
    }
    const uint8_t b = data_[byte_];
    const int v = (b >> (7 - bit_)) & 1;
    last_ = byte_;
    if (++bit_ == 8) {
      bit_ = 0;
      zeros_ = b == 0 ? zeros_ + 1 : 0;
      byte_++;
    }
    return v;
  }

  // `n` bits (at most 32), or -1 past the end.
  long long Take(int n) {
    long long v = 0;
    for (int i = 0; i < n; i++) {
      const int b = Read();
      if (b < 0) return -1;
      v = v * 2 + b;
    }
    return v;
  }

  // An unsigned Exp-Golomb number, or -1 past the end or when it is longer than 32 bits.
  long long Ue() {
    int zeros = 0;
    for (;;) {
      const int b = Read();
      if (b < 0) return -1;
      if (b == 1) break;
      if (++zeros > 31) return -1;
    }
    const long long rest = Take(zeros);
    return rest < 0 ? -1 : (1LL << zeros) - 1 + rest;
  }

  // A signed Exp-Golomb number; false past the end.
  bool Se() { return Ue() >= 0; }

 private:
  const uint8_t* data_;
  size_t byte_;
  size_t end_;
  size_t last_;
  int bit_ = 0;
  int zeros_ = 0;
};

bool HighProfile(long long profile) {
  switch (profile) {
    case 100: case 110: case 122: case 244: case 44: case 83: case 86:
    case 118: case 128: case 138: case 139: case 134: case 135:
      return true;
    default:
      return false;
  }
}

bool SkipScalingList(Bits& bits, int size) {
  int last = 8;
  int next = 8;
  for (int j = 0; j < size; j++) {
    if (next != 0) {
      const long long k = bits.Ue();
      if (k < 0) return false;
      const long long delta = k % 2 == 1 ? (k + 1) / 2 : -(k / 2);
      next = int(((last + delta) % 256 + 256) % 256);
    }
    last = next == 0 ? last : next;
  }
  return true;
}

}  // namespace

std::vector<Nalu> NaluIndices(const uint8_t* data, size_t len) {
  std::vector<Nalu> out;
  if (len < 3) return out;
  const size_t last = len - 3;
  for (size_t i = 0; i < last;) {
    const uint8_t third = data[i + 2];
    if (third > 1) {
      i += 3;
    } else if (third == 1) {
      if (data[i + 1] == 0 && data[i] == 0) {
        const size_t start = i > 0 && data[i - 1] == 0 ? i - 1 : i;
        if (!out.empty()) out.back().end = start;
        out.push_back(Nalu{start, i + 3, len});
      }
      i += 3;
    } else {
      i++;
    }
  }
  return out;
}

bool IsAnnexB(const uint8_t* data, size_t len) {
  return len >= 4 && data[0] == 0 && data[1] == 0 && (data[2] == 1 || (data[2] == 0 && data[3] == 1));
}

long NaluClearBytes(const uint8_t* data, const Nalu& nalu) {
  if (nalu.end <= nalu.payload) return 0;
  const size_t size = nalu.end - nalu.payload;
  const int type = data[nalu.payload] & 0x1f;
  if (type == kNaluSlice || type == kNaluIdr) {
    if (size < 2) return -1;
    Bits bits(data, nalu.payload + 1, nalu.end);
    // first_mb_in_slice, slice_type, pic_parameter_set_id
    if (bits.Ue() < 0 || bits.Ue() < 0 || bits.Ue() < 0) return -1;
    return long(bits.Pos() - nalu.payload);
  }
  // data partitions, auxiliary and extension slices carry pictures too; no encoder in a call makes them
  if ((type >= 2 && type <= 4) || (type >= 19 && type <= 21)) return 1;
  return long(size);
}

bool SpsSize(const uint8_t* data, const Nalu& nalu, int* width, int* height) {
  *width = 0;
  *height = 0;
  Bits bits(data, nalu.payload + 1, nalu.end);
  const long long profile = bits.Take(8);
  if (profile < 0 || bits.Take(16) < 0 || bits.Ue() < 0) return false;
  if (HighProfile(profile)) {
    const long long chroma = bits.Ue();
    if (chroma < 0 || chroma > 3) return false;
    if (chroma == 3 && bits.Read() < 0) return false;
    if (bits.Ue() < 0 || bits.Ue() < 0 || bits.Read() < 0) return false;
    const int lists = bits.Read();
    if (lists < 0) return false;
    if (lists == 1) {
      for (int i = 0; i < (chroma == 3 ? 12 : 8); i++) {
        const int present = bits.Read();
        if (present < 0) return false;
        if (present == 1 && !SkipScalingList(bits, i < 6 ? 16 : 64)) return false;
      }
    }
  }
  if (bits.Ue() < 0) return false;
  const long long poc_type = bits.Ue();
  if (poc_type < 0 || poc_type > 2) return false;
  if (poc_type == 0) {
    if (bits.Ue() < 0) return false;
  } else if (poc_type == 1) {
    if (bits.Read() < 0 || !bits.Se() || !bits.Se()) return false;
    const long long cycle = bits.Ue();
    if (cycle < 0 || cycle > 255) return false;
    for (long long i = 0; i < cycle; i++) {
      if (!bits.Se()) return false;
    }
  }
  if (bits.Ue() < 0 || bits.Read() < 0) return false;
  const long long width_mbs = bits.Ue();
  const long long height_units = bits.Ue();
  const int frame_mbs_only = bits.Read();
  if (width_mbs < 0 || height_units < 0 || frame_mbs_only < 0) return false;
  // a number this large is past any cap; kept from overflowing an int
  const long long w = (width_mbs + 1) * 16;
  const long long h = (2 - frame_mbs_only) * (height_units + 1) * 16;
  *width = int(w > 1 << 30 ? 1 << 30 : w);
  *height = int(h > 1 << 30 ? 1 << 30 : h);
  return true;
}

}  // namespace nexa
