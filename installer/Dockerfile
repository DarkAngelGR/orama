# FlexPlex installer: Samsung's Tizen command-line tools + a small Python service.
# x86-64 only (Samsung ships the tools for x86-64 Linux).
FROM ubuntu:22.04

ARG TIZEN_VERSION=6.1
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl zip unzip python3 pciutils locales \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 1000 developer

# Samsung's installer refuses to run as root.
USER developer
WORKDIR /home/developer
RUN curl -fL -o /tmp/tizen.bin \
      "https://download.tizen.org/sdk/Installer/tizen-studio_${TIZEN_VERSION}/web-cli_Tizen_Studio_${TIZEN_VERSION}_ubuntu-64.bin" \
 && chmod +x /tmp/tizen.bin \
 && /tmp/tizen.bin --accept-license /home/developer/tizen-studio \
 && rm /tmp/tizen.bin \
 && /home/developer/tizen-studio/package-manager/package-manager-cli.bin install --accept-license \
      cert-add-on TV-SAMSUNG-Public-WebAppDevelopment TV-SAMSUNG-Extension-Tools Certificate-Manager \
 && mkdir -p /home/developer/tizen-studio-data
ENV PATH=/home/developer/tizen-studio/tools:/home/developer/tizen-studio/tools/ide/bin:$PATH

USER root
COPY installer.py entrypoint.sh /app/
RUN chmod +x /app/entrypoint.sh
VOLUME /data
EXPOSE 8790
HEALTHCHECK --interval=1m --timeout=5s CMD curl -fs http://localhost:${PORT:-8790}/health || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
