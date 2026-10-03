cmake_minimum_required(VERSION 3.22)
project(nexanative C CXX)

# Call frame encryption (frame/) and RNNoise for Enhanced noise suppression (rnnoise/, BSD).
add_library(nexa_native SHARED
    frame/aes_gcm.cc
    frame/sealed_frame.cc
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
