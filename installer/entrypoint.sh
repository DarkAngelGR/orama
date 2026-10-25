#!/bin/sh
# Keep the signing certificate and state in /data (a volume), then run the
# installer as the unprivileged user that owns Samsung's tools.
set -e
U=developer
H=/home/$U
mkdir -p /data/tizen/keystore /data/tizen/profile
chown -R $U:$U /data
for d in keystore profile; do
  rm -rf "$H/tizen-studio-data/$d"
  ln -s "/data/tizen/$d" "$H/tizen-studio-data/$d"
done
chown -h $U:$U "$H/tizen-studio-data/keystore" "$H/tizen-studio-data/profile"
exec runuser -u $U -- sh -c '
  tizen cli-config "profiles.path=$HOME/tizen-studio-data/profile/profiles.xml" >/dev/null 2>&1 || true
  exec python3 -u /app/installer.py'
