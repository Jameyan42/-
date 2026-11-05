#!/bin/sh
set -eu
# Executed by the operator account with protected BACKUP_DATABASE_URL and FILE_STORAGE_DIR.
# Backups stay local/private; encryption and approved off-machine retention are operator tasks.
export BACKUP_DIR="${BACKUP_ROOT:?set a private backup root}/$(date -u +%Y%m%dT%H%M%SZ)"
exec node --import tsx server/backup.ts backup
