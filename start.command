#!/bin/bash
# Double-click launcher (macOS). Starts the ledzeppelin daemon and opens the UI
# in the default browser. The Terminal window stays open while it runs — closing
# it stops LED output. For an always-on installation, use a launchd service instead.
cd "$(dirname "$0")" || exit 1
OPEN=1 exec node server/index.js
