cmake_minimum_required(VERSION 3.22)
project(nexanative C CXX)

add_library(nexa_native SHARED placeholder.cc)
target_compile_features(nexa_native PRIVATE cxx_std_17)
set_target_properties(nexa_native PROPERTIES CXX_VISIBILITY_PRESET hidden C_VISIBILITY_PRESET hidden)
target_link_libraries(nexa_native log)
