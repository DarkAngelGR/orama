# Real TV pass (about 15 minutes)

Samsung TV, Tizen 6.5 or newer (2022 models on). Plex or Jellyfin on the LAN, and Watchlist Sync on the same machine as Plex if you are checking requests and error reports. No `sdb` session is required beyond what `scripts/deploy.sh` starts.

## Install

1. On the TV: Apps, type `12345`, Developer mode on, IP of this computer, restart the TV.
2. On the computer: `./scripts/setup.sh`, then `./scripts/deploy.sh`.
3. Orama opens. Sign in (Plex code, or Down and a Jellyfin address).

A dev build is only needed for the log section below: put `DEV_HOST` in `.env` (see `.env.example`), run `node tools/devserver.mjs`, then `./scripts/deploy.sh --dev`.

## Playback (Plex, then Jellyfin)

Sign out in Settings and repeat the two plays on the other server.

1. Play a file the TV can decode (MKV or MP4, H.264 or HEVC, AAC or AC3, no image subtitles). Quality **Original**. The info bar (Up) says **Direct Play**.
2. Play again at **1080p · 8 Mbps**, or a file whose only audio is DTS with Settings › Audio formats left on Standard. The bar says **Transcoding** or **Direct Stream**, and the picture still moves.
3. Settings › Force direct play on, then play something the TV cannot decode. The screen says the TV could not play it directly and does not pretend it is playing. Turn Force direct play off again.

## Seek and subtitles

1. While playing, Left / Right steps about 10 seconds. Hold Right: the jump grows (30s, then 60s, then 3 minutes) and stops a few seconds before the end. Rewind and fast-forward start at 30 seconds and grow the same way.
2. Pause on a thumbnail if the server has preview thumbnails. The picture matches the time.
3. Down, turn on an embedded text subtitle, then an external `.srt` or `.ass` if the file has one. Lines show. CH Up or CH Down (or Green) turns them off and back on. Image subtitles (PGS) do not claim to work with Direct Play; the bar says they need a convert.

## Keys that must not repeat

From `app/js/input.js`: arrows, rewind, fast-forward, and channel keys repeat while held. Back, OK, and Play do not.

1. Hold Back on Home. It leaves the current screen once. It does not walk out of the app.
2. Hold OK on a poster. It opens once (or the hold-menu on a Continue Watching tile), not a stack of screens.
3. Hold Play. Playback starts or pauses once.
4. Let go, then press the same key again. The second press counts.
5. If a key seems stuck, wait under a second. A lost release clears itself.

## Switch profile or server while Home is loading

1. Settings › Who's watching at start › Ask, then restart, or open Settings and switch server while Home is still spinning.
2. The rows that land belong to the profile and server you ended on. No mix of the previous person's Continue Watching, and no error from the request you abandoned.

## Request a missing title

Needs Watchlist Sync in Settings › Downloads (watchlist-sync), not Off.

1. Home › Worth requesting, or Search for a movie you do not have, open it, Request.
2. The note says it was requested (or that Sonarr/Radarr already had it). The Requests row shows it.
3. When the file is actually on the server, that title becomes playable from the row. Use a short item that is already imported if you do not want to wait out a download. Play it.

## Auto-fetch

1. Settings › Auto-fetch movies › On. This uses the household limit configured in Watchlist Sync.
2. Finish a movie (or skip to the end).
3. Home or the Requests row shows a new movie request for this viewer, and only within that limit. Turn Auto-fetch off when you are done if this TV should not keep requesting.

## Errors in Watchlist Sync

The TV posts to `POST /api/tv/log` only when a Watchlist Sync address is set. The body is `level`, `message` (no token, no password, no `user:pass@` URL), `where` (the screen name), `version`, and `device`. The companion answers 204. An older companion answers 404 and the TV stays quiet.

1. With the companion configured, turn Force direct play on and play a file the TV cannot decode, so the player shows the failure.
2. In Watchlist Sync, the TV log shows that error: level `error`, where `player`, this app's version, and the message with no Plex token and no Watchlist Sync password.
3. Pull the network or stop the companion and trigger another failure. Orama still shows the on-screen error and does not add a second error about the report itself.

## Collecting logs

Dev build only. `node tools/devserver.mjs` prints lines and appends them to `build/tv.log`. The TV will only talk to it when `.env` has `DEV_HOST` and the app was installed with `./scripts/deploy.sh --dev`. Commands need the secret in `build/dev-secret`.

```sh
node tools/devserver.mjs
tools/tvsend.sh keys=down,right,enter
tools/tveval.sh 'document.title'
```

`tvsend.sh` queues key presses or an `eval=` snippet. `tveval.sh` runs one snippet and prints the `eval →` line from `build/tv.log` (it waits about 30 seconds). A release build does not send this log. Error reports to Watchlist Sync are separate and work on a release build.
