#!/bin/sh
set -eu

backup_dir=/var/backups/stentor
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
temporary="$backup_dir/.stentor-$timestamp.dump.tmp"
destination="$backup_dir/stentor-$timestamp.dump"

install -d -m 700 "$backup_dir"
cd /opt/stentor
docker compose exec -T postgres pg_dump -U stentor -d stentor -Fc >"$temporary"
chmod 600 "$temporary"
mv "$temporary" "$destination"
find "$backup_dir" -type f -name 'stentor-*.dump' -mtime +7 -delete
