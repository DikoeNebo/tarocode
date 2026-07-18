# AGENTS.md — Lazy Coder (keycode)

> **Status:** APPROVED (user: «сделай», 2026-07-09)
>
> Do not implement features not described here without updating this file.

---

## 1. Goal

**Problem:** Non-programmers who vibe-code keep retyping the same long prompts: evaluate, fix, test, backup, full plan→work→test chains. Programmers need a tougher variant of the same loop.

**For whom:** Vibe-coders (primary: author) + programmers (second bundled deck); later shareable product.

**One-sentence goal:** Always-on-top transparent “tarot deck” of up to 8 prompt cards; one click/hotkey pastes the card text into selected chat windows (optionally Enter).

**Success criteria:**

1. Show/hide deck via on-screen eye button and global hotkey.
2. Click card or bound key → text goes to all checked targets; optional Enter.
3. Edit cards, change images, max 8 cards; switch decks; import/export file.
4. Two bundled decks: «Тарокод · Хобби» and «Тарокод · Продакшен»; switch in settings.
5. Evaluation uses a project quality score 0–10: &lt;7 = redo; 7–10 = acceptable; card «Доведи» loops until score 9–10.

**Out of scope (v1):**

- Cloud, accounts, marketplace server
- Mobile
- Deep Cursor/AI APIs / SDK (paste into on-screen fields only; no cloud agent sessions)
- More than 8 cards per deck
- Per-target different text (same text to all targets)

---

## 2. Platform & Users

| Item | Decision |
|------|----------|
| Platform | Windows desktop (Electron) |
| Primary users | Single user local; decks shareable as files |
| Authentication | No |
| Language (UI) | Russian |

---

## 3. Screens & Navigation

### Screen map

```
[Deck strip at edge]
Deck strip --> [Targets window] (centered, separate — куда отправлять)
Deck strip --> [Settings window] (centered, separate)
Settings window --> [Deck editor + card editor]
Deck panel --> [Edit card modal] (quick edit in expanded mode)
Targets window --> [Crosshair pick overlay] (клик по окну чата)
```

### Screen: Eye (floating)

**Purpose:** Toggle deck visibility without clutter.

**Controls:** Eye button (click); same via global hotkey `Ctrl+Shift+L`.

### Screen: Deck panel

**Purpose:** Cards + quick target toggles + deck switch.

**Layout:** Transparent frameless always-on-top; only cards/toolbar/target rail opaque.

**Controls:**

| # | Control | Action |
|---|---------|--------|
| 1 | Hide (eye) | Hide deck panel |
| 2 | Targets (🎯) | Open targets window (remove / Enter); badge = count of enabled chats |
| 3 | Target side panel | Toggle fields; Все / Снять; `+ поле`; `+ чат Cursor` (список из CDP) |
| 4 | Cards (≤8) | Send card text to all **enabled** targets (queue) |
| 5 | Settings (⚙) | Open centered settings window |
| 6 | Quit (✕) | Exit or minimize to background |

Edge hover (всплывать у края) — только в Settings, не на полосе карт.

**Target drivers:**

- `cdp` — Cursor via local Chrome DevTools Protocol (no focus steal). One or more chats; multi-window Cursor = separate CDP targets if one window cannot switch chats.
- `uia-quiet` — UIA `ValuePattern` write without activating the window (simple apps only).
- `win32-field` / `uia` — legacy focus + Ctrl+V paths; used only when setting «Не забирать фокус» is **off**.

**No-focus mode (default on):** never call `SetForegroundWindow` / SendInput into other apps. Game stays focused. Cursor SDK / Cloud API are **not** used. Cursor must be started with `--remote-debugging-port=9222` (Settings → интеграция; Keycode never force-kills Cursor).

### Screen: Targets (separate window)

**Purpose:** Add/remove field/chat targets, Enter-after-paste; everyday enable/disable is on the deck rail.

**Layout:** Centered modal window (~480×560), dark theme.

**Controls:**

| # | Control | Action |
|---|---------|--------|
| 1 | Target checkboxes | Enable/disable paste destination |
| 2 | + Поле / + чат Cursor | Field: quiet UIA or pick (if focus allowed). Cursor: pick chat from CDP list in Keycode UI |
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
| General | Dock side, edge hover, sizes, opacity, fonts, preview, pause, Enter, hotkey, **Не забирать фокус**, data folder |
| Cursor фон (CDP) | Probe debug port; launch Cursor with `--remote-debugging-port` (only if Cursor closed); list chat count |
| Decks | Select/rename deck; new / export / import / delete; card list (≤8) |
| Card editor | Title, short description, full prompt, tarot image, hotkey F1–F8; save / delete |

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
| Toggle deck | Eye / Ctrl+Shift+L | — | Panel shown or hidden |
| Paste card | Click card / F-key | Card text, checked targets | Text pasted (+ Enter if on) |
| Edit card | Edit mode / context | Fields | Card updated in deck file |
| Add/remove card | + / delete | — | Deck size 1–8 |
| Add target | + target | Window pick | Saved target |
| Switch deck | Dropdown | Deck id | Cards reload |
| Import/export | Buttons | File | Deck JSON |

**Paste example (CDP Cursor, no-focus):** Card «Оцени» while a game is focused → agent A + B via CDP → text appears in both chats; game stays foreground.

**Paste example (quiet field):** Notepad Edit with ValuePattern → set value without activating Notepad.

**Errors:** No targets → toast; CDP port closed → prompt to launch Cursor for background; chat not found → skip; app cannot accept quiet write → skip («не принимает текст в фоне»).

---

## 6. Data

| Entity | Contents |
|--------|----------|
| Deck | id, name, cards[] |
| Card | id, title, description, prompt, image (preset id or path), hotkey |
| Target | id, name, driver (`cdp`\|`uia-quiet`\|`uia`\|`win32-field`), enabled; cdp: `port`, `cdpTargetId`, `chatId`, `chatTitle`; quiet/win32/uia as before |
| Settings | preserveFocus (default true), autoEnter, pauseMs, cdpPort (9222), … |

**Bundled decks (seeded on first run):**

| id | name | Tone |
|----|------|------|
| `lazy-v1` | Тарокод · Хобби | Side projects / learning; keep it simple |
| `pro-v1` | Тарокод · Продакшен | Work / production bar; stricter review |

**Score convention («балл оценки проекта» 0–10):** Below 7 → must redo. 7–10 acceptable to continue. Card «Доведи» does not stop until score is 9 or 10 (evaluate → fix → re-score loop).

**Storage:** `%APPDATA%/keycode-lazy-coder/keycode-data/` (settings.json, decks/*.json)

**Sensitive:** None required. Prompts local only.

---

## 7. Technical Notes

| Item | Proposal |
|------|----------|
| Stack | Electron + vanilla HTML/CSS/JS |
| No-focus paste | CDP DOM inject for Cursor; UIA ValuePattern when possible; never steal focus when `preserveFocus` |
| Focus paste (opt-in) | Clipboard + Win32/UIA + Ctrl+V |
| Cursor background | `--remote-debugging-port=9222` + `electron/cdp-client.js` |
| Windows list | PowerShell / native window enumeration |

---

## 8. Open Questions

- macOS later if needed

---

## 9. Approval

- [x] Goal confirmed (верно + сделай)
- [x] UI direction confirmed (transparent overlay, targets list, tarot default, max 8)
- [x] User: **сделай** / trust to implement well

**Approved by:** user **Date:** 2026-07-09
