// The slice of libwebrtc's C++ interface this library implements.
//
// WebRTC ends its transport encryption at Cloudflare's SFU, so every call
// frame is sealed again on top; in the browser that is done with insertable
// streams, and the same hook on Android is `RtpSender.setFrameEncryptor`,
// which takes a pointer to a C++ object. The AAR ships no headers, so the two
// interfaces are declared here exactly as libwebrtc declares them: same bases,
// same order, same signatures, which is all the vtable layout depends on.
//
// `webrtc::MediaType` and `ArrayView` are plain values (an int, and a pointer
// with a length), so they are declared as themselves rather than pulled in.
#ifndef NEXA_WEBRTC_ABI_H_
#define NEXA_WEBRTC_ABI_H_

#include <stddef.h>
#include <stdint.h>

namespace webrtc {

enum MediaType {
  MEDIA_TYPE_AUDIO = 0,
  MEDIA_TYPE_VIDEO = 1,
  MEDIA_TYPE_DATA = 2,
  MEDIA_TYPE_UNSUPPORTED = 3,
};

enum class RefCountReleaseStatus { kDroppedLastRef, kOtherRefsRemained };

class RefCountInterface {
 public:
  virtual void AddRef() const = 0;
  virtual RefCountReleaseStatus Release() const = 0;

 protected:
  virtual ~RefCountInterface() {}
};

// Matches rtc::ArrayView<T>'s variable-size layout: a pointer and a count,
// trivially copyable, so it is passed and returned the same way.
template <typename T>
struct ArrayView {
  T* data_;
  size_t size_;

  T* data() const { return data_; }
  size_t size() const { return size_; }
};

class FrameEncryptorInterface : public RefCountInterface {
 public:
  ~FrameEncryptorInterface() override {}

  virtual int Encrypt(MediaType media_type,
                      uint32_t ssrc,
                      ArrayView<const uint8_t> additional_data,
                      ArrayView<const uint8_t> frame,
                      ArrayView<uint8_t> encrypted_frame,
                      size_t* bytes_written) = 0;

  virtual size_t GetMaxCiphertextByteSize(MediaType media_type, size_t frame_size) = 0;
};

class FrameDecryptorInterface : public RefCountInterface {
 public:
  enum class Status { kOk, kRecoverable, kFailedToDecrypt, kUnknown };

  struct Result {
    Result(Status status, size_t bytes_written) : status(status), bytes_written(bytes_written) {}
    const Status status;
    const size_t bytes_written;
  };

  ~FrameDecryptorInterface() override {}

  // The third parameter is `const std::vector<uint32_t>&`; nothing here reads
  // it, and a reference is passed as a pointer either way.
  virtual Result Decrypt(MediaType media_type,
                         const void* csrcs,
                         ArrayView<const uint8_t> additional_data,
                         ArrayView<const uint8_t> encrypted_frame,
                         ArrayView<uint8_t> frame) = 0;

  virtual size_t GetMaxPlaintextByteSize(MediaType media_type, size_t encrypted_frame_size) = 0;
};

}  // namespace webrtc

#endif  // NEXA_WEBRTC_ABI_H_
