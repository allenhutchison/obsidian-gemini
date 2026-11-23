#!/usr/bin/env bash
# Run as your normal WSL user after reset-vault.sh:
#   bash scripts/test-env/launch.sh
#
# Starts Xvfb on $GS_TEST_DISPLAY and Obsidian on it with the throwaway profile.
# WSLg's DISPLAY/WAYLAND_DISPLAY are cleared so no window can reach the Windows
# desktop. Chromium remote debugging listens on 127.0.0.1:$CDP_PORT, which WSL
# forwards to Windows localhost, so scripts/test-env/cdp.mjs can drive the app.
# Re-running restarts Obsidian (Xvfb is reused).
set -euo pipefail
. "$(dirname "$0")/env.sh"

if [ ! -f "$GS_TEST_VAULT/$GS_TEST_MARKER" ]; then
	echo "No throwaway vault at $GS_TEST_VAULT; run reset-vault.sh first." >&2
	exit 1
fi

export DISPLAY="$GS_TEST_DISPLAY"
unset WAYLAND_DISPLAY XDG_SESSION_TYPE
# Keep WSLg out entirely (its runtime socket dir would otherwise be discovered).
export XDG_RUNTIME_DIR="$GS_TEST_ROOT/runtime"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

if ! pgrep -f "Xvfb $GS_TEST_DISPLAY( |$)" >/dev/null; then
	setsid nohup Xvfb "$GS_TEST_DISPLAY" -screen 0 1600x1000x24 -nolisten tcp >"$GS_TEST_ROOT/xvfb.log" 2>&1 &
	sleep 1
fi

if pkill -f -- "--user-data-dir=$GS_TEST_PROFILE"; then
	sleep 2
fi
setsid nohup obsidian \
	--user-data-dir="$GS_TEST_PROFILE" \
	--remote-debugging-port="$CDP_PORT" \
	--remote-allow-origins='*' \
	--disable-gpu \
	>"$GS_TEST_ROOT/obsidian.log" 2>&1 &

for _ in $(seq 1 30); do
	if curl -fs "http://127.0.0.1:$CDP_PORT/json/list" >/dev/null 2>&1; then
		break
	fi
	sleep 1
done
if ! curl -fs "http://127.0.0.1:$CDP_PORT/json/list" | jq -r '.[] | "\(.type)\t\(.url)"'; then
	echo "Obsidian did not open the debugging port; see $GS_TEST_ROOT/obsidian.log" >&2
	tail -20 "$GS_TEST_ROOT/obsidian.log" >&2
	exit 1
fi
echo "Obsidian is running hidden on $GS_TEST_DISPLAY; CDP on 127.0.0.1:$CDP_PORT"
