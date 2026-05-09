#!/bin/bash
cd /var/www/html/nexe/services/presence
if [ -f .env ]; then
  set -a && source .env && set +a
fi
exec ./bin/presence
