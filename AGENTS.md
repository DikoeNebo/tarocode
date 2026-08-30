# AGENTS.md — Lazy Coder (keycode)

> **Status:** APPROVED (user: «сделай», 2026-07-09; public-release plan 2026-07-19)
>
> Do not implement features not described here without updating this file.

---

## 1. Goal

**Problem:** Non-programmers who vibe-code keep retyping the same long prompts: evaluate, fix, test, backup, full plan→work→test chains. Programmers need a tougher variant of the same loop.

**For whom:** Vibe-coders (primary) + programmers (second bundled deck); public open-source Windows app via GitHub Releases.

**One-sentence goal:** Always-on-top transparent “tarot deck” of up to 9 prompt cards; one click (or F1–F8 for hotkeyed cards) pastes the card text into selected chat windows (optionally Enter).

**Success criteria:**

1. Show/hide deck via on-screen eye button and global hotkey (default F9).
2. Click card or bound key → text goes to all checked targets; optional Enter.
3. Edit cards, change images, max 9 cards (F1–F8 hotkeys; 9th card click-only); switch decks; import/export file.
4. Five bundled decks in four phases: Validation → Specification → Work (Hobby + Production) → Release; switch in settings or the deck pager.
5. Evaluation uses a project quality score 0–10: &lt;7 = redo; 7–10 = acceptable; card «Доведи» loops until score 9–10. Score cards end with `KEYCODE_SCORE: N`. Gate cards may also end with `KEYCODE_GATE: PASS|FAIL` and `KEYCODE_NEXT: deck-id/card-id`. Hints never block paste.
6. **Public readiness:** clean Windows 10/11 install → within ~2 minutes user adds a target and successfully sends a card; every failure shows a clear next action in the UI.
7. **Phone remote (opt-in):** mobile web remote for Cursor — list **all open Cursor chats** from CDP (no need to add them in Keycode first), pick one active chat on the phone, read its loaded transcript live, send a deck card to that chat only. **Current access:** same Wi‑Fi (LAN): Keycode binds `0.0.0.0`, phone opens `http://{pc-lan-ip}:{port}/#token=…` with bearer secret. **Later:** Tailscale Serve for away-from-home. Not Funnel / not a cloud account.
8. **Next-card hints (rules, not AI):** for the selected solo Cursor chat (desktop strip + phone), parse last pasted card + `KEYCODE_SCORE: N` / `KEYCODE_GATE` / `KEYCODE_NEXT`; highlight up to 3 cards in the active deck (1 bright primary + up to 2 dimmer secondary). Cross-deck NEXT is a clickable hint only (no auto-switch, no lock). Frozen while Cursor is generating.

**Out of scope (v1):**

- Cloud accounts / marketplace server / public Funnel
- Tailscale as the only/default access path (kept as a future mode; LAN Wi‑Fi is default for testing)
- Native mobile apps (web UI only)
- Reading or controlling non-Cursor IDE agents (Codex, Windsurf, Claude Code, etc. — later adapters)
- AI that auto-picks or generates cards (later; may become a dedicated “AI chooses” card/skill on top of the existing `suggestions[]` / `KEYCODE_SCORE` rules)
- Shipping **only** Cursor SDK as the sole Cursor path (CDP is the product path; SDK code is kept shelved for a future finish)
- Deep Cursor cloud APIs as the default remote path (local CDP DOM)
- More than 9 cards per deck
- Per-target different text on the desktop strip (one card text per paste; broadcast sends that same text to the resolved set); phone remote sends to the phone-selected Cursor target only
- Paid code signing in the very first public build (document SmartScreen; sign before broader distribution)
- Forcing Cursor scroll to load older history (remote shows loaded DOM messages + live updates)
- Next-card hints in broadcast mode or with no selected chat

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
| Bundled decks | Five stock decks ship translated per UI locale under `data/locales/{locale}/`; switching UI language rewrites `validate-v1`, `spec-v1`, `lazy-v1`, `pro-v1`, `release-v1`. User-created decks stay as authored. Pager order is phase order, then user decks by name. |

---

## 3. Screens & Navigation

### Screen map

```
[Deck strip at edge]
Deck strip --> [Chats window] (standard Windows window — Explorer chrome)
Deck strip --> [Settings window] (centered, separate)
Settings window --> [Deck editor + card editor]
Settings window --> [Phone remote: enable + LAN QR (+ Tailscale later)]
Settings window --> [Donate modal] (sticky coffee cup → purpose + pay links)
Deck panel --> [Edit card modal] (quick edit)
Chats window --> [Field pick overlay] or [Cursor chat list (CDP)]
Phone browser --> [Mobile remote UI] (same Wi-Fi → LAN IP)
First run --> [Short onboarding overlay on deck]
```

### Show / hide deck

**Purpose:** Toggle deck visibility without clutter.

**Controls:** Eye button (👁) on the deck strip; same via global hotkey (default **F9**, chosen in Settings). Hover near the docked edge also reveals the strip when edge-hover is on. No separate floating eye window.

### Screen: Deck panel

**Purpose:** Cards + deck switch; Chats open as a separate Windows window.

**Layout:** Transparent frameless always-on-top; only interactive chrome is opaque. **Side docks (`right` / `left`):** default **tarot table** — grid **3 columns × 4 rows** flush to the edge (up to 9 cards; incomplete rows pack toward the screen edge so empty cells sit inward); space above and below is click-through. Settings can switch to classic **strip**. **Top / bottom docks:** linear strip along that edge (unchanged).

**Side table:** All cards visible at once in the grid. Click any card → paste. F1–F8 paste the hotkeyed card; a 9th card (no hotkey) is click-only. Stack flush to the edge: **controls on top** (deck pager `‹ name ›`, destination bar, Chats, Settings, Hide, Quit), **card grid below**. Empty space above/below the stack is click-through.

**Destination bar (under deck pager):** Compact row of up to 4 named **presets** (broadcast sets) and chips for saved chats/fields. Click a preset → `pasteMode=broadcast` (card goes to that set). Click a chat chip → `pasteMode=solo` (card goes only there, like phone). Hidden when there are no saved targets.

**Chat transcript (under destination bar):** Compact live pane of messages already loaded in the selected Cursor chat (CDP), same idea as the phone remote. Toggle open/closed with the ▴/▾ button on the destination bar (cards shift up when closed — no empty gap). Drag the bottom edge to resize height (saved). Hidden when there are no saved targets. Hint text in broadcast mode; live messages in solo for CDP chats. No forced scroll for older history; updates while the deck is visible and the pane is open. Desktop has no free-text composer here — cards still paste.

**Controls:**

| # | Control | Action |
|---|---------|--------|
| 1 | Hide (👁) | Hide deck panel |
| 2 | Settings (⚙) | Open centered settings window |
| 3 | CDP (◎) | If CDP is closed: centered dialog — close Cursor yourself, then big button «Launch Cursor with CDP». Does not kill Cursor. |
| 4 | Chats (💬) | Open the Chats window — standard Windows frame (move / resize / minimize / maximize / close); badge = paste destination count (preset/enabled in broadcast, `1` in solo) |
| 5 | Cards (≤9) | Side table / strip / top-bottom: click card. Paste to **resolved destinations** (active preset, or enabled targets, or solo chat). In solo CDP mode, up to 3 cards may glow (next-step hints) |
| 6 | Quit (✕) | Exit or minimize to background |
| 7 | Deck pager (‹ name ›) | Cycle active deck (wraps; Settings still has full select) |
| 8 | Destination bar | Switch broadcast preset or solo active chat |
| 9 | Chat transcript | Read-only live messages; ▴/▾ toggle; drag bottom edge to resize |
| 10 | Next-card glow | Rule-based highlight from solo transcript + `KEYCODE_SCORE` (1 primary + ≤2 secondary); clears in broadcast / non-CDP |

Edge hover on/off — только в Settings (на полосе карт отдельной кнопки нет).

**Target drivers:**

- `cdp` — Cursor via local Chrome DevTools Protocol (no focus steal). One or more chats; multi-window Cursor = separate CDP targets if one window cannot switch chats.
- `uia-quiet` — UIA `ValuePattern` write without activating the window (simple apps only). Created by «+ поле» when «Не забирать фокус» is on.
- `win32-field` / `uia` — legacy focus + Ctrl+V paths; used only when setting «Не забирать фокус» is **off**.

**No-focus mode (default on):** never call `SetForegroundWindow` / SendInput into other apps. Game stays focused. **Cursor path (product):** paste into open IDE chats via local CDP. Cursor must be started with `--remote-debugging-port=9222` bound to `127.0.0.1` (Keycode shortcut preferred). Keycode never kills Cursor. If Cursor is already open without CDP, a centered deck dialog asks the user to close it, then a big button launches Cursor with CDP flags. **Cursor API / SDK:** code kept (`electron/cursor-sdk-client.js`, settings keys, remote branches) but **hidden from UI**; re-enable later with env `KEYCODE_ENABLE_SDK=1` when finishing that path.

### First-run onboarding

Short overlay (not a multi-step wizard): F9 → if CDP is closed, centered dialog: close Cursor, then big button «Launch Cursor with CDP» → 💬 Chats → + чат / + поле → enable → click card. Flag `firstRunDone` in settings.json. On each app start, if CDP is closed, the same centered dialog is offered.

### Screen: Chats (separate Windows window)

**Purpose:** Add/remove/enable field and Cursor chat destinations, save/apply named destination **presets** (max 4), Enter-after-paste, diagnostics. Full destination management lives here; the deck strip only switches the active preset or solo chat.

**Layout:** Separate standard Windows window like Explorer: system title bar with minimize / maximize / close, movable and resizable. Normal bounds and maximized state are restored on the next open; off-screen bounds reset to a visible display. Initial size ~480×560.

**Controls:**

| # | Control | Action |
|---|---------|--------|
| 1 | + чат Cursor | Pick chat from CDP list (project tree). Each project row has **+** → create a new Cursor chat in that project via CDP, save it as a destination, then show «What task shall we solve?» (type or dictate) → Enter/Send pastes and submits into that new chat only |
| 2 | + поле | Quiet UIA field (no-focus) or pick (if focus allowed) |
| 3 | CDP / Перезапустить с CDP? | Launch Cursor with CDP, or restart if open without debug port |
| 4 | Checkbox row | Enable/disable destination (live set when no preset is active) |
| 5 | × | Remove destination |
| 6 | Все / Снять | Select all / deselect all |
| 7 | Enter | Toggle Enter after paste |
| 8 | Диагностика | Check Cursor/CDP connection |
| 9 | Наборы | Save current checkboxes as a named preset (≤4); apply (broadcast + sync checkboxes); rename; delete |
| 10 | Window chrome | Minimize / maximize / close (OS), resize by edges |

**Flow (no-focus):** bind CDP chats from hierarchical project → chat list (Keycode expands Cursor sidebar sections + “See more” on refresh) → enable or pick a preset / solo chat on the strip → click card → for each resolved CDP target: select chat in DOM → insert text (+ Enter if on). No Alt+Tab.

**New chat from pick:** in the project tree, **+** on a project creates a new Cursor agent/chat in that section via CDP DOM click, saves it to destinations, then opens a task prompt (text + Web Speech dictation). Enter/Send submits into that chat only (same paste queue as phone free text).

### Screen: Settings (separate window)

**Purpose:** App options + full deck/card editing without overlapping the deck strip.

**Layout:** Centered window (~980×720), dark theme. Left navigation opens one section at a time: General, Appearance, Cursor, Phone, Decks. The active section uses the remaining width, so advanced integrations and the deck editor are not mixed with everyday settings.

**Controls:**

| Area | Controls |
|------|----------|
| General | **UI language** (system / 10 locales), **arcana name language** (English default / follow UI / locale), pause, Enter, hotkey, **Не забирать фокус**, data folder, logs folder, check for updates |
| Appearance | Dock side, **side layout** (table 3×4 default / classic strip), edge hover, sizes, opacity, fonts, card preview |
| Cursor (CDP) | Optional cdpPort; probe debug port; **install permanent Start Menu + Desktop shortcut** with CDP flags (preferred); launch Cursor with CDP after the user closes it (Keycode does not kill Cursor); diagnostics; same dialog on deck (◎), Chats, and chat-pick when CDP is closed |
| Cursor API / SDK (shelved) | Implemented but **not shown** in Settings; future finish: API key, sdkProjects (folder + chats), phone `Project · Chat`. Dev re-enable: `KEYCODE_ENABLE_SDK=1` |
| Phone | Opt-in LAN server (`0.0.0.0`); show port + LAN IP URL; QR with secret in URL fragment; rotate secret; diagnose; Tailscale Serve UI marked “later” |
| Decks | Select/rename deck; new / export / import / delete; card list (≤9); card editor (title, description, prompt, tarot image, hotkey F1–F8 or none for click-only) |
| Support | Sticky coffee-cup button (bottom-right, always visible). Opens centered modal: purpose switcher (`?` / coffee / beer / cats) with click-share stats (% by click count, only clicks older than 24h); pay via T-Bank collect, Lava.top, or crypto (copy address). Links local in config; no payment webhooks / no cloud |

### Screen: Phone remote (mobile browser)

**Purpose:** Control one Cursor chat from a phone while away from the PC keyboard.

**Layout:** Mobile-first single page — target picker, live transcript, free-text composer, card grid (≤9).

**Controls:**

| # | Control | Action |
|---|---------|--------|
| 1 | Chat select | Live list of open Cursor chats (CDP) |
| 2 | Transcript | Messages loaded in IDE chat; update live (SSE); no forced scroll for older history |
| 3 | Free text | Type or dictate → Send/Build (label mirrors Cursor) into the active phone-selected chat/agent and always submit. Composer clears after a successful send. No prompt logging. |
| 3b | Mode / model | Composer toolbar: Agent/Plan (and Ask/Edit if exposed by CDP). Model dropdown when Cursor exposes models. |
| 3c | Plan questions | When Cursor shows clarifying choices, phone shows option chips; tap answers via CDP click. |
| 4 | Mic (dictation) | Tap mic → on-device speech-to-text into the composer (Web Speech API). Sends as text via the same paste path — not raw audio into Cursor. May be blocked on plain LAN `http://` (not a secure context); keyboard dictation still works. HTTPS/Tailscale later unlocks browser mic more reliably. |
| 5 | Cards | Tap card → paste that card’s prompt into the **active** phone-selected chat/agent and **always submit** (same as free text; desktop strip still follows Settings → Enter). Primary CTA may read Send or Build. If Cursor keeps the draft (CDP), Keycode retries once and reports failure clearly. Same next-card glow as the desktop strip (`suggestions[]` with `rank` 1\|2 from chat SSE). |
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
| Density | Comfortable; max 9 cards |
| Panel | Transparent chrome; cards with gold/violet accents |

---

## 5. Functions — Input / Output

| Function | Trigger | Input | Output |
|----------|---------|-------|--------|
| Toggle deck | 👁 on strip / F9 (or Settings hotkey) / edge hover | — | Panel shown or hidden |
| Paste card | Click card / F-key | Card text; destinations from `pasteMode` (broadcast preset or enabled targets, or solo `activeTargetId`) | Text pasted (+ Enter if on); single queue |
| Switch paste dest | Destination bar / Chats presets | preset id or target id | `pasteMode` + active preset/target; badge updates |
| Deck chat transcript | Solo chat selected on strip | Saved CDP target id | Loaded DOM messages + live poll while deck visible |
| Next-card hints | Solo CDP chat (deck or phone) | Transcript + active deck prompts | Up to 3 cards highlighted (`rank` 1 primary, 2 secondary); frozen while generating |
| Phone list chats | Open remote / refresh | CDP probe + listChats | All open Cursor chats (ephemeral ids; not only saved Keycode targets) |
| Phone paste | Tap card on remote UI | Card id + phone-selected live chat | Text pasted and submitted to that CDP chat only; same queue |
| Phone free text | Type + Send on remote | Custom text + phone-selected live chat | Text pasted to that CDP chat only; same queue; text never logged; composer clears on success |
| Phone dictation | Mic on remote | On-device speech → text in composer | Same as free text after Send (or user edits first); raw audio not forwarded to Cursor |
| Phone read chat | Select chat on remote | Live chat id | Loaded transcript messages + live SSE updates |
| Phone task alert | Cursor generation changes `active → idle` | Selected Cursor target state | Foreground chime + vibration + visible «task completed» status |
| Edit card | Edit mode / context | Fields | Card updated in deck file |
| Add/remove card | + / delete | — | Deck size 1–9 |
| Add target | + поле / + чат | Field pick or CDP chat list | Saved target |
| New chat in project | + on project in chat-pick | Project name + Cursor window | New CDP chat saved; task modal (text/dictate) → paste+submit |
| Switch deck | Pager on strip / remote; select in settings | Deck id | Cards reload (remote SSE `deck` when active deck changes) |
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
| Target preset | id, name, targetIds[] (max 4 presets; snapshot of destinations for broadcast) |
| Settings | … **sideCardLayout** (`table` default \| `strip`; legacy `wheel` → `table`), **pasteMode** (`broadcast` default \| `solo`), **activePresetId**, **activeTargetId**, **targetPresets**, **deckTranscriptOpen**, **deckTranscriptHeightPx**, **cursorBackend** forced `cdp` in product (sdk settings keys kept for future), cursorApiKey / sdkProjects / activeSdkProjectId (shelved), … |

**Bundled decks (seeded on first run; per-locale packs under `data/locales/{locale}/`):**

| id | name (RU example) | Phase |
|----|------|--------|
| `validate-v1` | 01 Валидация | Evidence before code. New installs start here. |
| `spec-v1` | 02 Спецификация | Brief, scope, UX, contracts, architecture, Cursor rules |
| `lazy-v1` | 03 Работа · Хобби | Side projects / learning; keep it simple |
| `pro-v1` | 03 Работа · Продакшен | Work / production bar; stricter review |
| `release-v1` | 04 Релиз | Quality, security, package, docs, gate, launch (no auto-publish) |

Each stock deck ships **9 cards** (F1–F8 + click-only **`summary` / Recap**). Work decks keep the existing loop (plan → evaluate/review → work → test → fix → polish → backup/`improve`/fullcycle). Summary: short status — no code; no `KEYCODE_SCORE`.

**Score convention («балл оценки проекта» 0–10):** Below 7 → must redo. 7–10 acceptable to continue. Card «Доведи» does not stop until score is 9 or 10. Stock score cards must end with a final line `KEYCODE_SCORE: N` (N integer 0–10). Gate cards (`evidence-review`, `validation-cycle`, `readiness`, `release-gate`, and work `fullcycle` when scope is done) may add:

```
KEYCODE_GATE: PASS
KEYCODE_NEXT: spec-v1/brief
```

or `FAIL` plus a known stock `deck-id/card-id`. Unknown NEXT ids are ignored. `FAIL` only highlights a fix card — never disables paste, hotkeys, or deck switch.

**Safe execution (stock prompts):** do not invent market evidence, respondents, or APIs; do not apply secrets/migrations/production deploys without explicit user confirmation; do not create legacy `.cursorrules` when `.cursor/rules/*.mdc` or `AGENTS.md` already exist. Release `launch` shows plan + rollback first.

**Storage:** `%APPDATA%/keycode-lazy-coder/keycode-data/` (settings.json, decks/*.json, donate-clicks.json). Writes are atomic (temp + rename) with one `.bak` backup.

**Import rules:** max file size 512 KB; safe deck/card ids (`[a-zA-Z0-9_-]{1,64}`); 1–9 cards; conflicting imported id → new id (never overwrite via `../`).

**Sensitive:** None required for CDP. (Shelved SDK mode would store local `cursorApiKey` in settings.json only; never log key or prompt/chat text.)

---

## 7. Technical Notes

| Item | Proposal |
|------|----------|
| Stack | Electron + vanilla HTML/CSS/JS |
| No-focus paste | CDP DOM inject for Cursor; UIA ValuePattern when possible; never steal focus when `preserveFocus` |
| Focus paste (opt-in) | Clipboard + Win32/UIA + Ctrl+V |
| Cursor background | Permanent Keycode shortcut (CDP flags) + `--remote-debugging-port=9222` + `--remote-debugging-address=127.0.0.1` + `electron/cdp-client.js`; user closes Cursor, then launches it with CDP — Keycode does not kill Cursor |
| Cursor SDK (shelved, future) | `@cursor/sdk` via `electron/cursor-sdk-client.js`; hidden unless `KEYCODE_ENABLE_SDK=1`; not product path |
| Phone remote | `electron/remote-server.js` bind `0.0.0.0` (LAN); static `src/remote/`; bearer token; live CDP chat list + transcript + composer bar + single-active-chat paste; chat SSE carries rule-based `suggestions[]`; Tailscale mode later |
| Next-card rules | `electron/card-suggestions.js` | Parse last pasted card + `KEYCODE_SCORE` / `KEYCODE_GATE` / `KEYCODE_NEXT` / test outcome; stock catalog only; no models |
| Windows list | PowerShell / native window enumeration |
| Security | contextIsolation, sandbox, CSP without `file:`, path-safe deck/tarot, IPC sender + payload whitelist; remote: LAN bind + bearer token (Tailscale identity when mode=`tailscale`), no prompt logging |
| Updates | electron-updater / GitHub Releases; never silent-update mid-paste |
| Tests | `node:test` for validation, import, paste routing, queue, remote auth/bind, card suggestions |
| Localization | Tiny `t(key)` + JSON packs (`src/i18n/ui`, `src/i18n/tarot`); main + all renderers; live apply on settings change |

---

## 8. Open Questions

- macOS later if needed
- Authenticode signing before wider distribution
- Adapters for other IDE agents after Cursor remote proves stable
- Optional AI card / skill that picks next cards (rule-based glow ships first; AI later without models in this release)
- Optional away-from-home access via Tailscale Serve (after LAN Wi‑Fi proves stable)
- Finish Cursor API / SDK backend (UI + project/chat sync story) behind `KEYCODE_ENABLE_SDK` when ready to compare again
- Opt-in vibe-coding motivation: local task/commit counters without prompt text, streaks, medals, and pre-generated reward images (cats/themes). Design separately; no reminders, tracking, or runtime image generation in this release.

---

## 9. Approval

- [x] Goal confirmed (верно + сделай)
- [x] UI direction confirmed (transparent overlay, targets list, tarot default, max 9)
- [x] User: **сделай** / trust to implement well
- [x] Public-release plan accepted (2026-07-19): security → paste reliability → first-run UX → tests → GitHub distribution; i18n later
- [x] Phone remote plan accepted (2026-07-19): Cursor-only transcript + single-target paste
- [x] Phone remote LAN Wi‑Fi for home testing (2026-07-22); Tailscale Serve later
- [x] Experimental CDP vs Cursor SDK A/B code (2026-07-23); **SDK shelved from product UI** (2026-07-23) — keep code, finish later; CDP is the shipping path
- [x] Rule-based next-card highlights for solo chat (KEYCODE_SCORE + glow on deck + phone) (2026-08-09)
- [x] Four-phase stock decks (validation / spec / work hobby+pro / release) + soft GATE/NEXT (2026-08-18)

**Approved by:** user **Date:** 2026-07-09; public plan 2026-07-19; phone remote 2026-07-19; LAN Wi‑Fi 2026-07-22; SDK A/B then shelve 2026-07-23; next-card hints 2026-08-09; four-phase decks 2026-08-18
