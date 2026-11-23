#!/usr/bin/env bash
# Shared settings for the hidden WSL test environment. Sourced by the other
# scripts in this folder; override any value through the environment.
#
#   GS_TEST_ROOT   where the throwaway vault, profile and logs live (default ~/gs-test)
#   GS_TEST_DISPLAY  virtual X display number used by Xvfb (default :99)
#   CDP_PORT       Chrome DevTools Protocol port on localhost (default 9222)
#
# Run a second, independent instance by changing all three, for example:
#   GS_TEST_ROOT=~/gs-test-2 GS_TEST_DISPLAY=:98 CDP_PORT=9223 bash launch.sh

GS_TEST_ROOT="${GS_TEST_ROOT:-$HOME/gs-test}"
GS_TEST_DISPLAY="${GS_TEST_DISPLAY:-:99}"
CDP_PORT="${CDP_PORT:-9222}"
GS_TEST_VAULT="$GS_TEST_ROOT/vault"
GS_TEST_PROFILE="$GS_TEST_ROOT/profile"
# cdp.mjs refuses to act on any vault that lacks this marker file.
GS_TEST_MARKER=".gs-throwaway-vault"
