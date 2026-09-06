# AGENTS.md — TaroCode (Prompt Tarot Lazy Code)

> **Status:** APPROVED (user: «сделай», 2026-07-09; public-release plan 2026-07-19; display name TaroCode 2026-09-06)
>
> Do not implement features not described here without updating this file.

**Product name:** **TaroCode** (Prompt Tarot Lazy Code). GitHub repo / protocol markers stay `keycode` / `KEYCODE_*` for compatibility. Windows builds from v0.5.0 shipped as `TaroCode-*.exe`; newer builds use `productName` **TaroCode**.

---

## 1. Goal

**Problem:** Non-programmers who vibe-code keep retyping the same long prompts: evaluate, fix, test, backup, full plan→work→test chains. Programmers need a tougher variant of the same loop.

**For whom:** Vibe-coders (primary) + programmers (second bundled deck); public open-source Windows app via GitHub Releases.

**One-sentence goal:** Always-on-top transparent “tarot deck” of up to 9 prompt cards; one click (or an optional card hotkey if the user assigned one) pastes the card text into selected chat windows (optionally Enter).

**Success criteria:**

1. Show/hide deck via on-screen eye button and global hotkey (default F9).
2. Click card or bound key → text goes to all checked targets; optional Enter.
3. Edit cards, change images, max 9 cards; optional per-card hotkeys (F1–F8) assignable in Settings → Decks (stock decks ship with none); switch decks; import/export file.
4. Five bundled decks in four phases: Validation → Specification → Work (Hobby + Production) → Release; switch in settings or the deck pager.
5. Evaluation uses a project quality score 0–10: &lt;7 = redo; 7–10 = acceptable; card «Доведи» loops until score 9–10. Score cards end with `KEYCODE_SCORE: N`. Gate cards may also end with `KEYCODE_GATE: PASS|FAIL` and `KEYCODE_NEXT: deck-id/card-id`. Hints never block paste.
6. **Public readiness:** clean Windows 10/11 install → within ~2 minutes user adds a target and successfully sends a card; every failure shows a clear next action in the UI.
7. **Phone remote (opt-in):** mobile web remote for Cursor — list **all open Cursor chats** from CDP (no need to add them in TaroCode first), pick one active chat on the phone, read its loaded transcript live, send a deck card to that chat only. **Current access:** same Wi‑Fi (LAN): TaroCode binds `0.0.0.0`, phone opens `http://{pc-lan-ip}:{port}/#token=…` with bearer secret. **Later:** Tailscale Serve for away-from-home. Not Funnel / not a cloud account.
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
First run --> [Short skippable tour on deck]
```

### Show / hide deck

**Purpose:** Toggle deck visibility without clutter.

**Controls:** Eye button (👁) on the deck strip; same via global hotkey (default **F9**, chosen in Settings). Hover near the docked edge also reveals the strip when edge-hover is on. No separate floating eye window.

### Screen: Deck panel

**Purpose:** Cards + deck switch; Chats open as a separate Windows window.

**Layout:** Transparent frameless always-on-top; only interactive chrome is opaque. **Side docks (`right` / `left`):** default **tarot table** — grid **3 columns × 3 rows** flush to the top and the side edge (up to 9 cards; incomplete rows pack toward the screen edge so empty cells sit inward); empty space below the stack is click-through. Settings can switch to classic **strip**. **Top / bottom docks:** linear strip of cards along that edge; controls + live chat sit under (top) or above (bottom) the cards and span the **full width of the card row**.

**Side table:** All cards visible at once in the grid. Click any card → paste. Cards with a user-assigned F1–F8 hotkey also paste on that key; by default stock cards have no hotkey (click-only). Stack flush to the top and the side edge: **controls on top** (deck pager `‹ name ›`, destination bar, Chats, Settings, Hide, Quit), **card grid below**. Empty space below the stack is click-through.

**Destination bar (under deck pager):** Compact row of up to 4 named **presets** (broadcast sets) and chips for saved chats/fields. CDP chat chips show a small status dot from Cursor’s sidebar (`running` / `needs-attention` / `done-unseen` / `done-seen` / `draft`) — same color language as Cursor. Click a preset → `pasteMode=broadcast` (card goes to that set). Click a chat chip → `pasteMode=solo` (card goes only there, like phone). Small **💀** button (solo mode, ≥2 targets): remove all saved destinations except the active chat chip; presets drop removed ids. **▦** toggles the card strip (`deckCardsOpen`, default on; hotkeys still paste when cards are hidden). **▴/▾** toggles the chat pane (`deckTranscriptOpen`). Hidden when there are no saved targets.

**Cursor chat (under destination bar):** Compact live pane for the selected solo Cursor chat (CDP): by default only loaded messages (plus destination chips / project chat). On top/bottom docks the pane matches the **card-row width**. A small **manual mode** button sits above the cards; only after it is pressed do plan-question chips, **mode** (Agent/Plan/Ask/Debug) + **read-only model label** + free-text composer (keyboard + mic + **Send-after-dictation** checkbox), and Send/Build appear — cards shift down to make room (`deckComposerOpen`, default off). Mic STT default follows UI language when it changes (Russian → **GigaAM ml_ctc**, otherwise **Windows System.Speech**); Settings can override to GigaAM or Windows Speech manually. **Dictation checkbox** (`deckDictateAutoSend`, default off): when on, recognized text is submitted immediately; when off, text is inserted into the composer for manual Send. Same checkbox on the new-chat task prompt. Whole chat pane toggles open/closed with the ▴/▾ button on the destination bar (no empty gap when closed). Drag the bottom edge to resize height (saved); card pixel size stays from Settings (`panelScale`) — taller chat does not shrink cards (column scrolls if needed). Hidden when there are no saved targets. Hint text in broadcast mode; live messages in solo for CDP chats. No forced scroll for older history; updates while the deck is visible and the pane is open. Enter sends, Shift+Enter inserts a newline; successful send clears the composer and failures preserve it. Mode/model switch via CDP (current Cursor: modes under the composer «+» menu + mode chip; model via Auto picker).

**Controls:**

| # | Control | Action |
|---|---------|--------|
| 1 | Hide (👁) | Hide deck panel |
| 1b | Help (?) | Open the short skippable tour anytime |
| 2 | Settings (⚙) | Open centered settings window |
| 3 | CDP (◎) | If CDP is closed: centered dialog — close Cursor yourself, then big button «Launch Cursor with CDP». Does not kill Cursor. |
| 4 | Chats (💬) | Open the Chats window — standard Windows frame (move / resize / minimize / maximize / close); badge = paste destination count (preset/enabled in broadcast, `1` in solo) |
| 5 | Cards (≤9) | Side table / strip / top-bottom: click card. Paste to **resolved destinations** (active preset, or enabled targets, or solo chat). In solo CDP mode, up to 3 cards may glow (next-step hints) |
| 6 | Quit (✕) | Exit or minimize to background |
| 7 | Deck pager (‹ name ›) | Cycle active deck (wraps; Settings still has full select) |
| 8 | Destination bar | Switch broadcast preset or solo chat; CDP chips show Cursor status dots; 💀 removes other saved targets (solo, keep active); ▦ hide/show cards; ▴/▾ hide/show chat |
| 9 | Cursor chat | Live messages by default (full card-row width on top/bottom); small manual-mode button above cards reveals plan answers + mode + current model label + typed Send/Build + mic + send-after-dictation checkbox; mic STT = GigaAM or Windows Speech (UI language sets default); ▴/▾ toggles whole pane; drag bottom edge to resize |
| 10 | Next-card glow | Rule-based highlight from solo transcript + `KEYCODE_SCORE` (1 primary + ≤2 secondary); clears in broadcast / non-CDP |
| 11 | New chat (+) | Open the existing project/chat picker; create a project chat, save it, and select it as the active solo destination |

Edge hover on/off — только в Settings (на полосе карт отдельной кнопки нет).

**Target drivers:**

- `cdp` — Cursor via local Chrome DevTools Protocol (no focus steal). One or more chats; multi-window Cursor = separate CDP targets if one window cannot switch chats.
- `uia-quiet` — UIA `ValuePattern` write without activating the window (simple apps only). Created by «+ поле» when «Не забирать фокус» is on.
- `win32-field` / `uia` — legacy focus + Ctrl+V paths; used only when setting «Не забирать фокус» is **off**.

**No-focus mode (default on):** never call `SetForegroundWindow` / SendInput into other apps. Game stays focused. **Cursor path (product):** paste into open IDE chats via local CDP. Cursor must be started with `--remote-debugging-port=9222` bound to `127.0.0.1` (TaroCode shortcut preferred). TaroCode never kills Cursor. If Cursor is already open without CDP, a centered deck dialog asks the user to close it, then a big button launches Cursor with CDP flags. **Cursor API / SDK:** code kept (`electron/cursor-sdk-client.js`, settings keys, remote branches) but **hidden from UI**; re-enable later with env `KEYCODE_ENABLE_SDK=1` when finishing that path.

### First-run onboarding

Skippable **coach-mark tour** (~11 steps, Skip / Esc anytime): one zone at a time — dimmed overlay, bright cutout frame around the control, tip card with an arrow that points to that frame (tip must not cover the highlight). Top-to-bottom on the deck: (1) CDP circle green = app works / red = launch Cursor with CDP → (2) top buttons as a short list → (3) deck pager → (4) chat list strip (saved chats + status, +, prune) → (5) live Cursor chat pane → (6) manual mode (mic + Send) → (7) mid celebration card with art → (8) prompt cards (hover shows description) → (9) Settings → Phone remote only → (10) Settings → Decks editor → (11) finale celebration (fireworks + cat). Opens when `firstRunDone` is false; also via **?** next to the eye. Flag `firstRunDone` after dismiss/skip. CDP closed dialog still offered after the tour if needed.

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

**Flow (no-focus):** bind CDP chats from hierarchical project → chat list (TaroCode expands Cursor sidebar sections + “See more” on refresh) → enable or pick a preset / solo chat on the strip → click card → for each resolved CDP target: select chat in DOM → insert text (+ Enter if on). No Alt+Tab.

**New chat from pick:** in the project tree, **+** on a project creates a new Cursor agent/chat in that section via CDP DOM click, saves it to destinations, then opens a task prompt (text + mic STT: GigaAM or Windows Speech, same as deck composer). Enter/Send submits into that chat only (same paste queue as phone free text).

### Screen: Settings (separate window)

**Purpose:** App options + full deck/card editing without overlapping the deck strip.

**Layout:** Centered window (~980×720), dark theme. Left navigation opens one section at a time: General, Appearance, Cursor, Phone, Decks. The active section uses the remaining width, so advanced integrations and the deck editor are not mixed with everyday settings.

**Controls:**

| Area | Controls |
|------|----------|
| General | **UI language** (system / 10 locales), **arcana name language** (English default / follow UI / locale), **dictation** (`gigaam` \| `windows`; changing UI language sets default), **silence before auto-stop** (`dictationSilenceSec`, default 3.5), **max dictation length** (`dictationMaxSec`, default 0 = unlimited), pause between targets, Enter, hotkey, **show deck on startup**, **check for updates automatically** (notify and ask before opening GitHub Releases; never download silently), **Не забирать фокус**, data folder, logs folder, manual update check |
| Appearance | Dock side, **side layout** (table 3×3 default / classic strip), edge hover + **hide delay**, **card size** + **chat controls size** + independent **message font size** and **composer font size**, opacity, card fonts, card preview |
| Cursor (CDP) | Optional cdpPort; probe debug port; **install permanent Start Menu + Desktop shortcut** with CDP flags (preferred); launch Cursor with CDP after the user closes it (TaroCode does not kill Cursor); diagnostics; same dialog on deck (◎), Chats, and chat-pick when CDP is closed |
| Cursor API / SDK (shelved) | Implemented but **not shown** in Settings; future finish: API key, sdkProjects (folder + chats), phone `Project · Chat`. Dev re-enable: `KEYCODE_ENABLE_SDK=1` |
| Phone | Opt-in LAN server (`0.0.0.0`); show port + LAN IP URL; QR with secret in URL fragment; rotate secret; diagnose; Tailscale Serve UI marked “later” |
| Decks | Select/rename deck; new / export / import / delete; card list (≤9); card editor (title, description, prompt, tarot image, optional hotkey F1–F8 or empty for click-only; stock defaults empty) |
| Support | Sticky coffee-cup button (bottom-right, always visible). Opens centered modal: purpose switcher (`?` / coffee / beer / cats) with click-share stats (% by click count, only clicks older than 24h); pay via T-Bank collect, Lava.top, or crypto (copy address). Links local in config; no payment webhooks / no cloud |

### Screen: Phone remote (mobile browser)

**Purpose:** Control one Cursor chat from a phone while away from the PC keyboard.

**Layout:** Mobile-first single page — chat picker, live transcript, free-text composer, cards in **2 horizontal-scroll rows**. An unlabeled drag strip between transcript and bottom dock resizes the split (saved on the device). Card titles sit on the art like the Windows deck (no separate Cards/Message headers).

**Controls:**

| # | Control | Action |
|---|---------|--------|
| 1 | Chat select | Button shows the active chat; tap opens a sheet with the live CDP chat list + refresh. **+** creates a new Cursor chat in a chosen project (same CDP path as desktop), then selects it. |
| 2 | Transcript | Messages loaded in IDE chat; update live (SSE); no forced scroll for older history |
| 3 | Free text | Type or dictate → Send/Build (label mirrors Cursor) into the active phone-selected chat/agent and always submit. Composer clears after a successful send. No prompt logging. |
| 3b | Mode / model | Composer toolbar: Agent / Plan / Ask / Debug (whatever Cursor’s mode menu exposes; defaults list these four). Model is read-only (shows Cursor’s current model; switching in TaroCode later). |
| 3c | Plan questions | When Cursor shows clarifying choices, phone shows option chips; tap answers via CDP click. |
| 4 | Mic (dictation) | Tap mic → on-device speech-to-text into the composer (Web Speech API). Sends as text via the same paste path — not raw audio into Cursor. May be blocked on plain LAN `http://` (not a secure context); keyboard dictation still works. HTTPS/Tailscale later unlocks browser mic more reliably. |
| 5 | Cards | Tap card → paste into the **active** phone-selected chat/agent and **always submit** (desktop still follows Settings → Enter). Cards show arcana + action labels on the image in **2 rows** with sideways scroll. Primary CTA may read Send or Build. Same next-card glow (`suggestions[]`). |2 from chat SSE). |
| 6 | Status | Connection / Cursor working / task completed / CDP closed / chat missing / queue busy |

**Access (current):** TaroCode binds `0.0.0.0` (reachable on the home LAN). Phone and PC on the same Wi‑Fi. Auth = TaroCode bearer secret only (secret in URL `#token=…`, sent as header; never logged). Warn in UI: anyone on that Wi‑Fi with the link can use the remote. **Later:** Tailscale Serve mode (identity header + token). Funnel / open internet remain out of scope.

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
| Open tour | ? next to eye / first launch | — | Short skippable tour |
| Paste card | Click card / F-key | Card text; destinations from `pasteMode` (broadcast preset or enabled targets, or solo `activeTargetId`) | Text pasted (+ Enter if on); single queue |
| Switch paste dest | Destination bar / Chats presets | preset id or target id | `pasteMode` + active preset/target; badge updates |
| Deck Cursor chat | Solo chat selected on strip | Saved CDP target id | Loaded DOM messages + live poll; plan answers / mode / model label / free text / mic only when manual mode is on; sent only to that chat |
| Deck manual mode | Small button above cards | — | Shows/hides composer block; cards shift down when open (`deckComposerOpen`) |
| Next-card hints | Solo CDP chat (deck or phone) | Transcript + active deck prompts | Up to 3 cards highlighted (`rank` 1 primary, 2 secondary); frozen while generating |
| Phone list chats | Open remote / refresh / chat sheet | CDP probe + listChats | All open Cursor chats (ephemeral ids; not only saved TaroCode targets) |
| Phone new chat | + in chat sheet | Project name + Cursor window (CDP) | New chat created via CDP; selected as active phone target |
| Phone paste | Tap card on remote UI | Card id + phone-selected live chat | Text pasted and submitted to that CDP chat only; same queue |
| Phone free text | Type + Send on remote | Custom text + phone-selected live chat | Text pasted to that CDP chat only; same queue; text never logged; composer clears on success |
| Phone split | Drag strip between transcript and bottom dock | localStorage pct | Bottom dock height changes; cards stay 2-row horizontal scroll |
| Phone dictation | Mic on remote | On-device speech → text in composer | Same as free text after Send (or user edits first); raw audio not forwarded to Cursor |
| Phone read chat | Select chat on remote | Live chat id | Loaded transcript messages + live SSE updates |
| Phone task alert | Cursor generation changes `active → idle` | Selected Cursor target state | Foreground chime + vibration + visible «task completed» status |
| Edit card | Edit mode / context | Fields | Card updated in deck file |
| Add/remove card | + / delete | — | Deck size 1–9 |
| Add target | + поле / + чат | Field pick or CDP chat list | Saved target |
| New chat in project | + on project in chat-pick | Project name + Cursor window | New CDP chat saved; task modal (text/dictate) → paste+submit |
| Switch deck | Pager on strip / remote; select in settings | Deck id | Cards reload (remote SSE `deck` when active deck changes) |
| Import/export | Buttons | File | Deck JSON (validated; safe ids) |
| First run | First launch | — | Short skippable tour (deck → CDP → chat → card → phone); Skip/Esc anytime |
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
| Settings | … **sideCardLayout** (`table` default \| `strip`; legacy `wheel` → `table`), **pasteMode** (`broadcast` default \| `solo`), **activePresetId**, **activeTargetId**, **targetPresets**, **deckTranscriptOpen**, **deckCardsOpen** (card strip visible; default on), **deckComposerOpen** (manual typing/mic; default off), **deckDictateAutoSend** (submit after dictation; default off), **deckTranscriptHeightPx**, **showDeckOnStartup** (default false), **autoCheckUpdates** (default true; packaged app only), **hideDelayMs**, **panelScale** (cards), **chatScale** (chat controls/layout), **chatMessageFontPx** and **chatComposerFontPx** (independent desktop chat text sizes), **dictationEngine** (`gigaam` \| `windows`; UI language change updates default), **dictationSilenceSec** (default 3.5; hush before auto-end), **dictationMaxSec** (default 0 = no max; click mic to finish early), **cursorBackend** forced `cdp` in product (sdk settings keys kept for future), cursorApiKey / sdkProjects / activeSdkProjectId (shelved), … |

**Bundled decks (seeded on first run; per-locale packs under `data/locales/{locale}/`):**

| id | name (RU example) | Phase |
|----|------|--------|
| `validate-v1` | 01 Проверка идеи | Evidence before code |
| `spec-v1` | 02 Что строим | Brief, scope, UX, contracts, architecture, Cursor rules |
| `lazy-v1` | 03 Работа · Хобби | Side projects / learning; keep it simple. New installs start here; later launches restore `activeDeckId` |
| `pro-v1` | 03 Работа · Продакшен | Work / production bar; stricter review |
| `release-v1` | 04 Релиз | Quality, security, package, docs, gate, launch (no auto-publish) |

Each stock deck ships **9 cards** (all click-only by default; user may assign F1–F8 in the card editor). Work decks keep the existing loop (plan → evaluate/review → work → test → fix → polish → backup/`improve`/fullcycle). Summary: short status — no code; no `KEYCODE_SCORE`.

**Score convention («балл оценки проекта» 0–10):** Below 7 → must redo. 7–10 acceptable to continue. Card «Доведи» does not stop until score is 9 or 10. Stock score cards must end with a final line `KEYCODE_SCORE: N` (N integer 0–10). Some cards may also end with `KEYCODE_STATUS: READY|NEED_DATA|DONE|PARTIAL|BLOCKED|SAVED|FAILED` — state of the step, not quality; hints do not parse it yet. Gate cards (`evidence-review`, `validation-cycle`, `readiness`, `release-gate`, and work `fullcycle` when scope is done) may add:

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
| Cursor background | Permanent TaroCode shortcut (CDP flags) + `--remote-debugging-port=9222` + `--remote-debugging-address=127.0.0.1` + `electron/cdp-client.js`; user closes Cursor, then launches it with CDP — TaroCode does not kill Cursor |
| Cursor SDK (shelved, future) | `@cursor/sdk` via `electron/cursor-sdk-client.js`; hidden unless `KEYCODE_ENABLE_SDK=1`; not product path |
| Phone remote | `electron/remote-server.js` bind `0.0.0.0` (LAN); static `src/remote/`; bearer token; live CDP chat list + transcript + composer bar + single-active-chat paste; chat SSE carries rule-based `suggestions[]`; Tailscale mode later |
| Next-card rules | `electron/card-suggestions.js` | Parse last pasted card + `KEYCODE_SCORE` / `KEYCODE_GATE` / `KEYCODE_NEXT` / test outcome; stock catalog only; no models |
| Windows list | PowerShell / native window enumeration |
| Security | contextIsolation, sandbox, CSP without `file:`, path-safe deck/tarot, IPC sender + payload whitelist; remote: LAN bind + bearer token (Tailscale identity when mode=`tailscale`), no prompt logging |
| Updates | electron-updater / GitHub Releases; never silent-update mid-paste |
| Tests | `node:test` for validation, import, paste routing, queue, remote auth/bind, card suggestions |
| Localization | Tiny `t(key)` + JSON packs (`src/i18n/ui`, `src/i18n/tarot`); main + all renderers; live apply on settings change |
| Desktop mic STT | GigaAM via `electron/gigaam-dictate.js` (`gigastt` ml_ctc) or Windows System.Speech; GigaAM keeps a warm loopback `gigastt serve` (port 18976) so phrases skip cold model reload; recording trims leading hush and auto-ends after `dictationSilenceSec` (default 3.5); optional hard cap `dictationMaxSec` (default 0 = unlimited); click mic to finish early |

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
