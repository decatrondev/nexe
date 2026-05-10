#!/bin/bash
# Install Nexe systemd services
set -e

INFRA_DIR="/var/www/html/nexe/infra/systemd"

for service in nexe-gateway nexe-guilds nexe-messaging nexe-presence nexe-web; do
  echo "Installing $service..."
  cp "$INFRA_DIR/$service.service" /etc/systemd/system/
done

systemctl daemon-reload

for service in nexe-gateway nexe-guilds nexe-messaging nexe-presence nexe-web; do
  systemctl enable $service
  echo "Enabled $service"
done

echo "Done! Start with: systemctl start nexe-gateway nexe-guilds nexe-messaging nexe-presence nexe-web"
