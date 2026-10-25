#!/usr/bin/env bash
# Build the Nexe Flatpak, sign it and publish it to https://nexe.decatron.net/flatpak/
# Run from anywhere: apps/desktop/flatpak/publish.sh
set -euo pipefail

cd "$(dirname "$0")"

GPG_KEY=0BAFF15956CD7900
GPG_HOME="$HOME/.nexe-flatpak-gpg"
PUBLISH_DIR=/var/www/html/nexe-flatpak

flatpak-builder --force-clean --default-branch=stable \
  --gpg-sign="$GPG_KEY" --gpg-homedir="$GPG_HOME" \
  --repo=repo --disable-rofiles-fuse build net.decatron.Nexe.yml

flatpak build-update-repo --gpg-sign="$GPG_KEY" --gpg-homedir="$GPG_HOME" \
  --generate-static-deltas --prune repo

rsync -a --delete repo/ "$PUBLISH_DIR/repo/"
echo "Published. On clients: flatpak update net.decatron.Nexe"
