# v0.5.0 scope (first public preview)

## In v0.5.0 (product path)

- Deck strip / side table, up to 9 cards, F1–F8 (9th click-only), F9 show/hide
- Targets: CDP Cursor chats + quiet UIA fields (`preserveFocus` default on)
- Phone remote over LAN (bearer token, live chat list + paste); remote UI EN/RU
- Five bundled phase decks (validate → spec → hobby / production → release), 10 UI locales
- GitHub Releases + unsigned Windows builds + SHA-256 sums
- Cursor SDK / API UI stays **hidden** (`KEYCODE_ENABLE_SDK=1` only for local experiments)

## Keep out of this public tag until ready

- Unfinished or experimental SDK-only UI surfaces
- Temporary dumps: `tmp-*.js`, `tmp-remote-qr.png`, and any file with `#token=` (gitignored)
- Local GigaAM binaries/models under `gigastt-bin/` / `gigastt-models/` (downloaded into userData at runtime)
- Empty donate URLs are fine (buttons stay disabled)
- Stock deck drafts `*-v1.1.json` (not wired; ship `*-v1` only)

## Before tagging

1. `npm test` and `npm run check` green
2. Smoke [`docs/SMOKE.md`](SMOKE.md) on the portable exe
3. Confirm `tmp-*`, `gigastt-bin/`, `gigastt-models/` are **not** staged
4. Release assets: portable + Setup + `SHA256SUMS.txt` (see [`RELEASE-NOTES-v0.5.0.md`](RELEASE-NOTES-v0.5.0.md))
