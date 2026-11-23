#!/usr/bin/env bash
# =====================================================================
# Tests de base de données sur un PostgreSQL LOCAL.
#
# ⚠️ Ce script SUPPRIME et recrée la base de test (yc_test) à chaque lancement.
#    Il refuse volontairement tout hôte autre que localhost, pour ne jamais
#    toucher à une base de production.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-test}"
DB="${TEST_DB:-yc_test}"

if [[ "$PGHOST" != "localhost" && "$PGHOST" != "127.0.0.1" ]]; then
  echo "Refus : PGHOST doit être localhost (ce script détruit la base $DB)." >&2
  exit 1
fi

echo "→ recréation de la base $DB"
psql -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"

echo "→ imitation du schéma auth de Supabase (tests uniquement)"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f supabase/tests/shim/auth_shim.sql

for f in $(ls supabase/migrations/*.sql | sort); do
  echo "→ migration $(basename "$f")"
  psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "→ tests"
TEST_DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$DB" \
  node --test "tests/db/*.test.js"
