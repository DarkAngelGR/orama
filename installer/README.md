# FlexPlex installer

Keeps FlexPlex on your Samsung TV up to date from your home server, so you never
need a computer or Apps2Samsung again.

- Watches this repo's GitHub releases (a release is published automatically each
  time the version changes).
- Signs each release with a certificate it makes for itself and installs it on
  the TV with Samsung's own tools.
- Start an install from **Settings › Updates** in FlexPlex, from its web page
  (works on a phone: `http://<server>:8790`), or let it install new releases by
  itself (`AUTO_INSTALL`).

FlexPlex finds it automatically when it runs on the same machine as Plex.

## Setup

1. **Point the TV's Developer Mode at the server.** On the TV, open *Apps*, type
   `12345` on the remote, turn Developer Mode **On** and enter the **server's**
   IP address as the Host PC IP. Restart the TV. (Developer Mode allows one
   address, so a computer you used before stops working; that's fine.)
2. **Set your TV's IP** in `docker-compose.yml` (`TV_IP`). Give the TV a fixed
   address in your router so it doesn't change.
3. **Start it** on the server (x86-64 Linux with Docker), from this folder:

   ```sh
   docker compose up -d --build
   ```

   The first build downloads Samsung's tools (about 300 MB) and takes a few
   minutes.
4. Open `http://<server>:8790` on your phone and press **Install**.

### The first install replaces your current copy

The TV only accepts an update signed with the same certificate as the copy it
has. Your current FlexPlex was signed by Apps2Samsung, so the first install from
the server uninstalls it and installs fresh: sign in to Plex again afterwards.
Later updates keep your settings. (Set `REINSTALL_ON_CERT_MISMATCH=false` to
stop it doing this.)

Keep the `data/` folder: it holds the certificate. Lose it and the next
install has to replace the app again.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `TV_IP` | (required) | The TV's IP address |
| `AUTO_INSTALL` | `false` | Install new releases by itself (when the TV is on) |
| `CHECK_HOURS` | `6` | How often to look for a new release |
| `PASSWORD` | (none) | Protects the web page and API; enter it in Settings › Updates on the TV |
| `GITHUB_REPO` | `DarkAngelGR/FlexPlex` | Where releases come from |
| `GITHUB_TOKEN` | (none) | Only if GitHub's rate limit gets in the way |
| `REINSTALL_ON_CERT_MISMATCH` | `true` | See above |
| `PORT` | `8790` | Web page and API |

## API

- `GET /api/status`: installed and latest versions, progress, recent log.
- `POST /api/check`: look for a release now.
- `POST /api/install` (`{"version": "0.9.0"}` optional): install the latest release.

CORS is allowed so the TV app can call it. With `PASSWORD` set, calls need
HTTP Basic auth (any user name).
