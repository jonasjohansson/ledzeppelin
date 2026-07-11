cmake_minimum_required(VERSION 3.16.3)

project(
  "LeapWS"
  VERSION 0.1.0
  DESCRIPTION "Transmit hand data through a WebSocket"
  LANGUAGES C
)

# Enforce building in a build folder
if (CMAKE_BINARY_DIR STREQUAL CMAKE_SOURCE_DIR)
    message(FATAL_ERROR "Run CMake in a separate build directory to avoid source code contamination.")
endif ()

# For Libwebsockets (?)
SET(SERVER_NAME Server)

if(WIN32)
  if(CMAKE_SIZEOF_VOID_P EQUAL 8)
    set(CMAKE_LIBRARY_ARCHITECTURE x64)
  else()
    set(CMAKE_LIBRARY_ARCHITECTURE x86)
  endif()
endif()

# -------- Search for libwebsockets

find_package(libwebsockets CONFIG REQUIRED)

require_lws_config(LWS_ROLE_WS 1 requirements)

# Add libwebsockets to the project
if (websockets_shared)
  find_library(LIBWEBSOCKETS_LIBS websockets_shared)
else()
  find_library(LIBWEBSOCKETS_LIBS websockets)
endif()

# -------- Search for LeapC and include the headers and libraries

# Set path for cmake files
if (WIN32)
	file(TO_CMAKE_PATH "$ENV{ProgramFiles}\\Ultraleap" ULTRALEAP_PATH_ROOT)
elseif (APPLE)
	set(ULTRALEAP_PATH_ROOT "/Library/Application\ Support/Ultraleap/LeapSDK/lib/cmake/LeapSDK")
elseif (UNIX)
	set(ULTRALEAP_PATH_ROOT "/usr/share/doc/ultraleap-hand-tracking-service/lib/cmake/LeapSDK")
endif()

find_package(LeapSDK
	REQUIRED
	PATHS
		"${ULTRALEAP_PATH_ROOT}")

set(CMAKE_THREAD_PREFER_PTHREAD TRUE)

if (WIN32)
	find_package(PThreads4W REQUIRED)
elseif (UNIX)
 	find_package(Threads REQUIRED)
endif()

find_package(Threads REQUIRED)

get_target_property(
	LEAPC_IMPORTED_CONFIG
	LeapSDK::LeapC
	IMPORTED_CONFIGURATIONS
)

get_target_property(
	LEAPC_SHARED_LIB_PATH
	LeapSDK::LeapC
	IMPORTED_LOCATION_${LEAPC_IMPORTED_CONFIG}
)

# -------- Set shared libraries and executables

# Build libUtils and link LeapC to it

add_library(
	libUtils
	OBJECT
	"utils.c")

if (WIN32)
	target_link_libraries(
		libUtils
		PUBLIC
		LeapSDK::LeapC)
elseif (UNIX)
	target_link_libraries(
		libUtils
		PUBLIC
		LeapSDK::LeapC
		m)
endif()

target_include_directories(
	libUtils
	PUBLIC
	${CMAKE_CURRENT_SOURCE_DIR})

# Build the executable and link libs to it

add_executable(Ultraleap-Tracking-WS "main.c")

if (WIN32)
	target_link_libraries(
		Ultraleap-Tracking-WS
		PUBLIC
		libUtils
		PThreads4W::PThreads4W
		${LIBWEBSOCKETS_LIBS})
elseif (UNIX)
	target_link_libraries(
		Ultraleap-Tracking-WS
		PUBLIC
		libUtils
		Threads::Threads
		${LIBWEBSOCKETS_LIBS})
endif()

add_custom_command(
	TARGET Ultraleap-Tracking-WS
	POST_BUILD
	COMMAND
		${CMAKE_COMMAND} -E copy
		${LEAPC_SHARED_LIB_PATH}
		$<TARGET_FILE_DIR:Ultraleap-Tracking-WS>)
