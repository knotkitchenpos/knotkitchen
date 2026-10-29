#!/usr/bin/env bash
# Builds the signed KK Agent release APK and publishes it to the local server
# (server/storage/agent/kk-agent.apk), which the QR's download URL serves.
#
#   ./build-agent.sh [cert pins, e.g. "sha256/AAA...,sha256/BBB..."]
#
# Needs JDK 17+ and the Android SDK (ANDROID_HOME or agent/local.properties)
# and agent/signing/keystore.properties. Bump versionCode in
# agent/app/build.gradle first: devices only take a higher versionCode.
set -euo pipefail
cd "$(dirname "$0")/../agent"
PINS="${1:-}"
./gradlew -q assembleRelease ${PINS:+-PkkmdmCertPins="$PINS"}
APK=app/build/outputs/apk/release/app-release.apk
mkdir -p ../server/storage/agent
cp "$APK" ../server/storage/agent/kk-agent.apk
echo "Published $(grep -E 'versionName' app/build.gradle | tr -d ' ') to server/storage/agent/kk-agent.apk"
echo "Upload the same APK on Applications to roll it out to enrolled tablets."
