# AGENTS.md — Lazy Coder (keycode)

> **Status:** APPROVED (user: «сделай», 2026-07-09)
>
> Do not implement features not described here without updating this file.

---

## 1. Goal

**Problem:** Non-programmers who vibe-code keep retyping the same long prompts: evaluate, fix, test, backup, full plan→work→test chains.

**For whom:** Vibe-coders (primary: author); later shareable product.

**One-sentence goal:** Always-on-top transparent “tarot deck” of up to 8 prompt cards; one click/hotkey pastes the card text into selected chat windows (optionally Enter).

**Success criteria:**

1. Show/hide deck via on-screen eye button and global hotkey.
2. Click card or bound key → text goes to all checked targets; optional Enter.
3. Edit cards, change images, max 8 cards; switch decks; import/export file.

**Out of scope (v1):**

- Cloud, accounts, marketplace server
- Mobile
- Deep Cursor/AI APIs (text paste only)
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

**Purpose:** Cards + targets + deck switch.

**Layout:** Transparent frameless always-on-top; only cards/toolbar opaque.

**Controls:**

| # | Control | Action |
|---|---------|--------|
| 1 | Hide (eye) | Hide deck panel |
| 2 | Targets (🎯) | Open targets window; badge = count of checked chats |
| 3 | Cards (≤8) | Paste card text to all checked targets |
| 4 | Settings (⚙) | Open centered settings window |
| 5 | Quit (✕) | Exit or minimize to background |

Edge hover (всплывать у края) — только в Settings, не на полосе карт.

### Screen: Targets (separate window)

**Purpose:** Choose which chat windows receive card text (multi-target paste).

**Layout:** Centered modal window (~480×560), dark theme.

**Controls:**

| # | Control | Action |
|---|---------|--------|
| 1 | Target checkboxes | Enable/disable paste destination |
| 2 | ⊕ Прицел | Fullscreen crosshair — click a chat window to add |
| 3 | × on chip | Remove target |
| 4 | Все / Снять | Select all / deselect all |
| 5 | Enter | Toggle Enter after paste |
| 6 | Готово | Save and close |

**Flow:** Open via 🎯 on deck strip → check desired chats → click card → text goes to all checked targets.

### Screen: Settings (separate window)

**Purpose:** App options + full deck/card editing without overlapping the deck strip.

**Layout:** Centered modal window (~980×720), dark theme, two columns: general settings | decks & cards.

**Controls:**

| Area | Controls |
|------|----------|
| General | Dock side (стрелки), edge hover, opacity, fonts, preview toggle, pause, Enter, hotkey, data folder |
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

**Paste example:** Card «Оцени» → targets Cursor + Chrome → both get full prompt, then Enter if enabled.

**Errors:** No targets checked → toast «Выберите цели»; window not found → skip + toast.

---

## 6. Data

| Entity | Contents |
|--------|----------|
| Deck | id, name, cards[] |
| Card | id, title, description, prompt, image (preset id or path), hotkey |
| Target | id, name, match (window title substring), enabled |
| Settings | autoEnter, pauseMs, showHotkey |

**Storage:** `%APPDATA%/keycode/` (settings.json, decks/*.json)

**Sensitive:** None required. Prompts local only.

---

## 7. Technical Notes

| Item | Proposal |
|------|----------|
| Stack | Electron + vanilla HTML/CSS/JS |
| Paste | Clipboard + Win32 focus + Ctrl+V (+ Enter) |
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
