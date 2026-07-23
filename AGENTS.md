# AGENTS.md — Lazy Coder (keycode)

> **Status:** APPROVED (user: «сделай», 2026-07-09; public-release plan 2026-07-19)
>
> Do not implement features not described here without updating this file.

---

## 1. Goal

**Problem:** Non-programmers who vibe-code keep retyping the same long prompts: evaluate, fix, test, backup, full plan→work→test chains. Programmers need a tougher variant of the same loop.

**For whom:** Vibe-coders (primary) + programmers (second bundled deck); public open-source Windows app via GitHub Releases.

**One-sentence goal:** Always-on-top transparent “tarot deck” of up to 8 prompt cards; one click/hotkey pastes the card text into selected chat windows (optionally Enter).

**Success criteria:**

1. Show/hide deck via on-screen eye button and global hotkey (default F9).
2. Click card or bound key → text goes to all checked targets; optional Enter.
3. Edit cards, change images, max 8 cards; switch decks; import/export file.
4. Two bundled decks: «Тарокод · Хобби» and «Тарокод · Продакшен»; switch in settings.
5. Evaluation uses a project quality score 0–10: &lt;7 = redo; 7–10 = acceptable; card «Доведи» loops until score 9–10.
6. **Public readiness:** clean Windows 10/11 install → within ~2 minutes user adds a target and successfully sends a card; every failure shows a clear next action in the UI.
7. **Phone remote (opt-in):** mobile web remote for Cursor — list **all open Cursor chats** from CDP (no need to add them in Keycode first), pick one active chat on the phone, read its loaded transcript live, send a deck card to that chat only. **Current access:** same Wi‑Fi (LAN): Keycode binds `0.0.0.0`, phone opens `http://{pc-lan-ip}:{port}/#token=…` with bearer secret. **Later:** Tailscale Serve for away-from-home. Not Funnel / not a cloud account.

**Out of scope (v1):**

- Cloud accounts / marketplace server / public Funnel
- Tailscale as the only/default access path (kept as a future mode; LAN Wi‑Fi is default for testing)
- Native mobile apps (web UI only)
- Reading or controlling non-Cursor IDE agents (Codex, Windsurf, Claude Code, etc. — later adapters)
- AI that auto-picks or generates cards (later; remote API may expose a `suggestions[]` hook later without shipping models/keys now)
- Deep Cursor/AI cloud APIs / SDK (local CDP DOM only)
- More than 8 cards per deck
- Per-target different text on the desktop strip (same text to all enabled targets); phone remote sends to the phone-selected Cursor target only
- Paid code signing in the very first public build (document SmartScreen; sign before broader distribution)
- Forcing Cursor scroll to load older history (remote shows loaded DOM messages + live updates)

---

## 2. Platform & Users

| Item | Decision |
|------|----------|
| Platform | Windows desktop (Electron) |
| Primary users | Single user local; decks shareable as files |
| Distribution | GitHub Releases (portable + NSIS); auto-update check with user confirmation |
| Authentication | No |
| Language (UI) | 10 locales: `en`, `ru`, `uk`, `de`, `es`, `fr`, `pt-BR`, `zh-CN`, `ja`, `pl`. Default follows OS (`uiLocale: "system"`); unknown OS locale → `en`. Change applies immediately to all windows. |
| Arcana names | Rider–Waite titles default English (`arcanaLocale: "en"`); Settings can switch to any UI locale or follow UI language (`"ui"`). |
| Bundled decks | Hobby + Production ship translated per UI locale under `data/locales/{locale}/`; switching UI language rewrites stock `lazy-v1` / `pro-v1` from that pack. User-created decks stay as authored. |

---

## 3. Screens & Navigation

### Screen map

```
[Deck strip at edge]
Deck strip --> [Targets window] (centered, separate — куда отправлять)
Deck strip --> [Settings window] (centered, separate)
Settings window --> [Deck editor + card editor]
Settings window --> [Phone remote: enable + LAN QR (+ Tailscale later)]
Settings window --> [Donate modal] (sticky coffee cup → purpose + pay links)
Deck panel --> [Edit card modal] (quick edit)
Targets / rail --> [Field pick overlay] or [Cursor chat list (CDP)]
Phone browser --> [Mobile remote UI] (same Wi-Fi → LAN IP)
First run --> [Short onboarding overlay on deck]
```

### Show / hide deck

**Purpose:** Toggle deck visibility without clutter.

**Controls:** Eye button (👁) on the deck strip; same via global hotkey (default **F9**, chosen in Settings). Hover near the docked edge also reveals the strip when edge-hover is on. No separate floating eye window.

### Screen: Deck panel

**Purpose:** Cards + quick target toggles + deck switch.

**Layout:** Transparent frameless always-on-top; only cards/toolbar/target rail opaque.

**Controls:**

| # | Control | Action |
|---|---------|--------|
| 1 | Hide (👁) | Hide deck panel |
| 2 | Targets (🎯) | Open targets window (remove / Enter); badge = count of enabled chats |
| 3 | Target side panel | Toggle fields; Все / Снять; `+ поле`; `+ чат` Cursor (список из CDP) |
| 4 | Cards (≤8) | Send card text to all **enabled** targets (queue) |
| 5 | Settings (⚙) | Open centered settings window |
| 6 | Quit (✕) | Exit or minimize to background |
| 7 | Deck select | Switch active deck from the strip |

Edge hover on/off — только в Settings (на полосе карт отдельной кнопки нет).

**Target drivers:**

- `cdp` — Cursor via local Chrome DevTools Protocol (no focus steal). One or more chats; multi-window Cursor = separate CDP targets if one window cannot switch chats.
- `uia-quiet` — UIA `ValuePattern` write without activating the window (simple apps only). Created by «+ поле» when «Не забирать фокус» is on.
- `win32-field` / `uia` — legacy focus + Ctrl+V paths; used only when setting «Не забирать фокус» is **off**.

**No-focus mode (default on):** never call `SetForegroundWindow` / SendInput into other apps. Game stays focused. Cursor SDK / Cloud API are **not** used. Cursor must be started with `--remote-debugging-port=9222` bound to `127.0.0.1`. Preferred: Settings → create the Keycode «Cursor background» shortcut once, then always open Cursor from that shortcut (one close/reopen after install). Launch button only if Cursor is closed / recovery. Keycode never force-kills Cursor.

### First-run onboarding

Short overlay (not a multi-step wizard): F9 → Settings → launch Cursor for background → + чат / + поле → enable chip → click card. Flag `firstRunDone` in settings.json.

### Screen: Targets (separate window)

**Purpose:** Add/remove field/chat targets, Enter-after-paste; everyday enable/disable is on the deck rail.

**Layout:** Centered modal window (~480×560), dark theme.

**Controls:**

| # | Control | Action |
|---|---------|--------|
| 1 | Target checkboxes | Enable/disable paste destination |
| 2 | + Поле / + чат Cursor | Field: quiet UIA (no-focus) or pick (if focus allowed). Cursor: pick chat from CDP list in Keycode UI |
| 3 | × on chip | Remove target |
| 4 | Все / Снять | Select all / deselect all |
| 5 | Enter | Toggle Enter after paste |
| 6 | Готово | Save and close |

**Flow (no-focus):** bind CDP chats from list → enable chips → click card → for each CDP target: select chat in DOM → insert text (+ Enter if on). No Alt+Tab.

### Screen: Settings (separate window)

**Purpose:** App options + full deck/card editing without overlapping the deck strip.

**Layout:** Centered modal window (~980×720), dark theme, two columns: general settings | decks & cards.

**Controls:**

| Area | Controls |
|------|----------|
| General | **UI language** (system / 10 locales), **arcana name language** (English default / follow UI / locale), dock side, edge hover, sizes, opacity, fonts, preview, pause, Enter, hotkey, **Не забирать фокус**, data folder, logs folder |
| Cursor фон (CDP) | Probe debug port; **install permanent Start Menu + Desktop shortcut** with CDP flags (preferred); launch Cursor with `--remote-debugging-port` only if Cursor closed; list chat count; optional cdpPort |
| Phone remote | Opt-in LAN server (`0.0.0.0`); show port + LAN IP URL; QR with secret in URL fragment; rotate secret; diagnose; Tailscale Serve UI marked “later” |
| Decks | Select/rename deck; new / export / import / delete; card list (≤8) |
| Card editor | Title, short description, full prompt, tarot image, hotkey F1–F8; save / delete |
| Updates | Check for updates (GitHub Releases); user confirms before install |
| Support | Sticky coffee-cup button (bottom-right, always visible). Opens centered modal: purpose switcher (`?` / coffee / beer / cats) with click-share stats (% by click count, only clicks older than 24h); pay via T-Bank collect, Lava.top, or crypto (copy address). Links local in config; no payment webhooks / no cloud |

### Screen: Phone remote (mobile browser)

**Purpose:** Control one Cursor chat from a phone while away from the PC keyboard.

**Layout:** Mobile-first single page — target picker, live transcript, free-text composer, card grid (≤8).

**Controls:**

| # | Control | Action |
|---|---------|--------|
| 1 | Chat select | Live list of all open Cursor chats (CDP); switch active chat on the phone (saving via «+ чат» on PC not required) |
| 2 | Transcript | Show messages already loaded in the **active** Cursor chat; update live (SSE); no forced scroll for older history |
| 3 | Free text | Type or dictate a message → Send → paste into the **active** phone-selected Cursor chat and always submit (Enter). Composer clears after a successful send (restores text if send fails). No prompt logging. |
| 4 | Mic (dictation) | Tap mic → on-device speech-to-text into the composer (Web Speech API). Sends as text via the same paste path — not raw audio into Cursor. May be blocked on plain LAN `http://` (not a secure context); keyboard dictation still works. HTTPS/Tailscale later unlocks browser mic more reliably. |
| 5 | Cards | Tap card → paste that card’s prompt into the **active** phone-selected Cursor chat and **always submit** (same as free text; desktop strip still follows Settings → Enter). If Cursor keeps the draft, Keycode retries Send once and reports failure clearly. |
| 6 | Status | Connection / Cursor working / task completed / CDP closed / chat missing / queue busy |

**Access (current):** Keycode binds `0.0.0.0` (reachable on the home LAN). Phone and PC on the same Wi‑Fi. Auth = Keycode bearer secret only (secret in URL `#token=…`, sent as header; never logged). Warn in UI: anyone on that Wi‑Fi with the link can use the remote. **Later:** Tailscale Serve mode (identity header + token). Funnel / open internet remain out of scope.

**Completion alert (current):** while the phone page is open, a confirmed Cursor transition from generating to idle plays a short local chime, vibrates when supported, and shows a visible completion status. No background push on LAN HTTP; the user can mute the chime on the phone.

**Done** saves general settings and closes the window. Deck window refreshes automatically.

### Screen: Decks (in settings window)

New / rename / delete deck; export / import JSON — same as before, now inside settings window.

### Screen: Edit card (in settings window + optional quick modal on deck)

---

## 4. Visual Style

| Item | Choice |
|------|--------|
| Theme | Dark mystical (tarot) |
| Cards | Image/symbol + title + short description + hotkey badge |
| Density | Comfortable; max 8 cards |
| Panel | Transparent chrome; cards with gold/violet accents |

---

## 5. Functions — Input / Output

| Function | Trigger | Input | Output |
|----------|---------|-------|--------|
| Toggle deck | 👁 on strip / F9 (or Settings hotkey) / edge hover | — | Panel shown or hidden |
| Paste card | Click card / F-key | Card text, checked targets | Text pasted (+ Enter if on); single queue |
| Phone list chats | Open remote / refresh | CDP probe + listChats | All open Cursor chats (ephemeral ids; not only saved Keycode targets) |
| Phone paste | Tap card on remote UI | Card id + phone-selected live chat | Text pasted and submitted to that CDP chat only; same queue |
| Phone free text | Type + Send on remote | Custom text + phone-selected live chat | Text pasted to that CDP chat only; same queue; text never logged; composer clears on success |
| Phone dictation | Mic on remote | On-device speech → text in composer | Same as free text after Send (or user edits first); raw audio not forwarded to Cursor |
| Phone read chat | Select chat on remote | Live chat id | Loaded transcript messages + live SSE updates |
| Phone task alert | Cursor generation changes `active → idle` | Selected Cursor target state | Foreground chime + vibration + visible «task completed» status |
| Edit card | Edit mode / context | Fields | Card updated in deck file |
| Add/remove card | + / delete | — | Deck size 1–8 |
| Add target | + поле / + чат | Field pick or CDP chat list | Saved target |
| Switch deck | Dropdown on strip / settings | Deck id | Cards reload |
| Import/export | Buttons | File | Deck JSON (validated; safe ids) |
| First run | First launch | — | Short onboarding overlay |
| Enable phone remote | Settings toggle | remoteEnabled | Localhost HTTP+SSE server start/stop |
| Support donate | Sticky coffee cup in Settings | purpose + pay method | Opens T-Bank / Lava / copies crypto; records local click (stats after 24h) |

**Paste example (CDP Cursor, no-focus):** Card «Оцени» while a game is focused → agent A + B via CDP → text appears in both chats; game stays foreground.

**Paste example (quiet field):** Notepad Edit with ValuePattern → set value without activating Notepad. Enter after paste only if UIA can submit safely; otherwise toast «текст вставлен без Enter».

**Errors:** No targets → toast; CDP port closed → prompt to launch Cursor for background; chat not found → skip + ask rebind; app cannot accept quiet write → skip («не принимает текст в фоне»); hotkey conflict → toast.

---

## 6. Data

| Entity | Contents |
|--------|----------|
| Deck | id, name, cards[] |
| Card | id, title, description, prompt, image (preset id or path), hotkey |
| Target | id, name, driver (`cdp`\|`uia-quiet`\|`uia`\|`win32-field`), enabled; cdp: `port`, `cdpTargetId`, `chatId`, `chatTitle`; quiet/win32/uia as before |
| Settings | uiLocale (`system` default), arcanaLocale (`en` default; or `ui` / locale code), preserveFocus (default true), autoEnter, pauseMs, cdpPort (9222), firstRunDone, remoteEnabled (default false), remotePort (17865), remoteToken (random, rotatable), remoteAccessMode (`lan` default; `tailscale` later), … |

**Bundled decks (seeded on first run; per-locale packs under `data/locales/{locale}/`):**

| id | name (RU example) | Tone |
|----|------|------|
| `lazy-v1` | Тарокод · Хобби | Side projects / learning; keep it simple |
| `pro-v1` | Тарокод · Продакшен | Work / production bar; stricter review |

**Score convention («балл оценки проекта» 0–10):** Below 7 → must redo. 7–10 acceptable to continue. Card «Доведи» does not stop until score is 9 or 10 (evaluate → fix → re-score loop).

**Storage:** `%APPDATA%/keycode-lazy-coder/keycode-data/` (settings.json, decks/*.json, donate-clicks.json). Writes are atomic (temp + rename) with one `.bak` backup.

**Import rules:** max file size 512 KB; safe deck/card ids (`[a-zA-Z0-9_-]{1,64}`); 1–8 cards; conflicting imported id → new id (never overwrite via `../`).

**Sensitive:** None required. Prompts local only. Diagnostic logs must not store prompt/chat text.

---

## 7. Technical Notes

| Item | Proposal |
|------|----------|
| Stack | Electron + vanilla HTML/CSS/JS |
| No-focus paste | CDP DOM inject for Cursor; UIA ValuePattern when possible; never steal focus when `preserveFocus` |
| Focus paste (opt-in) | Clipboard + Win32/UIA + Ctrl+V |
| Cursor background | Permanent Keycode shortcut (CDP flags) + `--remote-debugging-port=9222` + `--remote-debugging-address=127.0.0.1` + `electron/cdp-client.js`; never force-kill |
| Phone remote | `electron/remote-server.js` bind `0.0.0.0` (LAN); static `src/remote/`; bearer token; live CDP chat list + transcript + single-active-chat paste; Tailscale mode later |
| Windows list | PowerShell / native window enumeration |
| Security | contextIsolation, sandbox, CSP without `file:`, path-safe deck/tarot, IPC sender + payload whitelist; remote: LAN bind + bearer token (Tailscale identity when mode=`tailscale`), no prompt logging |
| Updates | electron-updater / GitHub Releases; never silent-update mid-paste |
| Tests | `node:test` for validation, import, paste routing, queue, remote auth/bind |
| Localization | Tiny `t(key)` + JSON packs (`src/i18n/ui`, `src/i18n/tarot`); main + all renderers; live apply on settings change |

---

## 8. Open Questions

- macOS later if needed
- Authenticode signing before wider distribution
- Adapters for other IDE agents after Cursor remote proves stable
- Optional AI card suggestions on the remote UI (no models in this release)
- Away-from-home access via Tailscale Serve (after LAN Wi‑Fi proves stable)
- Opt-in vibe-coding motivation: local task/commit counters without prompt text, streaks, medals, and pre-generated reward images (cats/themes). Design separately; no reminders, tracking, or runtime image generation in this release.

---

## 9. Approval

- [x] Goal confirmed (верно + сделай)
- [x] UI direction confirmed (transparent overlay, targets list, tarot default, max 8)
- [x] User: **сделай** / trust to implement well
- [x] Public-release plan accepted (2026-07-19): security → paste reliability → first-run UX → tests → GitHub distribution; i18n later
- [x] Phone remote plan accepted (2026-07-19): Cursor-only transcript + single-target paste
- [x] Phone remote LAN Wi‑Fi for home testing (2026-07-22); Tailscale Serve later

**Approved by:** user **Date:** 2026-07-09; public plan 2026-07-19; phone remote 2026-07-19; LAN Wi‑Fi 2026-07-22
