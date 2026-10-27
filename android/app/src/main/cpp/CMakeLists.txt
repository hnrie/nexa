cmake_minimum_required(VERSION 3.22)
project(nexanative C CXX)

# Call frame encryption (frame/) and RNNoise for Enhanced noise suppression (rnnoise/, BSD).
add_library(nexa_native SHARED
    frame/aes_gcm.cc
    frame/sealed_frame.cc
    frame/h264.cc
    frame/frame_crypto.cc
    denoise_jni.cc
)
target_include_directories(nexa_native PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(nexa_native PRIVATE cxx_std_17)
set_target_properties(nexa_native PROPERTIES CXX_VISIBILITY_PRESET hidden C_VISIBILITY_PRESET hidden)
target_link_libraries(nexa_native log m)

# RustCrypto owns AES/GHASH; the C++ layer only owns frame packing and handles.
find_program(NEXA_CARGO cargo HINTS "$ENV{HOME}/.cargo/bin" REQUIRED)
set(NEXA_FRAME_CRATE "${CMAKE_CURRENT_SOURCE_DIR}/../../../../frame-crypto")
if(ANDROID_ABI STREQUAL "arm64-v8a")
    set(NEXA_RUST_TARGET "aarch64-linux-android")
elseif(ANDROID_ABI STREQUAL "armeabi-v7a")
    set(NEXA_RUST_TARGET "armv7-linux-androideabi")
elseif(ANDROID_ABI STREQUAL "x86_64")
    set(NEXA_RUST_TARGET "x86_64-linux-android")
else()
    message(FATAL_ERROR "Unsupported frame crypto ABI: ${ANDROID_ABI}")
endif()
set(NEXA_RUST_LIB "${CMAKE_CURRENT_BINARY_DIR}/rust/${NEXA_RUST_TARGET}/release/libnexa_frame_crypto.a")
add_custom_command(OUTPUT "${NEXA_RUST_LIB}"
    COMMAND ${CMAKE_COMMAND} -E env "ANDROID_NDK_HOME=${CMAKE_ANDROID_NDK}"
        ${NEXA_CARGO} ndk -t ${ANDROID_ABI} -P 26 build
        --manifest-path "${NEXA_FRAME_CRATE}/Cargo.toml"
        --target-dir "${CMAKE_CURRENT_BINARY_DIR}/rust" --release --locked
    WORKING_DIRECTORY "${NEXA_FRAME_CRATE}"
    DEPENDS "${NEXA_FRAME_CRATE}/Cargo.toml" "${NEXA_FRAME_CRATE}/Cargo.lock" "${NEXA_FRAME_CRATE}/src/lib.rs"
    VERBATIM)
add_custom_target(nexa_frame_rust DEPENDS "${NEXA_RUST_LIB}")
add_library(nexa_frame_aead STATIC IMPORTED)
set_target_properties(nexa_frame_aead PROPERTIES IMPORTED_LOCATION "${NEXA_RUST_LIB}")
add_dependencies(nexa_frame_aead nexa_frame_rust)
target_link_libraries(nexa_native nexa_frame_aead dl)

# Whisper Tiny transcripts are local; pin the inference engine used on every ABI.
include(FetchContent)
FetchContent_Declare(nexa_rnnoise
    URL https://github.com/xiph/rnnoise/archive/70f1d256acd4b34a572f999a05c87bf00b67730d.tar.gz
    URL_HASH SHA256=f61ee0b3f4c4cd337303e003d333357c5eaf25ef5d75a742109ee59e9a0a3932)
FetchContent_Declare(nexa_rnnoise_model
    URL https://media.xiph.org/rnnoise/models/rnnoise_data-0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37.tar.gz
    URL_HASH SHA256=0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37)
FetchContent_MakeAvailable(nexa_rnnoise nexa_rnnoise_model)
set(RN ${nexa_rnnoise_SOURCE_DIR}/src)
add_library(nexa_rnnoise_lib STATIC
    ${RN}/denoise.c ${RN}/rnn.c ${RN}/pitch.c ${RN}/kiss_fft.c ${RN}/celt_lpc.c
    ${RN}/nnet.c ${RN}/nnet_default.c ${RN}/parse_lpcnet_weights.c ${RN}/rnnoise_tables.c
    ${nexa_rnnoise_model_SOURCE_DIR}/src/rnnoise_data.c)
target_include_directories(nexa_rnnoise_lib PRIVATE ${RN} ${nexa_rnnoise_SOURCE_DIR}/include ${nexa_rnnoise_model_SOURCE_DIR}/src)
target_include_directories(nexa_native PRIVATE ${nexa_rnnoise_SOURCE_DIR}/include)
target_link_libraries(nexa_native nexa_rnnoise_lib)

set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
FetchContent_Declare(nexa_whisper
    URL https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.5.tar.gz
    URL_HASH SHA256=ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720)
add_compile_options($<$<COMPILE_LANGUAGE:CXX>:-fexceptions>)
FetchContent_MakeAvailable(nexa_whisper)
add_library(nexa_whisper_jni SHARED whisper_jni.cc)
target_compile_features(nexa_whisper_jni PRIVATE cxx_std_17)
target_link_libraries(nexa_whisper_jni whisper log)
