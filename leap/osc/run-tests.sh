#!/bin/sh
# Compile + run the pure-C unit tests (no LeapC needed). Used by test/leap-osc.test.js.
set -e
cd "$(dirname "$0")"
CC="${CC:-cc}"
$CC -std=c99 -Wall -Werror -o /tmp/lo_test_channels test_channels.c channels.c -lm
/tmp/lo_test_channels
$CC -std=c99 -Wall -Werror -o /tmp/lo_test_osc test_osc.c osc.c channels.c -lm
/tmp/lo_test_osc
