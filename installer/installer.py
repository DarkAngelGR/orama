#!/usr/bin/env python3
"""FlexPlex installer: keeps the FlexPlex app on a Samsung TV up to date.

Watches the GitHub releases of FlexPlex, and on request (from its web page, from
FlexPlex itself, or automatically) downloads the newest .wgt, signs it with this
server's certificate and installs it on the TV with Samsung's tools.

Standard library only. Samsung's tools (tizen, sdb) come with the Docker image.
"""
import base64
import hmac
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PRODUCT = "flexplex-installer"
VERSION = "1.0.0"


def env(name, default=""):
    return os.environ.get(name, default).strip()


CFG = {
    "tv_ip": env("TV_IP"),
    "tv_port": int(env("TV_SDB_PORT", "26101") or 26101),
    "repo": env("GITHUB_REPO", "DarkAngelGR/FlexPlex"),
    "github_api": env("GITHUB_API", "https://api.github.com").rstrip("/"),
    "github_token": env("GITHUB_TOKEN"),
    "check_hours": float(env("CHECK_HOURS", "6") or 6),
    "auto_install": env("AUTO_INSTALL", "false").lower() in ("1", "true", "yes", "on"),
    "port": int(env("PORT", "8790") or 8790),
    "password": env("PASSWORD"),
    "data": env("DATA_DIR", "/data"),
    "tizen": env("TIZEN_BIN", "tizen"),
    "sdb": env("SDB_BIN", "sdb"),
    "profile": env("SIGN_PROFILE", "flexplex"),
    # A TV refuses an update signed by a different certificate. Allowed by
    # default: uninstall the old copy (its settings and sign-in go with it) and
    # install fresh. Happens once, the first time this server installs it.
    "reinstall_on_cert_mismatch": env("REINSTALL_ON_CERT_MISMATCH", "true").lower() in ("1", "true", "yes", "on"),
}

STATE_FILE = os.path.join(CFG["data"], "state.json")
WORK = os.path.join(CFG["data"], "work")
LOG_MAX = 200


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_version(v):
    """'v0.8.10' -> (0, 8, 10). Non-numeric parts count as 0."""
    nums = re.findall(r"\d+", v or "")
    return tuple(int(n) for n in nums[:4]) or (0,)


def newer(a, b):
    """Is version a newer than version b? An unknown b counts as older."""
    if not a:
        return False
    if not b:
        return True
    return parse_version(a) > parse_version(b)


class State:
    """Small persisted state: what was installed, what's latest, a short log."""

    def __init__(self):
        self.lock = threading.Lock()
        self.data = {"installed": "", "installed_at": "", "seen_on_tv": "", "seen_at": "",
                     "latest": None, "checked_at": "", "check_error": "",
                     "last": None, "log": []}
        self.busy = False
        try:
            with open(STATE_FILE) as f:
                self.data.update(json.load(f))
        except (OSError, ValueError):
            pass

    def save(self):
        os.makedirs(CFG["data"], exist_ok=True)
        tmp = STATE_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.data, f, indent=1)
        os.replace(tmp, STATE_FILE)

    def update(self, **kw):
        with self.lock:
            self.data.update(kw)
            self.save()

    def log(self, msg):
        line = time.strftime("%Y-%m-%d %H:%M:%S ") + msg
        print(line, flush=True)
        with self.lock:
            self.data["log"] = (self.data.get("log") or [])[-(LOG_MAX - 1):] + [line]
            self.save()

    def installed(self):
        """Best guess of the version on the TV: what FlexPlex last reported, or
        what this installer last put there, whichever is newer."""
        a, b = self.data.get("seen_on_tv"), self.data.get("installed")
        return a if newer(a, b) or not b else b

    def public(self):
        with self.lock:
            d = dict(self.data)
        latest = d.get("latest") or None
        installed = self.installed()
        return {
            "product": PRODUCT, "version": VERSION,
            "repo": CFG["repo"], "tv_ip": CFG["tv_ip"], "auto_install": CFG["auto_install"],
            "installed": installed, "installed_at": d.get("installed_at", ""),
            "latest": latest, "checked_at": d.get("checked_at", ""), "check_error": d.get("check_error", ""),
            "update_available": bool(latest and newer(latest.get("version"), installed)),
            "busy": self.busy, "last": d.get("last"), "log": (d.get("log") or [])[-30:],
        }


STATE = State()


# --- GitHub --------------------------------------------------------------------

def github(url, accept="application/vnd.github+json", timeout=20):
    headers = {"Accept": accept, "User-Agent": f"{PRODUCT}/{VERSION}"}
    if CFG["github_token"]:
        headers["Authorization"] = "Bearer " + CFG["github_token"]
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout)


def check_latest():
    """Newest published release with a .wgt attached, or raise."""
    url = f"{CFG['github_api']}/repos/{CFG['repo']}/releases/latest"
    try:
        with github(url) as r:
            rel = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise RuntimeError(f"no releases yet in {CFG['repo']}")
        if e.code == 403:
            raise RuntimeError("GitHub rate limit reached; try again later (or set GITHUB_TOKEN)")
        raise RuntimeError(f"GitHub answered {e.code}")
    except (urllib.error.URLError, TimeoutError) as e:
        raise RuntimeError(f"can't reach GitHub ({getattr(e, 'reason', e)})")
    asset = next((a for a in rel.get("assets", []) if a.get("name", "").endswith(".wgt")), None)
    if not asset:
        raise RuntimeError(f"release {rel.get('tag_name')} has no .wgt attached")
    latest = {
        "version": (rel.get("tag_name") or "").lstrip("vV"),
        "tag": rel.get("tag_name"),
        "name": rel.get("name") or rel.get("tag_name"),
        "notes": (rel.get("body") or "").strip()[:2000],
        "published": rel.get("published_at", ""),
        "url": rel.get("html_url", ""),
        "asset": asset.get("browser_download_url"),
        "asset_name": asset.get("name"),
        "size": asset.get("size", 0),
    }
    STATE.update(latest=latest, checked_at=now_iso(), check_error="")
    return latest


def safe_check():
    try:
        return check_latest()
    except Exception as e:  # noqa: BLE001 - reported to the user as-is
        STATE.update(checked_at=now_iso(), check_error=str(e))
        STATE.log(f"update check failed: {e}")
        return None


# --- Samsung tools ---------------------------------------------------------------

class InstallError(Exception):
    pass


def run(cmd, timeout=300):
    """Run a command, returning (exit code, combined output)."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        raise InstallError(f"{cmd[0]} isn't installed (use the Docker image)")
    except subprocess.TimeoutExpired:
        raise InstallError(f"{os.path.basename(cmd[0])} {cmd[1] if len(cmd) > 1 else ''} timed out")
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def ensure_profile():
    """Create this server's signing certificate the first time (like
    scripts/setup.sh does on a computer). Its password is kept in /data."""
    code, out = run([CFG["tizen"], "security-profiles", "list"], timeout=60)
    if re.search(r"^\s*" + re.escape(CFG["profile"]) + r"\s", out, re.M):
        return
    pw_file = os.path.join(CFG["data"], "cert-password")
    if os.path.exists(pw_file):
        pw = open(pw_file).read().strip()
    else:
        pw = base64.b32encode(os.urandom(15)).decode().lower()
        os.makedirs(CFG["data"], exist_ok=True)
        with open(pw_file, "w") as f:
            f.write(pw)
        os.chmod(pw_file, 0o600)
    keystore = os.path.expanduser(f"~/tizen-studio-data/keystore/author/{CFG['profile']}.p12")
    if not os.path.exists(keystore):
        STATE.log("creating this server's signing certificate")
        code, out = run([CFG["tizen"], "certificate", "-a", CFG["profile"], "-p", pw, "-f", CFG["profile"]], timeout=120)
        if code != 0 or not os.path.exists(keystore):
            raise InstallError("couldn't create a signing certificate: " + out.strip()[-300:])
    code, out = run([CFG["tizen"], "security-profiles", "add", "-n", CFG["profile"], "-a", keystore, "-p", pw], timeout=60)
    if code != 0:
        raise InstallError("couldn't set up the signing profile: " + out.strip()[-300:])


def connect_tv():
    """Connect sdb to the TV; returns the device name the tizen CLI wants."""
    if not CFG["tv_ip"]:
        raise InstallError("TV_IP isn't set")
    target = f"{CFG['tv_ip']}:{CFG['tv_port']}"
    run([CFG["sdb"], "connect", target], timeout=30)
    code, out = run([CFG["sdb"], "devices"], timeout=30)
    for line in out.splitlines():
        parts = line.split()
        if parts and parts[0] == target and len(parts) >= 3:
            if parts[1] != "device":
                raise InstallError(f"the TV answered but isn't ready ({parts[1]})")
            return parts[2]
    raise InstallError(f"can't reach the TV at {target}. Is it on, with Developer Mode "
                       f"set to this server's IP address?")


CERT_MISMATCH = re.compile(r"certificate|signature|author", re.I)
INSTALL_OK = re.compile(r"install completed|installed successfully|Installed the package", re.I)


def install_wgt(wgt, app_id, device):
    code, out = run([CFG["tizen"], "install", "-n", wgt, "-t", device], timeout=600)
    if INSTALL_OK.search(out):
        return
    if CFG["reinstall_on_cert_mismatch"] and CERT_MISMATCH.search(out):
        STATE.log("the TV has a copy signed by another certificate; uninstalling it and installing fresh")
        run([CFG["tizen"], "uninstall", "-p", app_id, "-t", device], timeout=300)
        code, out = run([CFG["tizen"], "install", "-n", wgt, "-t", device], timeout=600)
        if INSTALL_OK.search(out):
            return
    tail = " ".join(l.strip() for l in out.strip().splitlines()[-4:])
    raise InstallError("the TV didn't accept the install: " + (tail or f"exit {code}"))


def do_install(latest):
    version = latest["version"]
    STATE.log(f"installing FlexPlex {version}")
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK)
    src = os.path.join(WORK, "release.wgt")
    STATE.log(f"downloading {latest['asset_name']}")
    try:
        with github(latest["asset"], accept="application/octet-stream", timeout=120) as r, open(src, "wb") as f:
            shutil.copyfileobj(r, f)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise InstallError(f"download failed ({getattr(e, 'reason', e)})")

    app_dir = os.path.join(WORK, "app")
    try:
        with zipfile.ZipFile(src) as z:
            for n in z.namelist():  # no absolute paths or ../ escapes
                if n.startswith("/") or ".." in n.split("/"):
                    raise InstallError("the release package looks wrong (unsafe paths)")
            z.extractall(app_dir)
    except zipfile.BadZipFile:
        raise InstallError("the release package isn't a valid .wgt")
    config = os.path.join(app_dir, "config.xml")
    if not os.path.exists(config):
        raise InstallError("the release package has no config.xml")
    # Drop any signature from the release; this server signs it.
    for n in os.listdir(app_dir):
        if re.match(r"(author-)?signature\d*\.xml$", n):
            os.remove(os.path.join(app_dir, n))
    m = re.search(r'tizen:application[^>]*\bid="([^"]+)"', open(config, encoding="utf-8").read())
    if not m:
        raise InstallError("the release package has no Tizen app id")
    app_id = m.group(1)

    ensure_profile()
    out_dir = os.path.join(WORK, "out")
    os.makedirs(out_dir)
    STATE.log("signing")
    code, out = run([CFG["tizen"], "package", "-t", "wgt", "-s", CFG["profile"], "-o", out_dir, "--", app_dir], timeout=300)
    wgts = [f for f in os.listdir(out_dir) if f.endswith(".wgt")]
    if not wgts:
        raise InstallError("signing failed: " + out.strip()[-300:])
    wgt = os.path.join(WORK, "flexplex.wgt")  # the TV installer chokes on spaces
    os.replace(os.path.join(out_dir, wgts[0]), wgt)

    STATE.log(f"connecting to the TV at {CFG['tv_ip']}")
    device = connect_tv()
    STATE.log("installing on the TV")
    install_wgt(wgt, app_id, device)
    STATE.update(installed=version, installed_at=now_iso())
    STATE.log(f"FlexPlex {version} installed; starting it")
    run([CFG["tizen"], "run", "-p", app_id, "-t", device], timeout=60)


def install_job(version=None):
    """Background job. Only one at a time."""
    try:
        latest = check_latest()  # always fresh: the asset URL must match the release
        if version and latest["version"] != version:
            raise InstallError(f"{version} isn't the latest release ({latest['version']} is)")
        do_install(latest)
        STATE.update(last={"ok": True, "version": latest["version"], "at": now_iso(),
                           "message": f"FlexPlex {latest['version']} installed"})
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        STATE.log("install failed: " + msg)
        STATE.update(last={"ok": False, "version": version or "", "at": now_iso(), "message": msg})
    finally:
        STATE.busy = False


def start_install(version=None):
    with STATE.lock:
        if STATE.busy:
            return False
        STATE.busy = True
    threading.Thread(target=install_job, args=(version,), daemon=True).start()
    return True


def loop():
    """Check GitHub every CHECK_HOURS; install by itself when AUTO_INSTALL is on."""
    while True:
        latest = safe_check()
        if latest and CFG["auto_install"] and newer(latest["version"], STATE.installed()):
            STATE.log(f"FlexPlex {latest['version']} is out; installing it (AUTO_INSTALL)")
            start_install(latest["version"])
        time.sleep(max(0.25, CFG["check_hours"]) * 3600)


# --- web -------------------------------------------------------------------------

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FlexPlex installer</title>
<style>
:root { --bg:#0B0D12; --raised:#181B23; --text:#FFF7E6; --dim:rgba(255,247,230,.62); --coral:#FF4C42; --ok:#5BD18B; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 -apple-system, system-ui, sans-serif; }
main { max-width:560px; margin:0 auto; padding:24px 16px 48px; }
h1 { font-size:26px; margin:8px 0 20px; }
.card { background:var(--raised); border-radius:14px; padding:16px; margin-bottom:14px; }
.row { display:flex; justify-content:space-between; gap:12px; padding:6px 0; }
.row span:first-child { color:var(--dim); }
button { width:100%; border:0; border-radius:12px; padding:15px; font:600 17px inherit; margin-top:10px;
  background:var(--coral); color:#fff; }
button.secondary { background:rgba(255,247,230,.12); color:var(--text); }
button:disabled { opacity:.5; }
.msg { margin-top:10px; min-height:1.5em; }
.ok { color:var(--ok); } .bad { color:var(--coral); }
pre { white-space:pre-wrap; font:12px/1.5 ui-monospace, monospace; color:var(--dim); margin:0; max-height:280px; overflow:auto; }
.notes { white-space:pre-wrap; color:var(--dim); font-size:14px; margin-top:8px; }
</style></head><body><main>
<h1>FlexPlex installer</h1>
<div class="card">
  <div class="row"><span>On the TV</span><span id="installed">…</span></div>
  <div class="row"><span>Latest release</span><span id="latest">…</span></div>
  <div class="row"><span>TV</span><span id="tv">…</span></div>
  <div class="notes" id="notes"></div>
  <button id="install" disabled>Install</button>
  <button id="check" class="secondary">Check for updates</button>
  <div class="msg" id="msg"></div>
</div>
<div class="card"><pre id="log"></pre></div>
</main>
<script>
const $ = id => document.getElementById(id);
let busy = false;
async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('error ' + r.status));
  return j;
}
function show(s) {
  busy = s.busy;
  $('installed').textContent = s.installed || 'unknown';
  $('latest').textContent = s.latest ? s.latest.version : (s.check_error || '…');
  $('tv').textContent = s.tv_ip || 'TV_IP not set';
  $('notes').textContent = s.latest && s.update_available ? s.latest.notes : '';
  const b = $('install');
  b.disabled = s.busy || !s.latest;
  b.textContent = s.busy ? 'Installing…' : s.latest ? (s.update_available ? 'Install ' + s.latest.version : 'Reinstall ' + s.latest.version) : 'Install';
  const m = $('msg');
  if (s.busy) { m.className = 'msg'; m.textContent = 'Working… the app on the TV will close and reopen.'; }
  else if (s.last) { m.className = 'msg ' + (s.last.ok ? 'ok' : 'bad'); m.textContent = s.last.message; }
  else if (s.check_error) { m.className = 'msg bad'; m.textContent = s.check_error; }
  else m.textContent = '';
  $('log').textContent = (s.log || []).slice().reverse().join('\\n');
}
async function refresh() { try { show(await api('api/status')); } catch (e) { $('msg').textContent = e.message; } }
$('install').onclick = async () => {
  try { await api('api/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) { $('msg').textContent = e.message; }
  refresh();
};
$('check').onclick = async () => {
  $('msg').textContent = 'Checking…';
  try { show(await api('api/check', { method: 'POST' })); } catch (e) { $('msg').textContent = e.message; }
};
refresh();
setInterval(refresh, 3000);
</script></body></html>
"""


class Handler(BaseHTTPRequestHandler):
    server_version = f"{PRODUCT}/{VERSION}"

    def log_message(self, fmt, *args):  # quiet access log
        pass

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin:  # the TV app runs from file:// or a tizen origin
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else (json.dumps(body) if ctype == "application/json" else body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if not ctype.endswith("json") else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _authed(self):
        pw = CFG["password"]
        if not pw:
            return True
        h = self.headers.get("Authorization", "")
        if h.startswith("Basic "):
            try:
                _, _, given = base64.b64decode(h[6:]).decode().partition(":")
                if hmac.compare_digest(given.encode(), pw.encode()):
                    return True
            except (ValueError, UnicodeDecodeError):
                pass
        # The browser page gets a login prompt; API calls (FlexPlex) a plain 401.
        self.send_response(401)
        if not urlparse(self.path).path.startswith("/api/"):
            self.send_header("WWW-Authenticate", 'Basic realm="FlexPlex installer"')
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.end_headers()
        self.wfile.write(b'{"error": "password required"}')
        return False

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/health":
            return self._send(200, {"ok": True})
        if not self._authed():
            return
        if url.path in ("/", "/index.html"):
            return self._send(200, PAGE, "text/html")
        if url.path == "/api/status":
            reported = (parse_qs(url.query).get("installed") or [""])[0]
            if re.fullmatch(r"\d+(\.\d+){0,3}", reported or ""):
                if reported != STATE.data.get("seen_on_tv"):
                    STATE.update(seen_on_tv=reported, seen_at=now_iso())
            return self._send(200, STATE.public())
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        url = urlparse(self.path)
        if not self._authed():
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = {}
        if length:
            try:
                body = json.loads(self.rfile.read(min(length, 10000)) or b"{}")
            except ValueError:
                return self._send(400, {"error": "bad JSON"})
        if url.path == "/api/check":
            safe_check()
            return self._send(200, STATE.public())
        if url.path == "/api/install":
            version = body.get("version") if isinstance(body, dict) else None
            if version is not None and not re.fullmatch(r"\d+(\.\d+){0,3}", str(version)):
                return self._send(400, {"error": "bad version"})
            if not start_install(version):
                return self._send(409, {"error": "an install is already running"})
            return self._send(202, {"started": True})
        return self._send(404, {"error": "not found"})


def main():
    os.makedirs(CFG["data"], exist_ok=True)
    STATE.busy = False
    if not CFG["tv_ip"]:
        STATE.log("TV_IP isn't set: updates can be checked but not installed")
    threading.Thread(target=loop, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", CFG["port"]), Handler)
    STATE.log(f"FlexPlex installer listening on port {CFG['port']} (repo {CFG['repo']}, TV {CFG['tv_ip'] or '?'})")
    srv.serve_forever()


if __name__ == "__main__":
    main()
