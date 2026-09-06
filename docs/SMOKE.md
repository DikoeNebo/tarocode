# Smoke checklist (Windows 10/11)

Run before each public release.

## Clean install

1. Fresh user profile or temp `%APPDATA%` wipe for `keycode-lazy-coder`.
2. Start from built `Keycode-*-portable.exe` (not `npm start`).
3. Expect: five phase decks (validate → spec → hobby / production → release), tarot images, first-run overlay.
4. Dismiss or Skip onboarding → overlay does not return after restart.

## Core UX

- [ ] F9 show/hide; 👁 on strip hides deck
- [ ] Deck pager on strip cycles all five stock decks
- [ ] Destination bar: presets / solo chat chips; 💬 opens Chats window
- [ ] Card click + F1–F8 paste (toast result)
- [ ] Esc closes card modal / quit dialog / onboarding
- [ ] DPI 100% / 125% / 150%: strip readable, cards usable

## Cursor (no-focus)

1. ◎ or Settings → Launch Cursor with CDP (Cursor must be closed first), or install the permanent Keycode shortcut.
2. Probe connection → ok, chats > 0.
3. Chats → + chat → pick a chat → select on destination bar → send an evaluate card.
4. Game/other app stays focused.
5. Close Cursor → paste shows clear “launch with CDP” next-step message.
6. Rebind if chat/window id changes.

## Quiet field

1. Keep «Не забирать фокус» / preserve focus on.
2. Open Notepad → Chats → + поле → click Edit.
3. Send a card → text appears without activating Notepad.
4. With Enter on: toast warns text inserted without Enter (if applicable).

## Import / data safety

- [ ] Import valid deck JSON → works
- [ ] Import with `"id":"../settings"` → rejected or remapped; settings intact
- [ ] Corrupt/huge JSON → error toast, no crash
- [ ] Settings persist after kill/restart

## Quit / background

- [ ] ✕ → свернуть в фон: hotkeys still work; tray/taskbar awareness
- [ ] ✕ → выйти: process ends; no leftover PowerShell/UIA helper

## Phone remote (optional, same Wi‑Fi)

1. Settings → Пульт с телефона → enable; note LAN IP + port (default 17865).
2. PC + phone on the **same Wi‑Fi**.
3. Open QR / `http://{lan-ip}:{port}/#token=…` on phone.
4. Chat list shows **all open Cursor chats** (live CDP), not only those saved in Keycode.
5. Switch chats on the phone → transcript updates; tap a card → text goes **only** to the active chat.
6. If phone cannot connect → Windows Firewall private network for Keycode/port.
7. Disable remote → port closes; old links stop after «New secret».
8. Remote UI strings: EN or RU (other desktop locales fall back to EN on the phone).

Negative checks:

- [ ] API without token → 401
- [ ] Unknown target id → error, no paste
- [ ] (Later) Tailscale mode without identity → 401

## Updates

- [ ] Settings → Проверить обновления (shows status; no silent install mid-paste)
- [ ] Release notes + SHA-256 published with GitHub Release
