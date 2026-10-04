// H.264 frames in calls, as web/src/voice/h264.ts reads them: a phone shares
// its screen with its hardware H.264 encoder, so the frame encryption and the
// size cap both read H.264 as well as VP8.
//
// A frame is Annex B: NAL units, each after a start code (00 00 01, or
// 00 00 00 01). libwebrtc's packetiser splits a frame at its start codes and
// reads each NAL unit's header; the receiver's depacketiser reads the SPS and
// PPS, and from each slice the PPS it names. So when a frame is sealed those
// stay readable, and the picture itself, the rest of every slice, is sealed.
#ifndef NEXA_H264_H_
#define NEXA_H264_H_

#include <stddef.h>
#include <stdint.h>

#include <vector>

namespace nexa {

// One NAL unit: where its start code starts, and where its own bytes (from
// the header on) start and end.
struct Nalu {
  size_t start;
  size_t payload;
  size_t end;
};

constexpr int kNaluSlice = 1;
constexpr int kNaluIdr = 5;
constexpr int kNaluSps = 7;

// The NAL units of an Annex B frame, found exactly as libwebrtc's
// H264::FindNaluIndices finds them: a start code is 00 00 01, and a zero
// before it makes it the 4-byte one.
std::vector<Nalu> NaluIndices(const uint8_t* data, size_t len);

// Whether a frame is Annex B H.264: it opens with a start code. A VP8 frame never does.
bool IsAnnexB(const uint8_t* data, size_t len);

// How many of a NAL unit's bytes stay readable when its frame is sealed: all
// of one that carries no picture, the header of one that does, and with a
// slice also the start of its header, as far as its PPS id. -1 for a slice
// too short to read.
long NaluClearBytes(const uint8_t* data, const Nalu& nalu);

// The picture an SPS sets up, as a decoder allocates it: whole macroblocks,
// before any cropping. False for an SPS that cannot be read.
bool SpsSize(const uint8_t* data, const Nalu& nalu, int* width, int* height);

}  // namespace nexa

#endif  // NEXA_H264_H_
