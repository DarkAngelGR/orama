#!/usr/bin/env bash
# Queue commands for the dev build on the TV, via tools/devserver.mjs.
#   tools/tvsend.sh keys=down,right,right,enter [gap=200]
#   tools/tvsend.sh 'eval=document.title'        (tools/tveval.sh also prints the result)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRET_FILE="$ROOT/build/dev-secret"
[ -s "$SECRET_FILE" ] || { echo "No build/dev-secret yet: start node tools/devserver.mjs first." >&2; exit 1; }
ARGS=()
for a in "$@"; do ARGS+=(--data-urlencode "$a"); done
curl -sS -f -H "X-Dev-Secret: $(tr -d '\n' < "$SECRET_FILE")" "${ARGS[@]}" "http://127.0.0.1:${PORT:-8790}/send"
