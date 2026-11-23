#!/usr/bin/env bash
# One-time setup, run as root inside WSL (Ubuntu):
#   sudo bash scripts/test-env/install.sh [obsidian-version]
#
# Installs a virtual X display (Xvfb), jq, the shared libraries the Obsidian
# Electron binary needs, and the official Obsidian Linux package from
# github.com/obsidianmd/obsidian-releases. With no version argument the latest
# release is used.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if [ "$(id -u)" -ne 0 ]; then
	echo "Run as root: sudo bash $0 [obsidian-version]" >&2
	exit 1
fi

echo '==> Installing Xvfb, jq and Electron runtime libraries'
apt-get update -qq
apt-get install -y -qq curl ca-certificates xvfb xauth jq \
	libasound2t64 libgbm1 libnss3 libxss1 libgtk-3-0t64 libsecret-1-0 libnotify4 libxtst6

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
	VERSION="$(curl -fsSL https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest |
		jq -r '.tag_name' | sed 's/^v//')"
fi
DEB="obsidian_${VERSION}_amd64.deb"
URL="https://github.com/obsidianmd/obsidian-releases/releases/download/v${VERSION}/${DEB}"

echo "==> Installing Obsidian ${VERSION}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/$DEB" "$URL"
dpkg-deb -f "$TMP/$DEB" Package Version Maintainer
apt-get install -y -qq "$TMP/$DEB"

echo '==> Checking for missing shared libraries'
if ldd /opt/Obsidian/obsidian | grep 'not found'; then
	echo 'Some libraries are missing; install them with apt and re-run.' >&2
	exit 1
fi
echo "Done: $(command -v obsidian)"
