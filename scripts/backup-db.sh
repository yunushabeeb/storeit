#!/usr/bin/env bash
# Custom-format dump of the catalog. Object bytes stay in the bucket and are
# not part of this file. -euo pipefail stops the script when pg_dump fails
# instead of writing an empty archive and printing success.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/backups"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="$root/backups/storeit-${stamp}.dump"

docker exec storeit-db pg_dump -U storeit -Fc storeit > "$destination"
echo "Wrote $destination"
