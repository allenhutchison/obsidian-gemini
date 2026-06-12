#!/usr/bin/env bash
# Scheduled runner for the auto-dev skill (.agents/skills/auto-dev/SKILL.md).
#
# Each invocation runs ONE tick of the autonomous issue-to-PR pipeline in a
# DEDICATED clone — never in the interactive checkout — so unattended runs
# cannot disturb work in progress in ~/src/obsidian-gemini.
#
# Install (every 30 minutes) with crontab -e:
#   */30 * * * * /Users/allen/src/obsidian-gemini/scripts/auto-dev.sh
#
# Overridable environment:
#   AUTO_DEV_DIR             dedicated clone location (default: ~/src/obsidian-gemini-autodev)
#   AUTO_DEV_LOG_DIR         log directory (default: ~/.local/state/auto-dev)
#   AUTO_DEV_MAX_BUDGET_USD  per-tick API spend cap (default: 10)
#   AUTO_DEV_MAX_SECONDS     per-tick wall-clock cap, covering clone/install/claude (default: 2700)

set -euo pipefail

# cron provides a minimal PATH; make sure claude, gh, git, node are reachable.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

REPO_URL="https://github.com/allenhutchison/obsidian-gemini.git"
WORK_DIR="${AUTO_DEV_DIR:-$HOME/src/obsidian-gemini-autodev}"
LOG_DIR="${AUTO_DEV_LOG_DIR:-$HOME/.local/state/auto-dev}"
LOCK_FILE="${TMPDIR:-/tmp}/obsidian-gemini-auto-dev.lock"
MAX_BUDGET_USD="${AUTO_DEV_MAX_BUDGET_USD:-10}"
MAX_SECONDS="${AUTO_DEV_MAX_SECONDS:-2700}"

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/auto-dev-$(date +%Y-%m-%d).log"
exec >>"$LOG_FILE" 2>&1

echo ""
echo "=== auto-dev tick start $(date '+%Y-%m-%dT%H:%M:%S%z') ==="

# The EXIT trap guarantees a structured end-of-tick line even when set -e
# aborts setup early, and releases the lock only if this tick owns it.
LOCK_HELD=0
WATCHDOG_PID=""
cleanup() {
	local code=$?
	if [ -n "$WATCHDOG_PID" ]; then
		kill "$WATCHDOG_PID" 2>/dev/null || true
	fi
	if [ "$LOCK_HELD" = 1 ]; then
		rm -f "$LOCK_FILE"
	fi
	echo "=== auto-dev tick end $(date '+%Y-%m-%dT%H:%M:%S%z') status=$code ==="
}
trap cleanup EXIT

# --- Lock: atomic create-with-PID via noclobber; skip if a live tick holds it. ---
acquire_lock() {
	(
		set -o noclobber
		echo "$$" >"$LOCK_FILE"
	) 2>/dev/null
}
if ! acquire_lock; then
	HELD_PID="$(cat "$LOCK_FILE" 2>/dev/null || true)"
	if [ -n "$HELD_PID" ] && kill -0 "$HELD_PID" 2>/dev/null; then
		echo "lock held by running pid $HELD_PID; skipping this tick"
		exit 0
	fi
	echo "reclaiming stale lock (pid ${HELD_PID:-unknown} not running)"
	rm -f "$LOCK_FILE"
	if ! acquire_lock; then
		echo "lost the reclaim race to another tick; skipping"
		exit 0
	fi
fi
LOCK_HELD=1

# --- The whole tick (clone, npm install, claude) runs in a background
# --- subshell so a single watchdog can cap its total wall-clock time.
run_tick() {
	if [ ! -d "$WORK_DIR/.git" ]; then
		echo "creating dedicated clone at $WORK_DIR"
		git clone "$REPO_URL" "$WORK_DIR"
	fi
	cd "$WORK_DIR"
	git fetch origin --prune
	git reset --hard
	git clean -fd
	git checkout master
	git pull --ff-only origin master
	npm install --no-audit --no-fund >/dev/null

	claude -p "/auto-dev" \
		--settings "$WORK_DIR/scripts/auto-dev-settings.json" \
		--permission-mode dontAsk \
		--max-budget-usd "$MAX_BUDGET_USD"
}

run_tick &
TICK_PID=$!

(
	sleep "$MAX_SECONDS"
	if kill -0 "$TICK_PID" 2>/dev/null; then
		echo "watchdog: tick exceeded ${MAX_SECONDS}s; terminating pid $TICK_PID"
		pkill -P "$TICK_PID" 2>/dev/null || true
		kill "$TICK_PID" 2>/dev/null || true
	fi
) &
WATCHDOG_PID=$!

STATUS=0
wait "$TICK_PID" || STATUS=$?
exit "$STATUS"
