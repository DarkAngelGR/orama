# FlexPlex installer

Keeps FlexPlex on your Samsung TV up to date from your home server, so you
don't need a computer to update it.

- Watches this repo's GitHub releases.
- Installs a new release on the TV using
  [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung)'s command-line
  tool, signed with the **same certificate** your Apps2Samsung app already
  uses, so updates keep FlexPlex's settings and sign-in.
- Start an install from **Settings › Updates** in FlexPlex, from its web page
  (works on a phone: `http://<server>:8790`), or let it install new releases by
  itself (`AUTO_INSTALL`).

FlexPlex finds it automatically when it runs on the same machine as Plex.

## Setup

1. **Copy your Apps2Samsung certificate to the server.** On the computer where
   you use Apps2Samsung, find its data folder:
   - Windows: `%APPDATA%\Apps2Samsung` (paste that into File Explorer's address bar)
   - Linux / macOS: `~/.config/Apps2Samsung`

   Copy the **`Certificate`** folder from there to `installer/data/apps2samsung/`
   on the server, so you end up with `installer/data/apps2samsung/Certificate/Jelly2Sams - Public/…`.
   Keep it private: it can sign apps for your TV.
2. **Point the TV's Developer Mode at the server.** On the TV, open *Apps*, type
   `12345` on the remote, keep Developer Mode **On** and change the Host PC IP
   to the **server's** IP address. Restart the TV. (Developer Mode allows one
   address; to use Apps2Samsung on your computer again later, switch it back.)
3. **Set your TV's IP** in `docker-compose.yml` (`TV_IP`). Give the TV a fixed
   address in your router so it doesn't change.
4. **Start it** on the server (Linux, x86-64 or arm64, with Docker), from this folder:

   ```sh
   docker compose up -d --build
   ```
5. Open `http://<server>:8790` on your phone and press **Install**.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `TV_IP` | (required) | The TV's IP address |
| `AUTO_INSTALL` | `false` | Install new releases by itself (when the TV is on) |
| `CHECK_HOURS` | `6` | How often to look for a new release |
| `PASSWORD` | (none) | Protects the web page and API; enter it in Settings › Updates on the TV |
| `ALLOW_REINSTALL` | `false` | Let Apps2Samsung go past its pre-install warnings and, if the TV refuses an update (e.g. a different certificate), uninstall and install fresh, which erases FlexPlex's settings and sign-in |
| `GITHUB_REPO` | `DarkAngelGR/FlexPlex` | Where releases come from |
| `GITHUB_TOKEN` | (none) | Only if GitHub's rate limit gets in the way |
| `PORT` | `8790` | Web page and API |

To use a specific Apps2Samsung version, build with
`docker compose build --build-arg A2S_VERSION=v2.7.9` (default: the newest).

## API

- `GET /api/status`: installed and latest versions, progress, recent log.
- `POST /api/check`: look for a release now.
- `POST /api/install` (`{"version": "0.9.0"}` optional): install the latest release.

CORS is allowed so the TV app can call it. With `PASSWORD` set, calls need
HTTP Basic auth (any user name).
