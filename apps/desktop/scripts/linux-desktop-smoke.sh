#!/usr/bin/env bash
# Run packaged UI checks inside the caller's isolated X11 and D-Bus session.
set -euo pipefail
# Electron selects libsecret for this synthetic GNOME session.
export XDG_CURRENT_DESKTOP=GNOME
printf '%s' 'strugend-ci-keyring' | gnome-keyring-daemon --unlock --components=secrets
node apps/web/tests/strugend-desktop-smoke.mjs "$1"
