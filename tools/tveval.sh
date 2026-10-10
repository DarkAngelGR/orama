#!/usr/bin/env bash
# Run JS in the dev build on the TV and print the result.
#   tools/tveval.sh '__bench(["right","right"], 200)' [timeout-seconds]
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/build/tv.log"
n=$(wc -l < "$LOG")
curl -s --get --data-urlencode "eval=$1" "localhost:${PORT:-8790}/send" >/dev/null
for _ in $(seq 1 $(( ${2:-30} * 4 ))); do
  sleep 0.25
  tail -n +$((n + 1)) "$LOG" | grep -m1 -E 'eval (→|failed)' && exit 0
done
echo "timeout"; exit 1
