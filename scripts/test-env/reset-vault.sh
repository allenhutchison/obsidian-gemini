#!/usr/bin/env bash
# Run as your normal WSL user (not root):
#   bash scripts/test-env/reset-vault.sh [worktree]
#
# Deletes and recreates $GS_TEST_ROOT (default ~/gs-test) with a throwaway vault
# and a separate Obsidian profile that knows only that vault, then installs the
# plugin build (main.js, manifest.json, styles.css) from the given worktree.
# The worktree defaults to the current directory and may be a WSL path
# (/mnt/c/...) or a Windows path (C:\...). Run `npm run build` there first.
set -euo pipefail
. "$(dirname "$0")/env.sh"

WORKTREE="${1:-$PWD}"
case "$WORKTREE" in
	[A-Za-z]:\\* | [A-Za-z]:/*) WORKTREE="$(wslpath -u "$WORKTREE")" ;;
esac
for f in main.js manifest.json styles.css; do
	if [ ! -f "$WORKTREE/$f" ]; then
		echo "Missing $WORKTREE/$f; run 'npm run build' in the worktree first." >&2
		exit 1
	fi
done

case "$GS_TEST_ROOT" in
	/mnt/*)
		echo "Refusing: GS_TEST_ROOT must be inside the WSL filesystem, not $GS_TEST_ROOT" >&2
		exit 1
		;;
esac
if pgrep -f -- "--user-data-dir=$GS_TEST_PROFILE" >/dev/null; then
	echo "Stopping the running test Obsidian first"
	pkill -f -- "--user-data-dir=$GS_TEST_PROFILE" || true
	sleep 2
fi

PLUGIN_ID="$(jq -r .id "$WORKTREE/manifest.json")"
PLUGIN_DIR="$GS_TEST_VAULT/.obsidian/plugins/$PLUGIN_ID"

rm -rf "$GS_TEST_ROOT"
mkdir -p "$PLUGIN_DIR" "$GS_TEST_PROFILE"

# Profile: register only the throwaway vault and open it on launch.
cat >"$GS_TEST_PROFILE/obsidian.json" <<EOF
{"vaults":{"gstestvault0001":{"path":"$GS_TEST_VAULT","ts":$(date +%s)000,"open":true}},"updateDisabled":true}
EOF

# Plugin build, enabled, with debug logging and hooks on.
cp "$WORKTREE/main.js" "$WORKTREE/manifest.json" "$WORKTREE/styles.css" "$PLUGIN_DIR/"
echo "[\"$PLUGIN_ID\"]" >"$GS_TEST_VAULT/.obsidian/community-plugins.json"
echo '{"hooksEnabled":true,"debugMode":true}' >"$PLUGIN_DIR/data.json"

printf 'Throwaway Gemini Scribe test vault. Safe to delete.\n' >"$GS_TEST_VAULT/$GS_TEST_MARKER"
printf '# Test vault\n\nThrowaway vault for automated plugin testing.\n' >"$GS_TEST_VAULT/Welcome.md"

echo "Reset $GS_TEST_ROOT with $PLUGIN_ID $(jq -r .version "$WORKTREE/manifest.json") from $WORKTREE"
