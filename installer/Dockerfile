# FlexPlex installer: a small Python service + Apps2Samsung's command-line tool
# (github.com/Apps2Samsung/Apps2Samsung), which signs and installs on the TV.
# x86-64 and arm64.
FROM debian:bookworm-slim

# A2S_VERSION: an Apps2Samsung release tag (e.g. v2.7.9), or "latest".
ARG A2S_VERSION=latest
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl python3 \
 && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
    case "$(uname -m)" in x86_64) RID=linux-x64 ;; aarch64|arm64) RID=linux-arm64 ;; *) echo "unsupported CPU" >&2; exit 1 ;; esac; \
    if [ "$A2S_VERSION" = latest ]; then API=https://api.github.com/repos/Apps2Samsung/Apps2Samsung/releases/latest; \
    else API=https://api.github.com/repos/Apps2Samsung/Apps2Samsung/releases/tags/$A2S_VERSION; fi; \
    URL=$(curl -fsSL "$API" | python3 -c "import json,sys; a=[x['browser_download_url'] for x in json.load(sys.stdin)['assets'] if '-cli-' in x['name'] and x['name'].endswith('-$RID.tar.gz')]; print(a[0] if a else '')"); \
    [ -n "$URL" ] || { echo "no apps2samsung-cli $RID download in that release" >&2; exit 1; }; \
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
