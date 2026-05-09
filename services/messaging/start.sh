#!/bin/bash
cd /var/www/html/nexe/services/messaging
if [ -f .env ]; then
  set -a && source .env && set +a
fi
exec ./bin/messaging
