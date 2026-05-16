#!/bin/bash
# Nexe Zero-Downtime Deploy Script
# Called from CI/CD or manually. Builds, then restarts services one by one
# with health checks between each restart.
#
# Usage: ./deploy.sh [--rollback]

set -euo pipefail

NEXE_DIR="/var/www/html/nexe"
SERVICES=(gateway guilds messaging presence voice notifications)
HEALTH_TIMEOUT=10
ROLLBACK_TAG_FILE="/tmp/nexe-last-good-commit"

cd "$NEXE_DIR"

# ─── Rollback mode ───
if [ "${1:-}" = "--rollback" ]; then
  LAST_GOOD=$(cat "$ROLLBACK_TAG_FILE" 2>/dev/null || echo "")
  if [ -z "$LAST_GOOD" ]; then
    echo "ERROR: No rollback commit found."
    exit 1
  fi
  echo "Rolling back to $LAST_GOOD..."
  git checkout "$LAST_GOOD"

  for svc in "${SERVICES[@]}"; do
    echo "  Rebuilding $svc..."
    cd "$NEXE_DIR/services/$svc"
    go build -o "bin/$svc" ./cmd/main.go
    systemctl restart "nexe-$svc"
  done

  cd "$NEXE_DIR/apps/desktop" && pnpm build
  cd "$NEXE_DIR/apps/web" && npx next build
  systemctl restart nexe-web

  echo "Rollback complete to $LAST_GOOD"
  exit 0
fi

# ─── Save current good commit for rollback ───
CURRENT_COMMIT=$(git rev-parse HEAD)
echo "$CURRENT_COMMIT" > "$ROLLBACK_TAG_FILE"

# ─── Pull latest ───
echo "[$(date)] Pulling latest code..."
git pull origin main

# ─── Build Go services (all at once, fast) ───
echo "[$(date)] Building Go services..."
for svc in "${SERVICES[@]}"; do
  (
    cd "$NEXE_DIR/services/$svc"
    set -a && source .env 2>/dev/null; set +a
    go build -o "bin/$svc" ./cmd/main.go
  ) &
done
wait
echo "  All services built."

# ─── Build frontend ───
echo "[$(date)] Building frontend..."
cd "$NEXE_DIR/apps/desktop"
pnpm build

echo "[$(date)] Building web..."
cd "$NEXE_DIR/apps/web"
npx next build

# ─── Zero-downtime restart (one by one with health check) ───
echo "[$(date)] Restarting services..."

check_health() {
  local port=$1
  local retries=0
  while [ $retries -lt $HEALTH_TIMEOUT ]; do
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$port/health" 2>/dev/null | grep -q "200"; then
      return 0
    fi
    sleep 1
    retries=$((retries + 1))
  done
  return 1
}

PORTS=(8090 8082 8083 8084 8085 8086)
for i in "${!SERVICES[@]}"; do
  svc="${SERVICES[$i]}"
  port="${PORTS[$i]}"
  echo "  Restarting nexe-$svc..."
  systemctl restart "nexe-$svc"

  if check_health "$port"; then
    echo "    ✓ nexe-$svc healthy"
  else
    echo "    ✗ nexe-$svc FAILED health check! Rolling back..."
    "$0" --rollback
    exit 1
  fi
done

# Restart web last (stateless, quick)
systemctl restart nexe-web
echo "  ✓ nexe-web restarted"

echo "[$(date)] Deploy complete! ($(git rev-parse --short HEAD))"
