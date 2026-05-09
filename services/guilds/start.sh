#!/bin/bash
cd /var/www/html/nexe/services/guilds
if [ -f .env ]; then
  set -a && source .env && set +a
fi
exec ./bin/guilds
