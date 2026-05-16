#!/bin/bash
# Nexe Health Check Script
# Checks all services and sends email alert if any are down.
# Cron: */5 * * * * /var/www/html/nexe/infra/scripts/health-check.sh
#
# Uses Resend API for email alerts.

set -uo pipefail

RESEND_API_KEY="${RESEND_API_KEY:-re_HqgjH4zC_CrAYdNnFQ28WvMziXnaXUh5b}"
ALERT_EMAIL="decagraff@gmail.com"
FROM_EMAIL="Nexe Alerts <nexe@decatron.net>"
STATE_FILE="/tmp/nexe-health-state"

declare -A SERVICES=(
  ["Gateway"]="http://localhost:8090/health"
  ["Guilds"]="http://localhost:8082/health"
  ["Messaging"]="http://localhost:8083/health"
  ["Presence"]="http://localhost:8084/health"
  ["Voice"]="http://localhost:8085/health"
  ["Notifications"]="http://localhost:8086/health"
  ["Web"]="http://localhost:3013"
)

FAILED=""

for name in "${!SERVICES[@]}"; do
  url="${SERVICES[$name]}"
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
  if [ "$status" != "200" ]; then
    FAILED="${FAILED}${name} (HTTP ${status})\n"
  fi
done

# Check if state changed (avoid spamming)
CURRENT_STATE=$(echo -e "$FAILED" | md5sum | cut -d' ' -f1)
PREV_STATE=$(cat "$STATE_FILE" 2>/dev/null || echo "")

if [ -z "$FAILED" ]; then
  # All healthy — clear state
  echo "healthy" > "$STATE_FILE"
  exit 0
fi

# Only alert if state changed
if [ "$CURRENT_STATE" = "$PREV_STATE" ]; then
  exit 0
fi

echo "$CURRENT_STATE" > "$STATE_FILE"

# Send alert email
echo "[$(date)] ALERT: Services down:"
echo -e "$FAILED"

BODY=$(cat <<EOF
<div style="font-family: -apple-system, sans-serif; padding: 20px; background: #0f172a; color: #e2e8f0;">
<h2 style="color: #ef4444;">Nexe Service Alert</h2>
<p>The following services are not responding:</p>
<pre style="background: #1e293b; padding: 16px; border-radius: 8px; color: #fbbf24;">$(echo -e "$FAILED")</pre>
<p style="color: #94a3b8; font-size: 12px;">Server: 161.132.53.175 | $(date)</p>
</div>
EOF
)

curl -s -X POST "https://api.resend.com/emails" \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg from "$FROM_EMAIL" --arg to "$ALERT_EMAIL" --arg subject "⚠️ Nexe: Services Down" --arg html "$BODY" '{from: $from, to: [$to], subject: $subject, html: $html}')" \
  > /dev/null 2>&1

echo "Alert email sent."
