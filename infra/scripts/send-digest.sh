#!/bin/bash
# Send email digest notifications to users with unread notifications.
# Run daily via cron: 0 18 * * * /var/www/html/nexe/infra/scripts/send-digest.sh

curl -s -X POST http://localhost:8086/notifications/digest/send \
  -H "Content-Type: application/json" | jq .
