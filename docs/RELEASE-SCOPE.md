# v1.0.0 scope (stabilize)

## In v1.0.0 (product path)

- Deck strip / side table, up to 9 cards, F1–F8 (9th click-only), F9 show/hide
- Targets: CDP Cursor chats + quiet UIA fields (`preserveFocus` default on)
- Phone remote over LAN (bearer token, live chat list + paste)
- Bundled Hobby + Production decks, 10 UI locales
- GitHub Releases + unsigned Windows builds + SHA-256 sums
- Cursor SDK / API UI stays **hidden** (`KEYCODE_ENABLE_SDK=1` only for local experiments)

## Keep out of the first public tag until ready

- Unfinished or experimental SDK-only UI surfaces
- Temporary dumps: `tmp-remote-qr.png` and any file with `#token=` (gitignored via `tmp-*.png`)
- Empty donate URLs are fine (buttons stay disabled)

## Before tagging

1. `npm test` and `npm run check` green
2. Smoke [`docs/SMOKE.md`](SMOKE.md) on the portable exe
3. Confirm `tmp-remote-qr.png` is **not** staged
4. Release assets: portable + Setup + `SHA256SUMS.txt` (see [`RELEASE-NOTES-v1.0.0.md`](RELEASE-NOTES-v1.0.0.md))
