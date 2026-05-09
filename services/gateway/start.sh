#!/bin/bash
cd /var/www/html/nexe/services/gateway
if [ -f .env ]; then
  set -a && source .env && set +a
fi
exec ./bin/gateway
