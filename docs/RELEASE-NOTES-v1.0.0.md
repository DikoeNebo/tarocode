# Keycode v1.0.0

First public open-source release (MIT).

## Downloads

- `Keycode-1.0.0-portable.exe` — run without install
- `Keycode-Setup-1.0.0.exe` — NSIS installer
- `SHA256SUMS.txt` — verify before running

### SHA-256 (this build machine)

```
6f2fedee9be22fd5bb3fa02c81f050ac545e6cfc7239ee70fb2c80c4828dd416  Keycode-1.0.0-portable.exe
e4f9b2242b904282470a05adef7f36da7adec927bcfd7be13a6d05065b040879  Keycode-Setup-1.0.0.exe
```

Re-run `powershell -File scripts/release-checksums.ps1` after every rebuild before uploading.

## Highlights

- Always-on-top prompt deck (up to 9 cards) for Windows
- Paste into Cursor chats without stealing focus (local CDP)
- Optional phone remote on the same Wi‑Fi
- Hobby + Production bundled decks; UI in 10 languages

## Honest limits

- Builds are **not** Authenticode-signed — Windows SmartScreen may warn (“Unknown publisher”). Compare SHA-256 with `SHA256SUMS.txt`.
- Phone remote is **LAN only** (same Wi‑Fi). Anyone with the QR/secret link on that network can use it.
- Cursor must be started with Keycode’s debug shortcut for background paste.
- No cloud accounts, no Tailscale mode in this release.

## Verify (PowerShell)

```powershell
Get-FileHash .\Keycode-1.0.0-portable.exe -Algorithm SHA256
```

## RU

Первый публичный MIT-релиз: колода промптов, вставка в Cursor без перехвата фокуса, опциональный пульт по Wi‑Fi. Сборки без цифровой подписи — сверяйте SHA-256. Пульт только в домашней сети.
