# Keycode v0.5.0 — Public Preview

Keycode is an open-source Windows companion for Cursor that turns repetitive AI-coding routines into a small always-on-top deck. Pick a chat, click a card, and continue working — no searching for an old prompt, retyping instructions, or constantly switching windows.

This is the first public preview: useful today, but not presented as a polished 1.0. Feedback and bug reports are welcome.

## Why Keycode

- **Control Cursor from your phone.** On the same Wi‑Fi, open the secret QR link, choose any open Cursor chat, read its loaded transcript, and send a card or custom message from your phone.
- **A simpler interface for lazy coding.** Up to nine visible prompt cards keep recurring actions one click away. Keycode can paste into Cursor without stealing focus from your current window.
- **Ready-made prompts for the complete project cycle.** Five bundled decks cover idea validation, specification, hobby or production work, and release. Rule-based hints can highlight a sensible next card.
- **Dictate tasks through Keycode.** Desktop dictation is handled by Keycode with GigaAM or Windows Speech and submitted through Keycode’s own send path, avoiding the common case where text dictated through Cursor is recognized but never reaches the chat.
- **Fully open source.** The complete application is available under the MIT License. You can inspect it, change the prompts, create decks, export them, or contribute fixes.

Also included:

- solo-chat and multi-chat broadcast modes;
- live Cursor transcript in the deck and phone remote;
- card and deck editor with validated JSON import/export;
- optional per-card F1–F8 shortcuts and F9 deck toggle;
- desktop interface in 10 languages; phone interface in English and Russian;
- no cloud account and no prompt or chat text in Keycode logs.

## Screenshots

### The prompt deck

![Idea-validation prompt deck](https://raw.githubusercontent.com/DikoeNebo/keycode/v0.5.0/docs/screenshots/keycode-cycle.png)

### Editable decks and prompts

![Deck and prompt editor](https://raw.githubusercontent.com/DikoeNebo/keycode/v0.5.0/docs/screenshots/keycode-decks.png)

### Ten desktop interface languages

![Interface language selector](https://raw.githubusercontent.com/DikoeNebo/keycode/v0.5.0/docs/screenshots/keycode-languages.png)

### Keycode’s own dictation path

![GigaAM and Windows Speech selector](https://raw.githubusercontent.com/DikoeNebo/keycode/v0.5.0/docs/screenshots/keycode-dictation-engine.png)

## Download

- `Keycode-0.5.0-portable.exe` — run without installation
- `Keycode-Setup-0.5.0.exe` — Windows installer
- `SHA256SUMS.txt` — checksums for both builds

Official downloads are published only in this repository. Do not trust third-party reuploads.

## Quick start

1. Download the portable build or installer.
2. Press **F9** or click the eye button to show the deck.
3. In **Settings → Cursor**, create the Keycode Cursor shortcut. Close Cursor once and reopen it with that shortcut.
4. Open **Chats → + chat**, choose a Cursor chat, and click a card.
5. Optional: enable **Phone remote** in Settings and scan its QR code while the phone and PC are on the same Wi‑Fi.

## Honest limits

- Windows x64 only.
- Builds are not Authenticode-signed yet, so Windows SmartScreen may show “Unknown publisher.” Verify the downloaded file with `SHA256SUMS.txt`.
- Background control requires Cursor to be launched with Keycode’s local debugging shortcut. The debugging port is available only on this PC.
- Phone control is LAN-only. Anyone on the same network who gets the secret link can control the remote; use a private network and do not share the QR code.
- The phone page shows messages already loaded in Cursor plus live updates. It does not force Cursor to load older history.
- Browser microphone support can be restricted on a plain HTTP local network. Desktop Keycode dictation is the supported reliable path in this preview.
- Internet access, Tailscale mode, other IDE adapters, and model switching are not part of v0.5.0.

## Verify the download

```powershell
Get-FileHash .\Keycode-0.5.0-portable.exe -Algorithm SHA256
```

Compare the result with `SHA256SUMS.txt` attached to this release.

Source: https://github.com/DikoeNebo/keycode

Issues and feedback: https://github.com/DikoeNebo/keycode/issues

License: MIT

I am also looking for work in vibe coding and automation. If you are building AI-assisted workflows or need someone who can turn repetitive work into practical tools, contact me through my GitHub profile: https://github.com/DikoeNebo

---

# Keycode v0.5.0 — первый публичный preview-релиз

Keycode — опенсорс-приложение для Windows, которое превращает повторяющуюся работу с Cursor в компактную колоду поверх окон. Выбираете чат, нажимаете карту и продолжаете работу — не нужно искать старый промпт, заново печатать инструкции и постоянно переключаться между окнами.

Это первая публичная preview-версия: приложением уже можно пользоваться, но это ещё не отполированный 1.0. Буду рад отзывам и сообщениям об ошибках.

## Зачем нужен Keycode

- **Удалённое управление с телефона.** В домашней Wi‑Fi-сети можно открыть веб-страницу по секретной ссылке, выбрать любой открытый чат Cursor, читать загруженную переписку и отправлять карты или свой текст со смартфона.
- **Упрощённый интерфейс для ленивого кодинга.** До девяти карточек с постоянными действиями всегда под рукой. Keycode умеет отправлять текст в Cursor, не перехватывая фокус у игры или другого активного окна.
- **Готовые промпты для полного цикла.** Пять встроенных колод ведут от проверки идеи и спецификации через работу в хобби- или продакшен-режиме до подготовки релиза. Простые правила подсказывают, какую карту логично применить следующей.
- **Надиктовка задач через Keycode.** Приложение само распознаёт речь через GigaAM или Windows Speech и отправляет результат своим маршрутом. Это обходит частую проблему встроенной диктовки Cursor, когда речь распознана, но текст не доходит до чата.
- **Полный опенсорс.** Весь исходный код открыт по лицензии MIT. Можно проверить работу приложения, изменить промпты, собрать свои колоды, экспортировать их или прислать исправление.

Дополнительно:

- одиночный чат или отправка одного промпта сразу в несколько чатов;
- живая переписка Cursor в колоде и на телефоне;
- редактор карт и колод, безопасный импорт и экспорт JSON;
- назначаемые горячие клавиши F1–F8 и показ колоды по F9;
- интерфейс программы на 10 языках, интерфейс телефона — на русском и английском;
- без облачного аккаунта; Keycode не записывает тексты промптов и чатов в логи.

## Скриншоты

### Колода готовых промптов

![Колода проверки идеи](https://raw.githubusercontent.com/DikoeNebo/keycode/v0.5.0/docs/screenshots/keycode-cycle.png)

### Редактор колод и промптов

![Редактор колод и промптов](https://raw.githubusercontent.com/DikoeNebo/keycode/v0.5.0/docs/screenshots/keycode-decks.png)

### Десять языков настольного интерфейса

![Выбор языка интерфейса](https://raw.githubusercontent.com/DikoeNebo/keycode/v0.5.0/docs/screenshots/keycode-languages.png)

### Собственный маршрут диктовки Keycode

![Выбор GigaAM или Windows Speech](https://raw.githubusercontent.com/DikoeNebo/keycode/v0.5.0/docs/screenshots/keycode-dictation-engine.png)

## Скачать

- `Keycode-0.5.0-portable.exe` — запуск без установки
- `Keycode-Setup-0.5.0.exe` — установщик для Windows
- `SHA256SUMS.txt` — контрольные суммы обеих сборок

Официальные файлы публикуются только в этом репозитории. Не скачивайте Keycode с сайтов-перезаливов.

## Быстрый старт

1. Скачайте portable-версию или установщик.
2. Нажмите **F9** или кнопку с глазом, чтобы показать колоду.
3. В разделе **Настройки → Cursor** создайте специальный ярлык. Один раз закройте Cursor и снова откройте его этим ярлыком.
4. Откройте **Чаты → + чат**, выберите чат Cursor и нажмите карту.
5. По желанию включите **Пульт с телефона** и отсканируйте QR-код, пока телефон и компьютер подключены к одной Wi‑Fi-сети.

## Честные ограничения

- Только Windows x64.
- Сборки пока без цифровой подписи, поэтому SmartScreen может показать «Неизвестный издатель». Сверьте файл с `SHA256SUMS.txt`.
- Для фонового управления Cursor должен быть открыт специальным локальным ярлыком Keycode. Отладочный порт доступен только на этом компьютере.
- Пульт работает только в локальной сети. Любой человек, получивший секретную ссылку, сможет им управлять: используйте домашнюю сеть и не показывайте QR-код.
- На телефоне видны уже загруженные в Cursor сообщения и новые ответы. Keycode не заставляет Cursor подгружать старую историю.
- На обычной локальной HTTP-странице браузер может запретить микрофон. Надиктовка в настольном Keycode — основной поддерживаемый вариант этой preview-версии.
- Доступ через интернет, Tailscale, другие IDE и переключение модели не входят в v0.5.0.

## Проверка скачанного файла

```powershell
Get-FileHash .\Keycode-0.5.0-portable.exe -Algorithm SHA256
```

Сравните результат с приложенным к релизу файлом `SHA256SUMS.txt`.

Исходный код: https://github.com/DikoeNebo/keycode

Ошибки и предложения: https://github.com/DikoeNebo/keycode/issues

Лицензия: MIT

Отдельно: я ищу работу по вайбкодингу и автоматизации. Если вы создаёте продукты с ИИ или хотите превратить повторяющуюся ручную работу в удобные инструменты, напишите мне через профиль GitHub: https://github.com/DikoeNebo
