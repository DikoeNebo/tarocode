# Keycode v0.5.0 launch kit

Ready-to-copy community posts. Full release text: [`RELEASE-NOTES-v0.5.0.md`](RELEASE-NOTES-v0.5.0.md).  
Release page: https://github.com/DikoeNebo/keycode/releases/tag/v0.5.0

## Status (after GitHub publish)

Already done:

- Public repo + tag `v0.5.0` + Windows portable/Setup + checksums + notes (EN/RU);
- Safe screenshots in the release: deck grid, decks editor, languages, dictation engine.

Still only you can do:

1. Record a 45–60s demo video (script below). Recommended before Cursor Forum; required before Show HN / Product Hunt.
2. Optional better screenshots: `keycode-hero.png` (deck beside clean Cursor chat), `keycode-phone.png` (phone + desktop, **no** QR / `#token=` / LAN IP), `keycode-dictation.png` (mic + recognized text + send).
3. Post in Cursor Forum (and later Habr) from your account.
4. Rotate the phone remote secret if any old screenshot with a token was ever shared.

## Publishing order

1. ~~GitHub Releases~~ — done for v0.5.0.
2. Same day if possible: English post in Cursor Forum → **Built for Cursor** (copy below).
3. After first real feedback: Russian Habr article (use the intro below; do not paste release notes unchanged).
4. Show HN / Product Hunt only after feedback + demo video + matching version numbers.

## Cursor Forum

**Category:** Built for Cursor

**Title:**

> Keycode: open-source prompt deck and phone remote for Cursor

**Post:**

I kept repeating the same actions in Cursor: explain the idea, ask for a plan, review the result, run tests, fix problems, and prepare a release. The prompts were useful, but finding and retyping them broke the flow.

So I built **Keycode**, an open-source Windows companion for Cursor. It puts up to nine prompt cards in a small always-on-top deck. Choose a chat and click a card; Keycode sends the prompt without taking focus away from the window you are currently using.

![Keycode prompt deck](https://raw.githubusercontent.com/DikoeNebo/keycode/v0.5.0/docs/screenshots/keycode-cycle.png)

The part I use most is the **phone remote**. When the PC and phone are on the same Wi‑Fi, I can open a secret QR link, see all open Cursor chats, select one, read its loaded transcript, and send a card or custom text from the phone. (If you attach a phone screenshot, crop or blur any QR, URL, token, and local IP.)

![Deck and prompt editor](https://raw.githubusercontent.com/DikoeNebo/keycode/v0.5.0/docs/screenshots/keycode-decks.png)

Keycode v0.5.0 includes:

- a deliberately simple interface for “lazy coding” workflows;
- five ready-made prompt decks for idea validation, specification, hobby or production work, and release;
- task dictation handled by Keycode through GigaAM or Windows Speech, then sent through Keycode’s own path instead of relying on Cursor dictation;
- solo-chat and multi-chat modes, editable decks, and rule-based next-card hints;
- the complete source under the MIT License.

This is a public preview, not a polished 1.0. It is Windows-only, the phone remote is limited to the local Wi‑Fi network, and Cursor needs to be opened with Keycode’s local debugging shortcut. The first binaries are unsigned, so the release includes SHA-256 checksums.

Source and downloads: https://github.com/DikoeNebo/keycode/releases/tag/v0.5.0

Issues and feedback: https://github.com/DikoeNebo/keycode/issues

I would especially value feedback on first-run setup, phone control, and paste reliability across current Cursor versions.

I am also looking for work in vibe coding and automation. If you are building AI-assisted workflows or need repetitive work turned into a practical tool, contact me through GitHub: https://github.com/DikoeNebo

## Short announcement — English

**Title:**

> I built an open-source phone remote and prompt deck for Cursor

**Text:**

Keycode turns recurring Cursor workflows into an always-on-top deck of prompt cards: validate an idea, write a spec, build, test, fix, and prepare a release without searching for the same prompts again.

It can control any open Cursor chat from a phone on the same Wi‑Fi, send prompts without stealing desktop focus, and dictate tasks through its own GigaAM/Windows Speech path. Windows, MIT licensed, first public preview.

Download: https://github.com/DikoeNebo/keycode/releases/tag/v0.5.0

I am open to work in vibe coding and automation: https://github.com/DikoeNebo

## Короткий анонс — русский

**Заголовок:**

> Сделал опенсорс-пульт с телефона и колоду готовых промптов для Cursor

**Текст:**

Keycode превращает повторяющуюся работу с Cursor в небольшую колоду поверх окон: проверка идеи, спецификация, работа, тесты, исправления и релиз — без постоянного поиска одних и тех же промптов.

Приложение позволяет управлять любым открытым чатом Cursor с телефона в одной Wi‑Fi-сети, отправляет промпты без перехвата фокуса на компьютере и умеет надиктовывать задачи через собственный маршрут GigaAM/Windows Speech. Windows, лицензия MIT, первая публичная preview-версия.

Скачать: https://github.com/DikoeNebo/keycode/releases/tag/v0.5.0

Также ищу работу по вайбкодингу и автоматизации: https://github.com/DikoeNebo

## Вступление для статьи на Habr

Я заметил, что при работе с Cursor повторяю не только одни и те же промпты, но и целые цепочки: сначала проверить идею, затем сформулировать требования, попросить план, проконтролировать реализацию, тесты и релиз. Сами модели ускоряют написание кода, но управление этим процессом быстро превращается в отдельную рутину.

Поэтому я сделал Keycode — открытое Windows-приложение с колодой готовых промптов, отдельной диктовкой и локальным пультом для Cursor с телефона. В статье разберу, какую проблему оно решает, почему для управления выбран локальный CDP, как устроена безопасность пульта в домашней сети и где первая preview-версия пока ограничена.

Ссылка на релиз: https://github.com/DikoeNebo/keycode/releases/tag/v0.5.0

## Demo video: 45–60 seconds

Record at 1080p. Use a clean demo project and test chats with no personal data. The UI must remain readable after the platform compresses the video.

**0–4 seconds — the problem**

- Show Cursor and the compact Keycode deck.
- On-screen text: `Stop retyping the same prompts.`

**4–13 seconds — one-click workflow**

- Select a demo Cursor chat in Keycode.
- Click a card such as idea evaluation or testing.
- Show the prompt appearing in that chat while another desktop window remains active.
- On-screen text: `One card → one repeatable action. No focus steal.`

**13–23 seconds — complete prompt cycle**

- Page through the five bundled decks.
- Pause briefly on validation, specification, work, and release.
- Show one next-card highlight.
- On-screen text: `From idea validation to release.`

**23–34 seconds — dictation**

- Open Keycode’s manual composer and tap the desktop microphone.
- Say one short task, for example: “Check the current implementation, run the tests, and list only confirmed problems.”
- Show the recognized text, then its successful submission to Cursor.
- On-screen text: `Dictation handled by Keycode.`

**34–49 seconds — phone remote**

- Use a phone or a clean phone recording composited beside the desktop.
- Open the already-authorized remote without showing the QR or URL.
- Select another open Cursor chat, show two or three transcript messages, then tap a card.
- Show the selected desktop chat receiving the card.
- On-screen text: `Control any open Cursor chat on the same Wi‑Fi.`

**49–60 seconds — open source and call to action**

- Show the GitHub repository, MIT License, and Releases page.
- On-screen text: `Windows · MIT · Open source` followed by `github.com/DikoeNebo/keycode`.
- Optional final line: `Looking for vibe-coding and automation work.`

Use captions instead of narration if that produces a tighter video. Do not spend video time on installation, settings forms, or technical CDP details; those belong in the release text.

## Screenshot plan

Shipped with v0.5.0:

1. `keycode-cycle.png` — 3×3 idea-validation deck. Caption: `Repeatable Cursor workflows, one click away.`
2. `keycode-decks.png` — deck and prompt editor. Caption: `Use the five bundled decks or edit your own.`
3. `keycode-languages.png` — desktop language selector. Caption: `Desktop interface available in 10 languages.`
4. `keycode-dictation-engine.png` — GigaAM / Windows Speech selector. Caption: `Dictation handled by Keycode.`

Nice-to-have replacements (you shoot → we can drop into README/release):

1. `keycode-hero.png` — deck beside a clean Cursor demo chat; destination chip + one highlighted card.
2. `keycode-phone.png` — phone + desktop; blur QR, URL, token, LAN IP.
3. `keycode-dictation.png` — mic + recognized text + successful send.
4. Optional: `keycode-demo.mp4` or an external video link.

Do not use legacy `demo-deck.png` in launch posts.

## Recording safety checklist

- Disposable demo project and chats; never record real client code or conversation history.
- Turn off desktop and phone notifications.
- Hide bookmarks, account email, user folders, local IP address, and machine name.
- Never show the phone QR code, `#token=...` URL fragment, bearer token, API keys, or clipboard history.
- Check every frame before publishing, including the first and last frame of cuts.
- Do not demonstrate public internet access: the v0.5.0 phone remote is for the same private Wi‑Fi only.
- Prefer the published v0.5.0 binary so the video matches the release.
