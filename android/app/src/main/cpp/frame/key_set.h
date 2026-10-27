#ifndef NEXA_KEY_SET_H_
#define NEXA_KEY_SET_H_
#include "aes_gcm.h"
#include <array>
#include <atomic>
#include <map>
#include <mutex>
#include <shared_mutex>
namespace nexa {
// The keys of one call: the newest epochs this device holds, and which one seals.
class KeySet {
 public:
  void Set(const std::map<int, std::array<uint8_t, 32>>& keys, int send_index) {
    std::unique_lock<std::shared_mutex> lock(mu_);
    ciphers_.clear();
    for (const auto& [index, raw] : keys) ciphers_[index].Init(raw.data());
    send_index_ = send_index;
  }

  // Tries matching wire-index candidates newest first until fn succeeds.
  // Returns whether any candidate was held, including when all tags failed.
  template <typename F>
  bool With(int index, F&& fn) {
    std::shared_lock<std::shared_mutex> lock(mu_);
    bool held = false;
    // Full epochs remain distinct locally. The legacy wire index only names
    // a candidate set; GCM authentication selects the actual epoch.
    for (auto it = ciphers_.rbegin(); it != ciphers_.rend(); ++it) {
      if ((it->first & 0xff) != index) continue;
      held = true;
      if (fn(it->second)) break;
    }
    return held;
  }

  template <typename F>
  bool WithSending(F&& fn) {
    std::shared_lock<std::shared_mutex> lock(mu_);
    if (send_index_ < 0) return false;
    auto it = ciphers_.find(send_index_);
    if (it == ciphers_.end()) return false;
    fn(it->second, send_index_ & 0xff);
    return true;
  }

  std::atomic<int64_t> sealed{0};
  std::atomic<int64_t> opened{0};
  std::atomic<int64_t> dropped{0};
  std::atomic<int64_t> oversize{0};

 private:
  // Rekeying is rare and sealing is not, so readers never queue behind each other.
  std::shared_mutex mu_;
  std::map<int, AesGcm> ciphers_;
  int send_index_ = -1;
};

} // namespace nexa
#endif
