#!/bin/bash
# Nexe Daily Backup Script
# Backs up PostgreSQL and Redis to /var/backups/nexe/
# Cron: 0 4 * * * /var/www/html/nexe/infra/scripts/backup.sh
#
# Keeps last 7 days of backups.

set -euo pipefail

BACKUP_DIR="/var/backups/nexe"
DATE=$(date +%Y-%m-%d_%H%M)
RETENTION_DAYS=7

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting Nexe backup..."

# ─── PostgreSQL ───
echo "  Backing up PostgreSQL (nexe_dev)..."
export PGPASSWORD="lfIEcCZ11kIEM573mA0PA"
pg_dump -U decatron_user -h localhost nexe_dev | gzip > "$BACKUP_DIR/nexe_db_${DATE}.sql.gz"
unset PGPASSWORD
echo "  -> nexe_db_${DATE}.sql.gz ($(du -sh "$BACKUP_DIR/nexe_db_${DATE}.sql.gz" | cut -f1))"

# ─── Redis RDB Snapshot ───
echo "  Triggering Redis BGSAVE..."
redis-cli -n 3 BGSAVE > /dev/null 2>&1
sleep 2

# Copy Redis dump
REDIS_DUMP="/var/lib/redis/dump.rdb"
if sudo test -f "$REDIS_DUMP"; then
  sudo cp "$REDIS_DUMP" "$BACKUP_DIR/redis_${DATE}.rdb"
  sudo chown decatron:decatron "$BACKUP_DIR/redis_${DATE}.rdb"
  echo "  -> redis_${DATE}.rdb ($(du -sh "$BACKUP_DIR/redis_${DATE}.rdb" | cut -f1))"
else
  echo "  (Redis dump not found at $REDIS_DUMP, skipping)"
fi

# ─── Cleanup old backups ───
echo "  Cleaning backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "nexe_db_*.sql.gz" -mtime +${RETENTION_DAYS} -delete
find "$BACKUP_DIR" -name "redis_*.rdb" -mtime +${RETENTION_DAYS} -delete

echo "[$(date)] Backup complete!"
ls -lh "$BACKUP_DIR" | tail -10
