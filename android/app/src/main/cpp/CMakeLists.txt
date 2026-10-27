cmake_minimum_required(VERSION 3.22)
project(nexanative C CXX)

# Call frame encryption (frame/) and RNNoise for Enhanced noise suppression (rnnoise/, BSD).
add_library(nexa_native SHARED
    frame/aes_gcm.cc
    frame/sealed_frame.cc
    frame/h264.cc
    frame/frame_crypto.cc
    denoise_jni.cc
    rnnoise/denoise.c
    rnnoise/rnn.c
    rnnoise/rnn_data.c
    rnnoise/pitch.c
    rnnoise/kiss_fft.c
    rnnoise/celt_lpc.c)
target_include_directories(nexa_native PRIVATE ${CMAKE_CURRENT_SOURCE_DIR} ${CMAKE_CURRENT_SOURCE_DIR}/rnnoise)
target_compile_features(nexa_native PRIVATE cxx_std_17)
set_source_files_properties(
    rnnoise/denoise.c rnnoise/rnn.c rnnoise/rnn_data.c rnnoise/pitch.c rnnoise/kiss_fft.c rnnoise/celt_lpc.c
    PROPERTIES COMPILE_FLAGS "-Wno-unused-variable -Wno-unused-function -Wno-shorten-64-to-32")
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
