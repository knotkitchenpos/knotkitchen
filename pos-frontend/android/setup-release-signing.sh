#!/usr/bin/env bash
#
# One time: create the Android app's release key and give it to CI as GitHub
# secrets, so every build is signed with the same key and installed apps can
# update themselves (ShellUpdater.java). Run it yourself, from Git Bash:
#
#   bash pos-frontend/android/setup-release-signing.sh [backup-folder]
#
# The password is generated here and never printed, put on a command line or
# written into the repo. The key and its password are saved ONLY in the backup
# folder (default ~/KnotKitchen-android-signing). Copy that folder somewhere
# safe and offline: if it is lost, installed apps can never be updated again
# and every till has to uninstall and reinstall.
set -euo pipefail

REPO="knotkitchenpos/knotkitchen"
ALIAS="knotkitchen"
OUT="${1:-$HOME/KnotKitchen-android-signing}"
KEY="$OUT/knotkitchen-release.jks"

command -v keytool >/dev/null || { echo "keytool not found: install a JDK (17 or newer) first."; exit 1; }
command -v gh >/dev/null || { echo "gh (GitHub CLI) not found."; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Sign in first: gh auth login"; exit 1; }

if [ -e "$KEY" ]; then
  echo "A key already exists at $KEY. Not replacing it: apps signed with it could no longer update."
  echo "To re-send it to GitHub, set the secrets from that folder by hand."
  exit 1
fi

mkdir -p "$OUT"
chmod 700 "$OUT" 2>/dev/null || true

# "|| true": head closing the pipe early is expected, not a failure (pipefail).
KK_PASS="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40 || true)"
[ "${#KK_PASS}" -eq 40 ] || { echo "Could not generate a password."; exit 1; }
export KK_PASS

# PKCS12: the key password is the store password.
keytool -genkeypair -keystore "$KEY" -storetype PKCS12 -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 -validity 36500 \
  -dname "CN=KnotKitchen POS, O=KnotKitchen, C=IN" \
  -storepass:env KK_PASS -keypass:env KK_PASS >/dev/null

printf '%s\n' "$KK_PASS" > "$OUT/knotkitchen-release.password.txt"
chmod 600 "$KEY" "$OUT/knotkitchen-release.password.txt" 2>/dev/null || true

# Values go in on stdin, never as arguments.
base64 -w0 "$KEY" | gh secret set ANDROID_KEYSTORE_BASE64 -R "$REPO"
printf '%s' "$KK_PASS" | gh secret set ANDROID_KEYSTORE_PASSWORD -R "$REPO"
printf '%s' "$KK_PASS" | gh secret set ANDROID_KEY_PASSWORD -R "$REPO"
printf '%s' "$ALIAS" | gh secret set ANDROID_KEY_ALIAS -R "$REPO"
unset KK_PASS

echo "Done. The next Android build is release-signed."
echo "Back up this folder offline now (both files): $OUT"
