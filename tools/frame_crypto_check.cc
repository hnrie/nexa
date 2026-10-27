// Host driver for check_frame_crypto.mjs. Uses the same packing and AES bridge
// shipped in Android, without WebRTC/JNI or a live call provider.
#include "sealed_frame.h"
#include "key_set.h"
#include <iostream>
#include <string>
#include <vector>

static std::vector<uint8_t> Unhex(const char* value) {
  std::string hex(value);
  if (hex.size() % 2) throw std::runtime_error("odd hex input");
  std::vector<uint8_t> out;
  for (size_t i = 0; i < hex.size(); i += 2)
    out.push_back(static_cast<uint8_t>(std::stoul(hex.substr(i, 2), nullptr, 16)));
  return out;
}
int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "keys") {
    nexa::KeySet keys;
    std::array<uint8_t, 32> older{}, newer{};
    newer.fill(1);
    keys.Set({{7, older}, {263, newer}}, 263);
    const uint8_t iv[12] = {1}, plain[3] = {3, 4, 5};
    for (const auto& raw : {older, newer}) {
      nexa::AesGcm cipher; cipher.Init(raw.data());
      uint8_t sealed[64] = {}, opened[64] = {};
      const auto n = nexa::SealFrame(cipher, 7, iv, false, plain, 3, sealed);
      long size = -1;
      keys.With(7, [&](const nexa::AesGcm& candidate) {
        size = nexa::OpenFrame(candidate, false, sealed, n, opened);
        return size == 3;
      });
      if (size != 3 || !std::equal(plain, plain + 3, opened)) return 1;
    }
    bool sentNewest = false;
    keys.WithSending([&](const nexa::AesGcm& cipher, int index) {
      uint8_t sealed[64] = {}, opened[64] = {};
      const auto n = nexa::SealFrame(cipher, index, iv, false, plain, 3, sealed);
      nexa::AesGcm newest; newest.Init(newer.data());
      sentNewest = index == 7 && nexa::OpenFrame(newest, false, sealed, n, opened) == 3;
    });
    return sentNewest ? 0 : 1;
  }
  if (argc != 6) return 1;
  const auto key = Unhex(argv[3]), iv = Unhex(argv[4]), input = Unhex(argv[5]);
  if (key.size() != 32 || iv.size() != nexa::kIvLen) return 1;
  nexa::AesGcm cipher;
  cipher.Init(key.data());
  const std::string kind(argv[2]);
  const bool h264 = kind == "h264";
  std::vector<uint8_t> out(nexa::MaxSealedH264(input.size()) + 64);
  long size;
  if (std::string(argv[1]) == "seal") {
    size = h264 ? nexa::SealH264Frame(cipher, 7, iv.data(), input.data(), input.size(), out.data())
                : nexa::SealFrame(cipher, 7, iv.data(), kind != "audio", input.data(), input.size(), out.data());
    if (size == 0) return 2;
  } else {
    size = h264 ? nexa::OpenH264Frame(cipher, input.data(), input.size(), out.data())
                : nexa::OpenFrame(cipher, kind != "audio", input.data(), input.size(), out.data());
    if (size < 0) return 2;
  }
  const char* hex = "0123456789abcdef";
  for (long i = 0; i < size; i++) std::cout << hex[out[i] >> 4] << hex[out[i] & 15];
  std::cout << '\n';
}
