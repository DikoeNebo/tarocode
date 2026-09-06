# Keycode v0.5.0 launch kit

Ready-to-copy community posts for the first public preview. The full release description lives in [`RELEASE-NOTES-v0.5.0.md`](RELEASE-NOTES-v0.5.0.md).

## Current release readiness

Ready:

- v0.5.0 source, Windows builds, checksums, release copy, and community posts;
- clean screenshots of the prompt deck, deck editor, 10-language selector, and dictation-engine selector.

Before publishing:

1. Add a safe replacement `keycode-phone.png`. The previous image was removed because it exposed the remote URL, QR code, local IP, and bearer secret. Click **New secret** in Keycode now; never reuse or publish the removed image.
2. Add a safe replacement `keycode-hero.png` with a neutral demo chat. The previous image was removed because its real conversation about uncensored models distracted from the product.
3. Replace `keycode-dictation.png` with a frame that visibly shows recognized demo text and a successful send. The current empty composer does not prove dictation.
4. Record the optional 45–60 second demo below. It is recommended for Cursor Forum and required before trying Show HN or Product Hunt.
5. Commit the final screenshots and text, then recreate the local `v0.5.0` tag on that final commit. Raw screenshot links in the release copy use this tag.
6. Confirm the GitHub repository is public and all links work before posting elsewhere.

The unsafe phone image already exists in a local commit. Deleting it from the current tree does not remove it from Git history. Rotating the remote secret is mandatory. If the old image must not appear anywhere in the future public history, squash or rewrite the unpublished release commits before the first push.

## Recommended publishing order

1. Publish the source and binaries on GitHub Releases. This is the only official download location.
2. On the same day, publish the English post below in the Cursor Forum category **Built for Cursor**, using the clean deck screenshot and the replacement phone screenshot.
3. After collecting the first real feedback, publish a Russian article on Habr: explain the repetitive workflow that led to Keycode, show the implementation and security trade-offs, and link to GitHub. Do not repost the release notes unchanged.
4. Consider Show HN or Product Hunt only after v0.5.0 has real-user feedback, one clear English demo video, matching version numbers, and no placeholder checksums.

## Cursor Forum

**Category:** Built for Cursor

**Title:**

> Keycode: open-source prompt deck and phone remote for Cursor

**Post:**

I kept repeating the same actions in Cursor: explain the idea, ask for a plan, review the result, run tests, fix problems, and prepare a release. The prompts were useful, but finding and retyping them broke the flow.

So I built **Keycode**, an open-source Windows companion for Cursor. It puts up to nine prompt cards in a small always-on-top deck. Choose a chat and click a card; Keycode sends the prompt without taking focus away from the window you are currently using.

![Keycode prompt deck](https://raw.githubusercontent.com/DikoeNebo/keycode/v0.5.0/docs/screenshots/keycode-cycle.png)

The part I use most is the **phone remote**. When the PC and phone are on the same Wi‑Fi, I can open a secret QR link, see all open Cursor chats, select one, read its loaded transcript, and send a card or custom text from the phone.

After replacing the unsafe phone screenshot, attach it directly below this paragraph. Do not publish a QR code, URL, token, local IP address, or personal transcript.

Keycode v0.5.0 includes:

- a deliberately simple interface for “lazy coding” workflows;
- five ready-made prompt decks for idea validation, specification, hobby or production work, and release;
- task dictation handled by Keycode through GigaAM or Windows Speech, then sent through Keycode’s own path instead of relying on Cursor dictation;
- solo-chat and multi-chat modes, editable decks, and rule-based next-card hints;
- the complete source under the MIT License.

This is a public preview, not a polished 1.0. It is Windows-only, the phone remote is limited to the local Wi‑Fi network, and Cursor needs to be opened with Keycode’s local debugging shortcut. The first binaries are unsigned, so the release includes SHA-256 checksums.

Source and downloads: https://github.com/DikoeNebo/keycode

Issues and feedback: https://github.com/DikoeNebo/keycode/issues

I would especially value feedback on first-run setup, phone control, and paste reliability across current Cursor versions.

I am also looking for work in vibe coding and automation. If you are building AI-assisted workflows or need repetitive work turned into a practical tool, contact me through GitHub: https://github.com/DikoeNebo

## Short announcement — English

**Title:**

> I built an open-source phone remote and prompt deck for Cursor

**Text:**

Keycode turns recurring Cursor workflows into an always-on-top deck of prompt cards: validate an idea, write a spec, build, test, fix, and prepare a release without searching for the same prompts again.

It can control any open Cursor chat from a phone on the same Wi‑Fi, send prompts without stealing desktop focus, and dictate tasks through its own GigaAM/Windows Speech path. Windows, MIT licensed, first public preview.

Source and download: https://github.com/DikoeNebo/keycode

I am open to work in vibe coding and automation: https://github.com/DikoeNebo

## Короткий анонс — русский

**Заголовок:**

> Сделал опенсорс-пульт с телефона и колоду готовых промптов для Cursor

**Текст:**

Keycode превращает повторяющуюся работу с Cursor в небольшую колоду поверх окон: проверка идеи, спецификация, работа, тесты, исправления и релиз — без постоянного поиска одних и тех же промптов.

Приложение позволяет управлять любым открытым чатом Cursor с телефона в одной Wi‑Fi-сети, отправляет промпты без перехвата фокуса на компьютере и умеет надиктовывать задачи через собственный маршрут GigaAM/Windows Speech. Windows, лицензия MIT, первая публичная preview-версия.

Исходники и скачивание: https://github.com/DikoeNebo/keycode

Также ищу работу по вайбкодингу и автоматизации: https://github.com/DikoeNebo

## Вступление для статьи на Habr

Я заметил, что при работе с Cursor повторяю не только одни и те же промпты, но и целые цепочки: сначала проверить идею, затем сформулировать требования, попросить план, проконтролировать реализацию, тесты и релиз. Сами модели ускоряют написание кода, но управление этим процессом быстро превращается в отдельную рутину.

Поэтому я сделал Keycode — открытое Windows-приложение с колодой готовых промптов, отдельной диктовкой и локальным пультом для Cursor с телефона. В статье разберу, какую проблему оно решает, почему для управления выбран локальный CDP, как устроена безопасность пульта в домашней сети и где первая preview-версия пока ограничена.

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

Use now:

1. `keycode-cycle.png` — clean view of the 3×3 idea-validation deck.
   - Caption: `Repeatable Cursor workflows, one click away.`
2. `keycode-decks.png` — deck and prompt editor.
   - Caption: `Use the five bundled decks or edit your own.`
3. `keycode-languages.png` — desktop language selector.
   - Caption: `Desktop interface available in 10 languages.`
4. `keycode-dictation-engine.png` — GigaAM and Windows Speech selector.
   - Caption: `Dictation handled by Keycode through GigaAM or Windows Speech.`

Replace before launch:

1. `keycode-hero.png` — capture the deck beside a clean Cursor demo chat containing only a short, neutral task and response. Keep the destination chip and one highlighted card visible.
   - Caption: `A complete Cursor workflow in a compact always-on-top deck.`
2. `keycode-phone.png` — show a phone and desktop in one frame, but crop or blur the QR code, URL, token, local IP, account details, and notifications. Use a disposable chat.
   - Caption: `Pick an open Cursor chat and send a card from your phone.`
3. `keycode-dictation.png` — show the microphone state, recognized neutral text, and the resulting message in a disposable Cursor chat.
   - Caption: `Dictate a task and send it through Keycode’s own path.`

Optional:

- `docs/screenshots/keycode-demo.mp4` or an externally hosted video link;
- keep `demo-deck.png` only as a legacy development image; do not use it in launch posts.

## Recording safety checklist

- Create a disposable demo project and chats; never record real client code or conversation history.
- Turn off desktop and phone notifications.
- Hide bookmarks, account email, user folders, local IP address, and machine name.
- Never show the phone QR code, `#token=...` URL fragment, bearer token, API keys, or clipboard history.
- Check every frame before publishing, including the first and last frame of cuts.
- Do not demonstrate public internet access: the v0.5.0 phone remote is for the same private Wi‑Fi only.
- Use the exact v0.5.0 binary that will be published so the video matches the release.
