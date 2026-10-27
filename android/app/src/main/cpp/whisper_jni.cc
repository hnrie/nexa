#include <jni.h>
#include <whisper.h>
#include <algorithm>
#include <string>
#include <vector>

namespace {
struct Cancellation { JNIEnv* env; jobject flag; jmethodID get; };
bool cancelled(void* opaque) {
    auto* c = static_cast<Cancellation*>(opaque);
    return c->env->CallBooleanMethod(c->flag, c->get) == JNI_TRUE;
}
}
extern "C" JNIEXPORT jbyteArray JNICALL Java_fish_nexa_data_Transcripts_nativeTranscribe(
    JNIEnv* env, jobject, jstring model, jfloatArray pcm, jobject flag, jint threads) {
    const char* path = env->GetStringUTFChars(model, nullptr);
    auto params = whisper_context_default_params();
    params.use_gpu = false;
    // Never log message content (Whisper's default callback can print segments).
    whisper_log_set([](enum ggml_log_level, const char*, void*) {}, nullptr);
    auto* ctx = whisper_init_from_file_with_params(path, params);
    env->ReleaseStringUTFChars(model, path);
    if (!ctx) return nullptr;
    const auto size = env->GetArrayLength(pcm);
    if (size <= 0 || size > 16000 * 601) { whisper_free(ctx); return nullptr; }
    std::vector<float> samples(size);
    env->GetFloatArrayRegion(pcm, 0, size, samples.data());
    Cancellation cancel{env, flag, env->GetMethodID(env->GetObjectClass(flag), "get", "()Z")};
    auto p = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    p.n_threads = std::clamp(int(threads), 1, 4);
    p.language = "auto";
    p.translate = false;
    p.no_context = true;
    p.print_realtime = p.print_progress = p.print_timestamps = p.print_special = false;
    p.abort_callback = cancelled;
    p.abort_callback_user_data = &cancel;
    const int status = whisper_full(ctx, p, samples.data(), size);
    std::string text;
    if (status == 0 && !cancelled(&cancel)) {
        for (int i = 0; i < whisper_full_n_segments(ctx); ++i) text += whisper_full_get_segment_text(ctx, i);
    }
    whisper_free(ctx);
    std::fill(samples.begin(), samples.end(), 0.f);
    if (status != 0 || cancelled(&cancel)) return nullptr;
    auto out = env->NewByteArray(text.size());
    if (out) env->SetByteArrayRegion(out, 0, text.size(), reinterpret_cast<const jbyte*>(text.data()));
    return out;
}
