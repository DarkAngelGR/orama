#!/usr/bin/env bash
# Build, sign, install and launch the app on the TV configured in .env.
#   ./scripts/deploy.sh               release build (Samsung .wgt)
#   ./scripts/deploy.sh --dev         dev build: perf overlay, logs + remote control via tools/devserver.mjs
#   ./scripts/deploy.sh --build-only  just produce build/app (no TV needed)
#   ./scripts/deploy.sh --no-run      install but don't launch
#   ./scripts/deploy.sh --webos       webOS build: build/app-webos and an .ipk
#   ./scripts/deploy.sh --webos --build-only
#                                     package the .ipk, don't install it
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/.env" ] || { echo "No .env yet. Run ./scripts/setup.sh first." >&2; exit 1; }
set -a; source "$ROOT/.env"; set +a

DEV=0; RUN=1; INSTALL=1; WEBOS=0
for arg in "$@"; do
  case "$arg" in
    --dev) DEV=1 ;;
    --no-run) RUN=0 ;;
    --build-only) INSTALL=0 ;;
    --webos) WEBOS=1 ;;
  esac
done

# --- build: the app is plain JS modules, so building is a copy ---------------
OUT="$ROOT/build/app"
[ "$WEBOS" = 1 ] && OUT="$ROOT/build/app-webos"
rm -rf "$OUT" && mkdir -p "$ROOT/build"
cp -R "$ROOT/app" "$OUT"
VERSION=$(sed -n 's/.*widget.* version="\([^"]*\)".*/\1/p' "$ROOT/app/config.xml")
# Each package should only carry its own manifest. config.xml is Tizen;
# appinfo.json is webOS. The webOS version is written from config.xml.
if [ "$WEBOS" = 1 ]; then
  rm -f "$OUT/config.xml"
  sed -i.bak '/webapis\/webapis.js/d' "$OUT/index.html" && rm -f "$OUT/index.html.bak"
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    j.version = process.argv[2];
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  ' "$OUT/appinfo.json" "$VERSION"
else
  rm -f "$OUT/appinfo.json"
fi
if [ "$DEV" = 1 ]; then
  PLEX_URL=""; [ "${DEV_SKIP_LOGIN:-0}" = 1 ] && PLEX_URL="${PLEX_SERVER_URL:-}"
  # Shared with tools/devserver.mjs, which only takes commands/logs carrying it.
  SECRET_FILE="$ROOT/build/dev-secret"
  if [ ! -s "$SECRET_FILE" ]; then
    (umask 077; LC_ALL=C tr -dc 'a-f0-9' < /dev/urandom | head -c 32 > "$SECRET_FILE"; echo >> "$SECRET_FILE")
  fi
  DEV_SECRET=$(tr -dc 'a-f0-9' < "$SECRET_FILE")
  cat > "$OUT/js/config.js" <<EOF
export const DEV = true;
export const DEV_HOST = '${DEV_HOST:-}';
export const DEV_SECRET = '$DEV_SECRET';
export const DEV_PLEX_URL = '$PLEX_URL';
export const VERSION = '$VERSION';
EOF
else
  rm -rf "$OUT/js/dev"
  sed -i.bak "s/^export const VERSION = .*/export const VERSION = '$VERSION';/" "$OUT/js/config.js" && rm "$OUT/js/config.js.bak"
fi
# Release: pack the ~60 modules into one minified file (plus small pieces for
# the screens that load on first use), so the TV reads and parses far less at
# start. Needs Node (npx fetches esbuild); without it, the plain modules ship.
BUNDLED=0
if [ "$DEV" = 0 ] && command -v npx >/dev/null 2>&1; then
  ESB="npx --yes esbuild@0.24.0"
  # webOS 5 (2020) is Chromium 68. Tizen 6.5 is Chromium 85. Both have ES modules.
  ES_TARGET=chrome85
  [ "$WEBOS" = 1 ] && ES_TARGET=chrome68
  if $ESB "$OUT/js/main.js" --bundle --splitting --format=esm --minify --keep-names --target="$ES_TARGET" \
       --chunk-names=c-[hash] --external:./dev/* --legal-comments=none --log-level=warning \
       --metafile="$ROOT/build/meta.json" --outdir="$OUT/js.min" \
     && $ESB "$OUT/css/app.css" --minify --target="$ES_TARGET" --log-level=warning --outfile="$OUT/css/app.min.css"; then
    rm -rf "$OUT/js" && mv "$OUT/js.min" "$OUT/js"
    mv "$OUT/css/app.min.css" "$OUT/css/app.css"
    BUNDLED=1
  else
    echo "bundling failed: shipping the plain modules" >&2
    rm -rf "$OUT/js.min" "$OUT/css/app.min.css"
  fi
fi
if [ "$BUNDLED" = 1 ]; then
  # Preload what start-up needs (main + the pieces it imports right away).
  PRELOADS=$(node -e '
    const m = require(process.argv[1]).outputs;
    const key = Object.keys(m).find(k => k.endsWith("/main.js"));
    const name = k => "js/" + k.split("/").pop();
    const seen = new Set();
    (function walk(k) {
      if (seen.has(k)) return;
      seen.add(k);
      m[k].imports.filter(i => i.kind === "import-statement").forEach(i => walk(i.path));
    })(key);
    const out = [...seen].map(name);
    console.log(out.map(f => `<link rel="modulepreload" href="${f}">`).join(" "));
  ' "$ROOT/build/meta.json")
  rm -f "$ROOT/build/meta.json"
else
  # Plain modules: preload the ones start-up needs so the TV fetches them in
  # parallel instead of discovering the import graph one level at a time.
  # (Screens that load on first use are left out.)
  LAZY='screens/(search|settings|person|catalog|info|users|downloads|updates|jellyfin-login)\.js|util/smart\.js|vendor/qrcode\.js|dev/'
  PRELOADS=$(cd "$OUT" && find js -name '*.js' | grep -Ev "$LAZY" | sort | sed 's|.*|<link rel="modulepreload" href="&">|' | tr '\n' ' ')
fi
sed -i.bak "s|</head>|$PRELOADS</head>|" "$OUT/index.html" && rm "$OUT/index.html.bak"
# chrome68 must not leave optional chaining, nullish coalescing, or class fields.
if [ "$WEBOS" = 1 ] && [ "$BUNDLED" = 1 ]; then
  printf '%s\n' 'export const probe = window?.a ?? 1; class Probe { field = 1 }' > "$ROOT/build/chrome68-probe.js"
  $ESB "$ROOT/build/chrome68-probe.js" --bundle --format=esm --target=chrome68 --outfile="$ROOT/build/chrome68-probe.out.js"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const probe = fs.readFileSync(process.argv[1], "utf8");
    if (probe.indexOf("?.") >= 0 || probe.indexOf("??") >= 0 || /class\s+Probe\s*\{[^}]*field\s*=/.test(probe)) {
      console.error("chrome68 target did not lower ?. ?? or class fields");
      process.exit(1);
    }
    const dir = process.argv[2];
    const bad = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".js")) continue;
      const s = fs.readFileSync(path.join(dir, f), "utf8");
      // `?.85` is a minified ternary (`? .85`), not optional chaining.
      if (/\?\.(?!\d)/.test(s) || s.indexOf("??") >= 0) bad.push(f);
    }
    if (bad.length) {
      console.error("webOS bundle still has ?. or ??: " + bad.join(", "));
      process.exit(1);
    }
  ' "$ROOT/build/chrome68-probe.out.js" "$OUT/js"
  rm -f "$ROOT/build/chrome68-probe.js" "$ROOT/build/chrome68-probe.out.js"
fi
DEST="build/app"
[ "$WEBOS" = 1 ] && DEST="build/app-webos"
echo "built $([ "$DEV" = 1 ] && echo dev || echo release) $VERSION$([ "$BUNDLED" = 1 ] && echo ' (bundled)') → $DEST"
if [ "$WEBOS" = 1 ]; then
  # --no-minify: esbuild already minified for chrome68. ares minify breaks that bundle.
  # --package picks the ares-package bin inside @webos-tools/cli.
  rm -f "$ROOT"/build/*.ipk
  npx --yes --package @webos-tools/cli ares-package --no-minify "$OUT" -o "$ROOT/build"
  made=$(ls "$ROOT"/build/*.ipk | head -1)
  mv "$made" "$ROOT/build/Orama-$VERSION.ipk"
  echo "packaged build/Orama-$VERSION.ipk"
  [ "$INSTALL" = 1 ] || exit 0
  [ -n "${WEBOS_DEVICE:-}" ] || { echo "Set WEBOS_DEVICE in .env to the ares device name." >&2; exit 1; }
  APP_ID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).id)' "$OUT/appinfo.json")
  npx --yes --package @webos-tools/cli ares-install --device "$WEBOS_DEVICE" "$ROOT/build/Orama-$VERSION.ipk"
  if [ "$RUN" = 1 ]; then
    npx --yes --package @webos-tools/cli ares-launch --device "$WEBOS_DEVICE" "$APP_ID"
  fi
  exit 0
fi
[ "$INSTALL" = 1 ] || exit 0

# --- package, sign, install, launch -------------------------------------------
TIZEN_STUDIO="${TIZEN_STUDIO:-$HOME/tizen-studio}"
SDB="$TIZEN_STUDIO/tools/sdb"
TIZEN="$TIZEN_STUDIO/tools/ide/bin/tizen"
TARGET="$TV_IP:${TV_SDB_PORT:-26101}"
APP_ID=$(sed -n 's/.*tizen:application id="\([^"]*\)".*/\1/p' "$ROOT/app/config.xml")

rm -f "$ROOT"/build/*.wgt
"$TIZEN" package -t wgt -s "${TIZEN_SIGN_PROFILE:-flexplex}" -o "$ROOT/build" -- "$OUT" >/dev/null
# The package is named after the app ("Orama.wgt"); the installer chokes on spaces.
WGT="$ROOT/build/flexplex.wgt"
mv "$(ls "$ROOT"/build/*.wgt | head -1)" "$WGT"

"$SDB" connect "$TARGET" >/dev/null
DEVICE=$("$SDB" devices | awk -v t="$TARGET" '$1 == t { print $3 }')
[ -n "$DEVICE" ] || { echo "Can't reach the TV at $TARGET. Is it on, with Developer Mode pointing at this computer?" >&2; exit 1; }

"$TIZEN" install -n "$WGT" -t "$DEVICE" | grep -E 'install completed|Installed|error|fail' || true
if [ "$RUN" = 1 ]; then "$TIZEN" run -p "$APP_ID" -t "$DEVICE" | tail -1; fi
