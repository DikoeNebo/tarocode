# Security

## Supported versions

Security fixes target the latest GitHub Release of **TaroCode** (Prompt Tarot Lazy Code; repo `DikoeNebo/keycode`) on Windows.

## What to know before enabling features

- **Cursor CDP (`--remote-debugging-port`)** — anything on this PC that can reach `127.0.0.1:9222` can control Cursor. Use the TaroCode shortcut when you need background paste; quit Cursor with debugging when you do not.
- **Phone remote (LAN)** — binds to `0.0.0.0`. Anyone on the same Wi‑Fi who has the URL with the secret can list chats and paste. Do not share the QR/link. Prefer a private/home network. Internet / Funnel access is out of scope.
- **Logs** — TaroCode does not log card prompts or chat text. Do not paste secrets into Issues.

## Reporting a vulnerability

Open a [GitHub Security Advisory](https://github.com/DikoeNebo/keycode/security/advisories/new) if available, or email the maintainer via the address on the GitHub profile. Please do not open a public issue for unfixed remote/RCE-class bugs.
