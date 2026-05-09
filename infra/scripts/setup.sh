#!/bin/bash
# Nexe — Full setup script
# Run this to set up Nexe from scratch on a new VPS

set -e

echo "=== Nexe Setup ==="

# Check dependencies
command -v go >/dev/null 2>&1 || { echo "Go is required. Install with: snap install go --classic"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "pnpm is required. Install with: npm install -g pnpm"; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "PostgreSQL is required."; exit 1; }
command -v redis-cli >/dev/null 2>&1 || { echo "Redis is required."; exit 1; }
command -v migrate >/dev/null 2>&1 || { echo "golang-migrate is required."; exit 1; }

# Database
echo "--- Creating database ---"
sudo -u postgres psql -c "CREATE DATABASE nexe_dev OWNER decatron_user;" 2>/dev/null || echo "DB already exists"

# Migrations
echo "--- Running migrations ---"
DB_URL="postgresql://decatron_user:lfIEcCZ11kIEM573mA0PA@localhost:5432/nexe_dev?sslmode=disable"

cd /var/www/html/nexe/services/gateway
migrate -path migrations -database "$DB_URL" up

cd /var/www/html/nexe/services/guilds
migrate -path migrations -database "${DB_URL}&x-migrations-table=schema_migrations_guilds" up

cd /var/www/html/nexe/services/messaging
migrate -path migrations -database "${DB_URL}&x-migrations-table=schema_migrations_messaging" up

# Build Go services
echo "--- Building Go services ---"
for svc in gateway guilds messaging presence; do
  echo "Building $svc..."
  cd /var/www/html/nexe/services/$svc
  go build -o bin/$svc ./cmd/main.go
done

# Install frontend deps
echo "--- Installing frontend dependencies ---"
cd /var/www/html/nexe
pnpm install --no-frozen-lockfile

# Build frontends
echo "--- Building frontends ---"
cd apps/desktop && pnpm build
cd ../web && pnpm build

echo ""
echo "=== Setup complete! ==="
echo "Start services with: /root/web-services.sh start nexe-gateway"
echo "Or start all: for s in nexe-gateway nexe-guilds nexe-messaging nexe-presence nexe-web nexe-desktop; do /root/web-services.sh start \$s; done"
