cmake_minimum_required(VERSION 3.16)
project(leap-osc C)
set(CMAKE_C_STANDARD 99)

# Hyperion SDK default install path on macOS (override: -DLEAPSDK_DIR=…)
set(LEAPSDK_DIR "/Library/Application Support/Ultraleap/LeapSDK" CACHE PATH "Ultraleap LeapSDK root")
find_package(LeapSDK 5 QUIET PATHS "${LEAPSDK_DIR}/lib/cmake/LeapSDK")

add_executable(leap-osc main.c channels.c osc.c feed_fake.c)
target_link_libraries(leap-osc m)

if(LeapSDK_FOUND)
  target_sources(leap-osc PRIVATE feed_leapc.c)
  target_compile_definitions(leap-osc PRIVATE HAVE_LEAPC)
  target_link_libraries(leap-osc LeapSDK::LeapC)
  message(STATUS "LeapC found — full build")
else()
  message(STATUS "LeapC NOT found — fake-only build (run with --fake)")
endif()
