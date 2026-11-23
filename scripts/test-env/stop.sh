#!/usr/bin/env bash
# Stops the hidden test Obsidian and its Xvfb display:
#   bash scripts/test-env/stop.sh
set -uo pipefail
. "$(dirname "$0")/env.sh"

pkill -f -- "--user-data-dir=$GS_TEST_PROFILE" && echo "Stopped Obsidian ($GS_TEST_PROFILE)"
pkill -f "Xvfb $GS_TEST_DISPLAY( |$)" && echo "Stopped Xvfb $GS_TEST_DISPLAY"
exit 0
