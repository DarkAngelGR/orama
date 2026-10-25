# FlexPlex installer: a small Python service + Apps2Samsung's command-line tool
# (github.com/Apps2Samsung/Apps2Samsung), which signs and installs on the TV.
# x86-64 and arm64.
FROM debian:bookworm-slim

# A2S_VERSION: an Apps2Samsung release tag (e.g. v3.0.0-beta), or "latest": the
# newest release, beta or not, that includes the command-line tool (it first
# shipped in v3.0.0-beta).
ARG A2S_VERSION=latest
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl python3 \
 && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
    case "$(uname -m)" in x86_64) RID=linux-x64 ;; aarch64|arm64) RID=linux-arm64 ;; *) echo "unsupported CPU" >&2; exit 1 ;; esac; \
    if [ "$A2S_VERSION" = latest ]; then API="https://api.github.com/repos/Apps2Samsung/Apps2Samsung/releases?per_page=30"; \
    else API="https://api.github.com/repos/Apps2Samsung/Apps2Samsung/releases/tags/$A2S_VERSION"; fi; \
    curl -fsSL "$API" -o /tmp/releases.json; \
    URL=$(RID=$RID python3 -c "import json,os; d=json.load(open('/tmp/releases.json')); rels=d if isinstance(d,list) else [d]; rid=os.environ['RID']; urls=[a['browser_download_url'] for r in rels if not r.get('draft') for a in r.get('assets',[]) if '-cli-' in a['name'] and a['name'].endswith('-'+rid+'.tar.gz')]; print(urls[0] if urls else '')"); \
    rm /tmp/releases.json; \
    [ -n "$URL" ] || { echo "no apps2samsung-cli $RID download found" >&2; exit 1; }; \
    echo "Apps2Samsung CLI: $URL"; \
    mkdir -p /opt/apps2samsung; \
    curl -fsSL "$URL" | tar -xz -C /opt/apps2samsung; \
    chmod +x /opt/apps2samsung/apps2samsung-cli; \
    ln -s /opt/apps2samsung/apps2samsung-cli /usr/local/bin/apps2samsung-cli; \
    apps2samsung-cli --version

COPY installer.py /app/installer.py
VOLUME /data
EXPOSE 8790
HEALTHCHECK --interval=1m --timeout=5s CMD curl -fs http://localhost:${PORT:-8790}/health || exit 1
CMD ["python3", "-u", "/app/installer.py"]
