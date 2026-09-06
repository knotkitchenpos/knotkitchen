#!/usr/bin/env bash
#
# Install Cashfree / Fast2SMS credentials into the deploy env file.
#
# Run this ON THE SERVER. It prompts for each value and reads it silently, so
# the secrets go from your keyboard into the env file and nowhere else -- not
# into a chat transcript, not into your shell history, not into the process
# list.
#
#   ssh root@93.127.194.80
#   bash /srv/knot/deploy/configure-secrets.sh
#
# It is safe to re-run: press Enter at any prompt to leave that value alone.
# The previous .env is backed up before anything is written.

set -euo pipefail

# Work out where everything is from the script's OWN location, rather than
# hardcoding a path. This script ships in the repo at deploy/, so the compose
# file and the env file are its neighbours wherever the checkout happens to
# live -- and the deploy path is a CI secret this script cannot read.
#
# It previously assumed a hardcoded /docker/knotkitchen/.env. The checkout is
# actually at /srv/knot (DEPLOY_APP_PATH), and the env file is deploy/.env
# inside it, so every prompt would have written to a file nothing reads.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

# Every compose call needs both flags; the project is not the default one.
compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No env file at $ENV_FILE" >&2
  exit 1
fi

BACKUP="${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
cp "$ENV_FILE" "$BACKUP"
chmod 600 "$BACKUP"
echo "Backed up to $BACKUP"
echo

# Set KEY=value in the env file, replacing any existing line for that key.
# Values are written through a temp file with restrictive permissions rather
# than echoed, so nothing lands in the shell history.
set_var() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  chmod 600 "$tmp"
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

# $1 key, $2 human label, $3 "secret" to hide input, $4 suggested value.
#
# A suggestion is offered only when the key is NOT already set, and only for
# values that are not secrets -- ids and URLs that are already known. Enter
# accepts it. Anything already in the file is left alone unless you type over
# it, so re-running this is still safe.
ask() {
  local key="$1" label="$2" hide="${3:-}" suggested="${4:-}" value
  local current="" state="not set"
  current="$(grep "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
  [[ -n "$current" ]] && state="currently set (${#current} chars)"

  local offer=""
  [[ -n "$suggested" && -z "$current" ]] && offer="$suggested"

  echo "  $label"
  echo "    key: $key   [$state]"
  [[ -n "$offer" ]] && echo "    suggested: $offer"

  if [[ "$hide" == "secret" ]]; then
    read -rs -p "    value (hidden, Enter to keep): " value
    echo
  elif [[ -n "$offer" ]]; then
    read -r -p "    value (Enter to accept the suggestion): " value
  else
    read -r -p "    value (Enter to keep): " value
  fi

  if [[ -z "$value" && -n "$offer" ]]; then
    value="$offer"
    echo "    -> using the suggested value"
  fi

  if [[ -n "$value" ]]; then
    set_var "$key" "$value"
    echo "    -> saved (${#value} chars)"
  else
    echo "    -> unchanged"
  fi
  echo
}

echo "=============================================="
echo " Credential encryption at rest"
echo "=============================================="
echo
if grep -q "^CREDENTIALS_SECRET=." "$ENV_FILE"; then
  echo "  CREDENTIALS_SECRET is already set. Leaving it alone."
  echo "  (Changing it would make every credential already stored in the"
  echo "   database unreadable, so it is never rotated automatically.)"
else
  # $(...) strips trailing newlines, so no tr pipeline is needed.
  generated="$(openssl rand -hex 32)"
  set_var CREDENTIALS_SECRET "$generated"
  unset generated
  echo "  Generated one. Gateway secrets in the database are now encrypted"
  echo "  with AES-256-GCM instead of being Base64-encoded."
  echo
  echo "  KEEP THE .env BACKUP SAFE. Losing this value means every stored"
  echo "  gateway credential has to be re-entered in Settings."
fi
echo

echo "=============================================="
echo " Cashfree"
echo "=============================================="
echo
ask CASHFREE_APP_ID     "App ID (client id)"
ask CASHFREE_SECRET_KEY "Secret key" secret
echo "  Environment: TEST = sandbox.cashfree.com, PROD = api.cashfree.com."
echo "  Anything unrecognised is treated as sandbox on purpose."
ask CASHFREE_ENV        "Environment (TEST or PROD)"
echo "  Optional. Cashfree requires HTTPS and rejects anything else."
ask CASHFREE_NOTIFY_URL "Webhook URL for server-to-server notifications"

echo "=============================================="
echo " Fast2SMS (DLT)"
echo "=============================================="
echo
echo "  The sender ID and template IDs are NOT secrets -- they are the"
echo "  identifiers registered on the DLT platform."
echo
ask FAST2SMS_API_KEY                  "API key" secret
ask FAST2SMS_SENDER_ID                "Approved sender ID / header (3-6 chars)"
ask FAST2SMS_EBILL_TEMPLATE_ID        "E-bill DLT Message ID"
ask FAST2SMS_ORDER_READY_TEMPLATE_ID  "Order-ready DLT Message ID (optional)"
ask FAST2SMS_PAYMENT_LINK_TEMPLATE_ID "Payment-link DLT Message ID (optional)"
ask FAST2SMS_OTP_ID                   "OTP DLT Message ID (optional)"

echo "=============================================="
echo " Fast2SMS (WhatsApp)"
echo "=============================================="
echo
echo "  E-bills go out over WhatsApp when these two are set, because the"
echo "  template carries a tappable bill link that SMS cannot."
echo "  Both come from the Fast2SMS WhatsApp panel; neither is a secret."
echo "  Leave them blank to keep e-bills on SMS."
echo
ask FAST2SMS_WHATSAPP_PHONE_NUMBER_ID  "WhatsApp phone_number_id (WABA number ID)" "" "1186508304555187"
ask FAST2SMS_EBILL_WHATSAPP_MESSAGE_ID "E-bill WhatsApp Message ID" "" "31172"

echo "=============================================="
echo " Public receipt links"
echo "=============================================="
echo
echo "  The origin the bill link is built from. Must be reachable by a"
echo "  customer with no login -- normally https://api.knotkitchen.online"
echo
ask PUBLIC_API_URL "Public API origin for /r/<token> links" "" "https://api.knotkitchen.online"

echo "=============================================="
echo " Restarting the API"
echo "=============================================="
cd "$REPO_DIR"
compose up -d pos-api

echo
echo "Waiting for the API to come back..."
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "https://api.knotkitchen.online/api/public/store/148379/menu" 2>/dev/null; then
    echo "API is up."
    break
  fi
  sleep 2
done

echo
echo "=============================================="
echo " What the container can now see (lengths only)"
echo "=============================================="
compose exec -T pos-api node -e '
const names = [
  "CASHFREE_APP_ID","CASHFREE_SECRET_KEY","CASHFREE_ENV","CASHFREE_NOTIFY_URL",
  "FAST2SMS_API_KEY","FAST2SMS_SENDER_ID","FAST2SMS_EBILL_TEMPLATE_ID",
  "FAST2SMS_ORDER_READY_TEMPLATE_ID","FAST2SMS_PAYMENT_LINK_TEMPLATE_ID","FAST2SMS_OTP_ID",
  "FAST2SMS_WHATSAPP_PHONE_NUMBER_ID","FAST2SMS_EBILL_WHATSAPP_MESSAGE_ID",
  "PUBLIC_API_URL","RECEIPT_LINK_SECRET","CREDENTIALS_SECRET",
];
for (const n of names) {
  const v = process.env[n];
  const state = v === undefined ? "absent"
    : v.length === 0 ? "DECLARED BUT EMPTY"
    : `set (${v.length} chars)`;
  console.log(n.padEnd(36), state);
}
'
echo
echo "Nothing above prints a value. If something reads DECLARED BUT EMPTY,"
echo "the variable reached the container with no content -- re-run and set it."

echo
echo "=============================================="
echo " What an e-bill will actually do"
echo "=============================================="
compose exec -T pos-api node -e '
const { MESSAGES, channelFor } = require("/app/services/messagingService");
const link = require("/app/services/receiptLink");

const channel = channelFor(MESSAGES.eBill);
const explain = {
  whatsapp: "WhatsApp template (what the approved e-bill template needs)",
  dlt:      "DLT SMS -- WhatsApp is NOT configured, check the two WhatsApp values",
  v3:       "plain SMS -- no template configured at all, and operators may drop it",
};
console.log("channel :", channel, "--", explain[channel]);

// A real, signed link for a made-up id, so the shape can be eyeballed.
try {
  console.log("link    :", link.urlForOrder("000000000000000000000000"));
} catch (err) {
  console.log("link    : NOT BUILDABLE --", err.message);
}

if (channel === "whatsapp") {
  const vars = MESSAGES.eBill.whatsapp.variables({
    restaurantName: "Your Restaurant",
    orderNumber: "A-1042",
    total: "525.00",
    receiptUrl: "https://api.knotkitchen.online/r/o_x_y",
  });
  console.log("");
  console.log("Variables, in the order they will be sent:");
  vars.forEach((v, i) => console.log("  " + (i + 1) + ".", v));
  console.log("");
  console.log("Expected in the message: header shows the restaurant, then");
  console.log("Order No / Total / View Bill. If they come out shuffled, the");
  console.log("header belongs at the OTHER end of the list -- say so and it");
  console.log("is a one-line change.");
}
'
