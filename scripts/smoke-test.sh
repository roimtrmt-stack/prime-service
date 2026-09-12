#!/usr/bin/env bash
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:-https://kfxalpvbtbvkncztjwzc.supabase.co}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
ORIGIN="https://roimtrmt-stack.github.io"

if [[ -z "$SUPABASE_ANON_KEY" ]]; then
  echo "SUPABASE_ANON_KEY absent : test distant ignoré."
  exit 0
fi

check_invalid() {
  local name="$1"
  local url="$2"
  local status
  status=$(curl --silent --show-error --output "/tmp/${name}-response.txt" --write-out '%{http_code}' \
    -X POST "$url" \
    -H "Origin: $ORIGIN" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H 'Content-Type: application/json' \
    --data '{}')
  case "$status" in
    400|401|403|429) echo "$name: refus correct ($status)" ;;
    *) cat "/tmp/${name}-response.txt"; echo "$name: réponse inattendue ($status)"; return 1 ;;
  esac
}

check_invalid commande "${SUPABASE_URL}/functions/v1/envoyer-commande"
check_invalid inscription "${SUPABASE_URL}/functions/v1/envoyer-inscription"
