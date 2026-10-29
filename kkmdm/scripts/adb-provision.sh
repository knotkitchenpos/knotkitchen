#!/usr/bin/env bash
# KKMDM technician script: enroll a tablet over USB (ADB) instead of QR.
# For tablets already deployed, or whose setup wizard has no QR provisioning.
#
#   ./adb-provision.sh <server-url> <enrollment-token> [agent.apk]
#
# Requirements (Android refuses Device Owner otherwise):
#   - USB debugging on, this PC authorised on the tablet
#   - NO accounts on the tablet (Settings > Accounts: remove Google etc.)
#   - only one user
# Safest is a factory reset, skip every setup step, enable USB debugging, run this.
# Schedule it outside service hours: the POS restarts into kiosk mode.
set -euo pipefail

SERVER="${1:?server URL, e.g. https://mdm.knotkitchen.com}"
TOKEN="${2:?enrollment token from the dashboard (Enrollment page)}"
APK="${3:-$(dirname "$0")/../server/storage/agent/kk-agent.apk}"
PKG=com.knotkitchen.mdm
ADMIN="$PKG/.AdminReceiver"

command -v adb >/dev/null || { echo "adb not found (install Android platform-tools)"; exit 1; }
adb get-state >/dev/null 2>&1 || { echo "No tablet found. Plug it in and accept the USB debugging prompt."; exit 1; }

echo "Tablet: $(adb shell getprop ro.product.manufacturer | tr -d '\r') $(adb shell getprop ro.product.model | tr -d '\r'), Android $(adb shell getprop ro.build.version.release | tr -d '\r')"

accounts=$(adb shell dumpsys account 2>/dev/null | grep -c "Account {" || true)
if [ "${accounts:-0}" -gt 0 ]; then
  echo "The tablet has $accounts account(s). Remove them (Settings > Accounts) or factory reset first."
  exit 1
fi

echo "Installing KK Agent..."
adb install -r -g "$APK"

if adb shell dumpsys device_policy | grep -q "admin=ComponentInfo{$PKG"; then
  echo "KK Agent is already Device Owner."
else
  echo "Making KK Agent the Device Owner..."
  adb shell dpm set-device-owner "$ADMIN"
fi

# Loopback servers are reached through the USB cable.
case "$SERVER" in
  http://localhost:*|http://127.0.0.1:*)
    port="${SERVER##*:}"; port="${port%%/*}"
    adb reverse "tcp:$port" "tcp:$port"
    echo "adb reverse tcp:$port active (keep the cable in while testing)";;
esac

echo "Enrolling..."
adb shell am start -n "$PKG/.SetupActivity" --es kkmdm_server "$SERVER" --es kkmdm_token "$TOKEN"
echo "Done. The tablet enrolls, applies its policy and opens KnotKitchen POS in kiosk mode."
echo "Watch it on the dashboard: Devices."
