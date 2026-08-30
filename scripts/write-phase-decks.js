/**
 * Write stock phase decks for all UI locales.
 * EN + RU prompts are authored; other locales get translated titles + EN prompts.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const locales = ["en", "ru", "uk", "de", "es", "fr", "pt-BR", "zh-CN", "ja", "pl"];

const NAMES = {
  "validate-v1": {
    en: "01 Validation",
    ru: "01 Валидация",
    uk: "01 Валідація",
    de: "01 Validierung",
    es: "01 Validación",
    fr: "01 Validation",
    "pt-BR": "01 Validação",
    "zh-CN": "01 验证",
    ja: "01 検証",
    pl: "01 Walidacja",
  },
  "spec-v1": {
    en: "02 Specification",
    ru: "02 Спецификация",
    uk: "02 Специфікація",
    de: "02 Spezifikation",
    es: "02 Especificación",
    fr: "02 Spécification",
    "pt-BR": "02 Especificação",
    "zh-CN": "02 规格",
    ja: "02 仕様",
    pl: "02 Specyfikacja",
  },
  "lazy-v1": {
    en: "03 Work · Hobby",
    ru: "03 Работа · Хобби",
    uk: "03 Робота · Хобі",
    de: "03 Arbeit · Hobby",
    es: "03 Trabajo · Hobby",
    fr: "03 Travail · Hobby",
    "pt-BR": "03 Trabalho · Hobby",
    "zh-CN": "03 工作 · 爱好",
    ja: "03 作業 · 趣味",
    pl: "03 Praca · Hobby",
  },
  "pro-v1": {
    en: "03 Work · Production",
    ru: "03 Работа · Продакшен",
    uk: "03 Робота · Продакшен",
    de: "03 Arbeit · Produktion",
    es: "03 Trabajo · Producción",
    fr: "03 Travail · Production",
    "pt-BR": "03 Trabalho · Produção",
    "zh-CN": "03 工作 · 生产",
    ja: "03 作業 · 本番",
    pl: "03 Praca · Produkcja",
  },
  "release-v1": {
    en: "04 Release",
    ru: "04 Релиз",
    uk: "04 Реліз",
    de: "04 Release",
    es: "04 Lanzamiento",
    fr: "04 Release",
    "pt-BR": "04 Lançamento",
    "zh-CN": "04 发布",
    ja: "04 リリース",
    pl: "04 Wydanie",
  },
};

const TITLES = {
  problem: { en: "Problem", ru: "Проблема", uk: "Проблема", de: "Problem", es: "Problema", fr: "Problème", "pt-BR": "Problema", "zh-CN": "问题", ja: "問題", pl: "Problem" },
  "evidence-plan": { en: "Evidence plan", ru: "План проверки", uk: "План перевірки", de: "Prüfplan", es: "Plan de pruebas", fr: "Plan de preuve", "pt-BR": "Plano de evidência", "zh-CN": "验证计划", ja: "検証計画", pl: "Plan dowodów" },
  interview: { en: "Interview", ru: "Интервью", uk: "Інтерв’ю", de: "Interview", es: "Entrevista", fr: "Entretien", "pt-BR": "Entrevista", "zh-CN": "访谈", ja: "インタビュー", pl: "Wywiad" },
  market: { en: "Market", ru: "Рынок", uk: "Ринок", de: "Markt", es: "Mercado", fr: "Marché", "pt-BR": "Mercado", "zh-CN": "市场", ja: "市場", pl: "Rynek" },
  experiment: { en: "Experiment", ru: "Эксперимент", uk: "Експеримент", de: "Experiment", es: "Experimento", fr: "Expérience", "pt-BR": "Experimento", "zh-CN": "实验", ja: "実験", pl: "Eksperyment" },
  "evidence-review": { en: "Verdict", ru: "Вердикт", uk: "Вердикт", de: "Urteil", es: "Veredicto", fr: "Verdict", "pt-BR": "Veredito", "zh-CN": "裁决", ja: "判定", pl: "Werdykt" },
  pivot: { en: "Pivot", ru: "Поворот", uk: "Поворот", de: "Pivot", es: "Giro", fr: "Pivot", "pt-BR": "Pivot", "zh-CN": "转向", ja: "ピボット", pl: "Zwrot" },
  "validation-cycle": { en: "Full check", ru: "Полный цикл", uk: "Повний цикл", de: "Voller Check", es: "Ciclo completo", fr: "Cycle complet", "pt-BR": "Ciclo completo", "zh-CN": "完整检查", ja: "全チェック", pl: "Pełny cykl" },
  brief: { en: "Brief", ru: "Бриф", uk: "Бриф", de: "Brief", es: "Brief", fr: "Brief", "pt-BR": "Briefing", "zh-CN": "简报", ja: "ブリーフ", pl: "Brief" },
  scope: { en: "MVP", ru: "MVP", uk: "MVP", de: "MVP", es: "MVP", fr: "MVP", "pt-BR": "MVP", "zh-CN": "MVP", ja: "MVP", pl: "MVP" },
  ux: { en: "Interface", ru: "Интерфейс", uk: "Інтерфейс", de: "Oberfläche", es: "Interfaz", fr: "Interface", "pt-BR": "Interface", "zh-CN": "界面", ja: "画面", pl: "Interfejs" },
  "data-contracts": { en: "Data", ru: "Данные", uk: "Дані", de: "Daten", es: "Datos", fr: "Données", "pt-BR": "Dados", "zh-CN": "数据", ja: "データ", pl: "Dane" },
  architecture: { en: "Architecture", ru: "Архитектура", uk: "Архітектура", de: "Architektur", es: "Arquitectura", fr: "Architecture", "pt-BR": "Arquitetura", "zh-CN": "架构", ja: "設計", pl: "Architektura" },
  "project-rules": { en: "Rules", ru: "Правила", uk: "Правила", de: "Regeln", es: "Reglas", fr: "Règles", "pt-BR": "Regras", "zh-CN": "规则", ja: "ルール", pl: "Zasady" },
  "risk-review": { en: "Review", ru: "Ревью", uk: "Рев’ю", de: "Review", es: "Revisión", fr: "Revue", "pt-BR": "Revisão", "zh-CN": "评审", ja: "レビュー", pl: "Przegląd" },
  readiness: { en: "Ready?", ru: "Готовность", uk: "Готовність", de: "Bereit?", es: "¿Listo?", fr: "Prêt ?", "pt-BR": "Pronto?", "zh-CN": "就绪", ja: "準備", pl: "Gotowe?" },
  "release-plan": { en: "Profile", ru: "Профиль", uk: "Профіль", de: "Profil", es: "Perfil", fr: "Profil", "pt-BR": "Perfil", "zh-CN": "配置", ja: "プロファイル", pl: "Profil" },
  "quality-audit": { en: "Quality", ru: "Качество", uk: "Якість", de: "Qualität", es: "Calidad", fr: "Qualité", "pt-BR": "Qualidade", "zh-CN": "质量", ja: "品質", pl: "Jakość" },
  "security-audit": { en: "Security", ru: "Безопасность", uk: "Безпека", de: "Sicherheit", es: "Seguridad", fr: "Sécurité", "pt-BR": "Segurança", "zh-CN": "安全", ja: "セキュリティ", pl: "Bezpieczeństwo" },
  package: { en: "Package", ru: "Сборка", uk: "Збірка", de: "Paket", es: "Paquete", fr: "Paquet", "pt-BR": "Pacote", "zh-CN": "打包", ja: "パッケージ", pl: "Pakiet" },
  docs: { en: "Docs", ru: "Документы", uk: "Документи", de: "Doku", es: "Docs", fr: "Docs", "pt-BR": "Docs", "zh-CN": "文档", ja: "文書", pl: "Dokumenty" },
  operations: { en: "Ops", ru: "Эксплуатация", uk: "Експлуатація", de: "Betrieb", es: "Ops", fr: "Ops", "pt-BR": "Ops", "zh-CN": "运维", ja: "運用", pl: "Operacje" },
  "release-gate": { en: "Gate", ru: "Допуск", uk: "Допуск", de: "Gate", es: "Puerta", fr: "Gate", "pt-BR": "Gate", "zh-CN": "门禁", ja: "ゲート", pl: "Brama" },
  launch: { en: "Launch", ru: "Запуск", uk: "Запуск", de: "Launch", es: "Lanzar", fr: "Lancer", "pt-BR": "Lançar", "zh-CN": "上线", ja: "公開", pl: "Start" },
  summary: { en: "Recap", ru: "Сводка", uk: "Зведення", de: "Kurzlage", es: "Resumen", fr: "Récap", "pt-BR": "Resumo", "zh-CN": "摘要", ja: "要約", pl: "Skrót" },
};

function tmap(map, loc) {
  return (map && (map[loc] || map.en)) || "";
}

const DESC = {
  en: {
    problem: "Fool: who hurts, what breaks, testable hypothesis",
    "evidence-plan": "Hierophant: cheapest proof, metric, stop rule",
    interview: "Two of Cups: questions or real answers — no invented people",
    market: "Wheel: competitors, licenses, reuse — not a copy dump",
    experiment: "Magician: smoke / fake door / waitlist; success bar already set",
    "evidence-review": "Justice: only facts you have; PASS or FAIL",
    pivot: "Hanged Man: keep facts, shrink audience / problem / channel",
    "validation-cycle": "World: run the check; stop where a human must act",
    summary: "High Priestess: hypothesis / evidence / gaps / next",
    brief: "Emperor: goal, users, stories, measurable outcome",
    scope: "Two of Swords: IN / OUT, one happy path, acceptance",
    ux: "Ace of Cups: screens, buttons, empty/error/loading",
    "data-contracts": "Ace of Pentacles: entities only if the project needs them",
    architecture: "Chariot: simplest fit after reading the repo",
    "project-rules": "Hierophant: AGENTS.md and .cursor/rules — no leftover .cursorrules",
    "risk-review": "Justice: clarity, YAGNI, safety, testability",
    readiness: "Judgement: gate to Hobby or Production work",
    "release-plan": "Three of Wands: product type, channel, what needs a yes",
    "quality-audit": "Star: run existing tests/builds only",
    "security-audit": "Ace of Swords: secrets, inputs, deps — report, don't patch",
    package: "Three of Pentacles: artifact + rollback; wait before publish",
    docs: "Hermit: README / notes / install / rollback that exist",
    operations: "Temperance: logs, backup, support, incident",
    "release-gate": "Justice: ship only if checks pass",
    launch: "Sun: show plan first; publish only after a clear yes",
  },
  ru: {
    problem: "Шут: кто страдает, что ломается, проверяемая гипотеза",
    "evidence-plan": "Иерофант: самый дешёвый способ, метрика, правило стоп",
    interview: "Двойка кубков: вопросы или реальные ответы — без выдуманных людей",
    market: "Колесо: конкуренты, лицензии, переиспользование — не копипаст",
    experiment: "Маг: smoke / fake door / лист ожидания; порог уже задан",
    "evidence-review": "Справедливость: только факты; PASS или FAIL",
    pivot: "Повешенный: факты оставить, сузить аудиторию / проблему / канал",
    "validation-cycle": "Мир: пройти проверку; стоп там, где нужен человек",
    summary: "Жрица: гипотеза / доказательства / пробелы / дальше",
    brief: "Император: цель, пользователи, сценарии, измеримый результат",
    scope: "Двойка мечей: IN / OUT, один счастливый путь, приёмка",
    ux: "Туз кубков: экраны, кнопки, пусто / ошибка / загрузка",
    "data-contracts": "Туз пентаклей: сущности только если проекту нужны",
    architecture: "Колесница: самое простое после чтения репозитория",
    "project-rules": "Иерофант: AGENTS.md и .cursor/rules — без старого .cursorrules",
    "risk-review": "Справедливость: ясность, YAGNI, безопасность, проверяемость",
    readiness: "Суд: ворота в Хобби или Продакшен",
    "release-plan": "Тройка жезлов: тип продукта, канал, что требует «да»",
    "quality-audit": "Звезда: только существующие тесты и сборки",
    "security-audit": "Туз мечей: секреты, ввод, зависимости — отчёт, не патч",
    package: "Тройка пентаклей: артефакт + откат; публикация только после «да»",
    docs: "Отшельник: README / заметки / установка / откат по делу",
    operations: "Умеренность: логи, бэкап, поддержка, сбой",
    "release-gate": "Справедливость: выпускать только если проверки зелёные",
    launch: "Солнце: сначала план; публиковать только после явного «да»",
  },
};

const P = {
  en: {
    problem: `State the target audience, the observable problem, the current workaround, and a testable hypothesis. Analysis only — no product, no code.

Mark unknowns as assumptions. Do not invent users, quotes, or market size.

Output:
- Who
- Problem (observable)
- Workaround today
- Hypothesis (if we ship X, Y will happen)
- Open questions

Next card: Evidence plan.`,
    "evidence-plan": `Pick the cheapest way to test the hypothesis. Write the success metric, threshold, deadline, and stop/pivot rule BEFORE any experiment.

Do not treat AI research as external proof. Interviews, waitlist signups, clicks, and preorders count. Opinions in this chat do not.

Output:
- Method (interview / landing / fake door / preorder / other)
- Metric + threshold + date
- What FAIL means
- What the human must do

Do not start coding the product.`,
    interview: `Prepare non-leading interview questions, or analyze answers the user actually provided.

Forbidden: inventing respondents, quotes, or "typical users". If no real answers exist, output only the question list and how to run the talks.

If real notes exist: pains, current tools, willingness to pay, disconfirming evidence.

Next: Market (if still missing) or Verdict (if enough talks exist).`,
    market: `Map competitors, substitutes, licenses, and reusable references. Competitors are a market signal, not an automatic fail.

If you cannot browse the web, ask for sources instead of guessing GitHub/npm names.

For each reference: what it does, license, risk of reuse, what NOT to copy.

Do not dump or paste third-party code.`,
    experiment: `Design the smallest smoke / fake-door / waitlist experiment using the threshold already written in the evidence plan. Do not invent a new success bar after the fact.

Change files only if the user explicitly asked to create the landing/asset. Otherwise describe copy, layout, and how to count results.

No payment integration, no production deploy.`,
    "evidence-review": `Judge ONLY evidence the user actually provided (notes, counts, links). Missing evidence is a gap, not a pass.

Do not invent subscriber counts. A number without a source is FAIL.

End with exactly these two lines (choose PASS or FAIL, and a known stock id):
KEYCODE_GATE: PASS
KEYCODE_NEXT: spec-v1/brief

or:
KEYCODE_GATE: FAIL
KEYCODE_NEXT: validate-v1/pivot`,
    pivot: `Using the failed criterion, shrink audience, problem, or channel. Keep collected facts. Do not throw away interviews.

Output: what stays true · what changes · new hypothesis · next evidence plan.

Do not write product code.`,
    "validation-cycle": `Run the validation loop with what is already known: problem → evidence plan → available interviews/market/experiment.

Stop and ask the human wherever real-world data is required. Do not fabricate that data.

Give a final gate ONLY if real evidence exists. Then end with:
KEYCODE_GATE: PASS
KEYCODE_NEXT: spec-v1/brief

or:
KEYCODE_GATE: FAIL
KEYCODE_NEXT: validate-v1/pivot`,
    "validate-summary": `Read this chat. Do not write or change code. Do not invent evidence.

Reply in four short blocks (1–3 bullets each):
1. Hypothesis
2. Evidence (only what exists)
3. Gaps
4. Next step (name Problem / Evidence plan / Interview / Market / Experiment / Verdict / Pivot)

No KEYCODE_SCORE, KEYCODE_GATE, or KEYCODE_NEXT lines.`,
    brief: `Turn the confirmed hypothesis into a product brief: goal, users, key stories, measurable outcome.

Do not start implementation. If validation never passed, say so and recommend the Validation deck.

Output: goal · users · stories · success metric · constraints.`,
    scope: `Freeze MVP: IN / OUT, one happy path, acceptance criteria, deferred features.

YAGNI: cut anything not needed for the first real user path. No code.`,
    ux: `Describe screens, controls, empty/loading/error states, and navigation in text.

Do not generate image/figma files unless the user asked. Keep it implementable.`,
    "data-contracts": `Define entities, validation, storage, and external contracts ONLY if this project needs them.

Do not invent a database, REST API, Prisma, or tRPC for a local/desktop app that does not need them. If none needed, say so and list what is stored where.`,
    architecture: `Read the repo and existing dependencies first. Propose the simplest structure and stack that fits.

Record risks and a rollback idea. Prefer boring working software over a fashionable architecture.`,
    "project-rules": `Inspect existing AGENTS.md and .cursor/rules/*.mdc. Propose the smallest non-conflicting updates.

Do not create a legacy .cursorrules file by default. Do not duplicate rules already written. Ask before writing files if the user did not request edits.`,
    "risk-review": `Review the specification for clarity, completeness, YAGNI, safety, and testability.

Project quality score 0–10: below 7 must be fixed before coding.

Always end with this exact line (N = 0-10):
KEYCODE_SCORE: N

If score < 7, name the one spec card that should run next.`,
    readiness: `Check that goal, scope, UX, needed contracts, architecture, acceptance, and rollback exist.

Do not guess Hobby vs Production if the user has not chosen.

End with:
KEYCODE_GATE: PASS
KEYCODE_NEXT: lazy-v1/plan

or (if they already chose production):
KEYCODE_GATE: PASS
KEYCODE_NEXT: pro-v1/plan

or:
KEYCODE_GATE: FAIL
KEYCODE_NEXT: spec-v1/brief

(replace brief with the one missing spec card id if you know it).`,
    "spec-summary": `Read this chat. Do not write or change code.

Four short blocks:
1. Goal
2. Decided
3. Open
4. Next step (name a Specification card, or Work · Hobby / Work · Production)

No KEYCODE_SCORE / GATE / NEXT lines.`,
    "release-plan": `Choose a release profile from the actual project: desktop / web / mobile / open source (or say unknown).

List channel, release criteria, and actions that need an explicit human yes (publish, signing, production migrate, store upload).

Do not assume Vercel, Stripe, Docker, or npm.`,
    "quality-audit": `Find and run only existing relevant builds/tests/linters in this repo. Do not invent npm/Docker/CI.

Show real command output. Score 0–10 from those facts.

Always end with:
KEYCODE_SCORE: N

If red or score < 7, say the next step is Production work card Fix.`,
    "security-audit": `Read-only security review: secrets, input validation, dependency risk, privacy. Prioritize findings with evidence.

Do not apply patches. Do not print secret values.

If a critical issue exists, end with:
KEYCODE_GATE: FAIL
KEYCODE_NEXT: pro-v1/fix

Otherwise say no critical blockers and continue to Package.`,
    package: `Prepare the package/deploy artifact and rollback for the chosen profile.

Installs, DB migrations, code signing, store upload, and production commands require an explicit user yes. Stop and ask. Do not publish.`,
    docs: `Update only relevant README, release notes, install/upgrade/rollback text. Do not create extra documents nobody asked for.`,
    operations: `Minimal ops: logs, errors, backups, support, incident response. Suggest external services only after the user picks them.`,
    "release-gate": `Check build/tests, critical security, docs, rollback, and remaining manual steps.

End with:
KEYCODE_GATE: PASS
KEYCODE_NEXT: release-v1/launch

or:
KEYCODE_GATE: FAIL
KEYCODE_NEXT: pro-v1/fix`,
    launch: `First list the launch actions, risks, and rollback. Do not publish, upload, or ship until the user clearly says to do it.

After a confirmed launch, verify the artifact/availability if possible.

Then recommend Validation → Verdict using real feedback (not a new invented idea). If launch happened, you may end with:
KEYCODE_NEXT: validate-v1/evidence-review`,
    "release-summary": `Read this chat. Do not publish anything. Do not change production.

Four short blocks:
1. Ready
2. Blockers
3. Rollback
4. Next step

No KEYCODE_SCORE line.`,
  },
  ru: {
    problem: `Сформулируй целевую аудиторию, наблюдаемую проблему, текущий обходной путь и проверяемую гипотезу. Только анализ — без продукта и кода.

Неизвестное помечай как допущение. Не выдумывай пользователей, цитаты и размер рынка.

Вывод:
- Кто
- Проблема (наблюдаемая)
- Как решают сейчас
- Гипотеза (если сделаем X, случится Y)
- Открытые вопросы

Дальше: План проверки.`,
    "evidence-plan": `Выбери самый дешёвый способ проверить гипотезу. Запиши метрику, порог успеха, срок и правило стоп/поворот ДО эксперимента.

Исследование ИИ — не внешнее доказательство. Интервью, заявки, клики, предзаказы — да. Мнения в этом чате — нет.

Вывод:
- Метод (интервью / лендинг / fake door / предзаказ / другое)
- Метрика + порог + дата
- Что значит FAIL
- Что должен сделать человек

Код продукта не пиши.`,
    interview: `Подготовь не наводящие вопросы для интервью или разбери ответы, которые пользователь реально прислал.

Запрещено: выдумывать респондентов, цитаты и «типичных пользователей». Нет реальных ответов — только список вопросов и как проводить разговоры.

Если заметки есть: боли, текущие инструменты, готовность платить, опровергающие факты.

Дальше: Рынок (если ещё нет) или Вердикт (если разговоров достаточно).`,
    market: `Карта конкурентов, замен, лицензий и референсов. Конкуренты — сигнал рынка, не автоматический провал.

Нет доступа в веб — попроси источники, не угадывай имена GitHub/npm.

На каждый референс: что делает, лицензия, риск переиспользования, что НЕ копировать.

Чужой код не вставляй.`,
    experiment: `Собери самый маленький smoke / fake-door / лист ожидания по порогу из плана проверки. Не меняй порог задним числом.

Файлы меняй только если пользователь явно попросил создать лендинг/актив. Иначе опиши тексты, макет и как считать результат.

Без платежей и production-деплоя.`,
    "evidence-review": `Оцени ТОЛЬКО доказательства, которые пользователь реально дал (заметки, числа, ссылки). Нет факта — это пробел, не PASS.

Не выдумывай число подписчиков. Число без источника = FAIL.

В конце ровно две строки (выбери PASS или FAIL и известный id):
KEYCODE_GATE: PASS
KEYCODE_NEXT: spec-v1/brief

или:
KEYCODE_GATE: FAIL
KEYCODE_NEXT: validate-v1/pivot`,
    pivot: `По проваленному критерию сузь аудиторию, проблему или канал. Собранные факты сохрани. Интервью не выбрасывай.

Вывод: что остаётся верным · что меняем · новая гипотеза · следующий план проверки.

Код продукта не пиши.`,
    "validation-cycle": `Пройди цикл валидации на том, что уже известно: проблема → план проверки → доступные интервью/рынок/эксперимент.

Стой и спрашивай человека, где нужны реальные данные. Эти данные не выдумывай.

Финальный gate — только если есть реальные доказательства. Тогда в конце:
KEYCODE_GATE: PASS
KEYCODE_NEXT: spec-v1/brief

или:
KEYCODE_GATE: FAIL
KEYCODE_NEXT: validate-v1/pivot`,
    "validate-summary": `Прочитай этот чат. Код не пиши и не меняй. Доказательства не выдумывай.

Четыре коротких блока (по 1–3 пункта):
1. Гипотеза
2. Доказательства (только что есть)
3. Пробелы
4. Следующий шаг (назови Проблема / План проверки / Интервью / Рынок / Эксперимент / Вердикт / Поворот)

Строк KEYCODE_SCORE, KEYCODE_GATE и KEYCODE_NEXT не добавляй.`,
    brief: `Преврати подтверждённую гипотезу в бриф: цель, пользователи, ключевые сценарии, измеримый результат.

Реализацию не начинай. Если валидация не пройдена — так и скажи, рекомендуй колоду Валидация.

Вывод: цель · пользователи · сценарии · метрика успеха · ограничения.`,
    scope: `Зафиксируй MVP: IN / OUT, один счастливый путь, критерии приёмки, отложенные функции.

YAGNI: вырежи всё, без чего первый реальный путь не обязателен. Код не пиши.`,
    ux: `Опиши экраны, кнопки, состояния пусто/загрузка/ошибка и навигацию текстом.

Картинки/figma не генерируй, пока не попросили. Должно быть реализуемо.`,
    "data-contracts": `Определи сущности, валидацию, хранение и внешние контракты ТОЛЬКО если проекту это нужно.

Не навязывай БД, REST, Prisma или tRPC локальному/desktop приложению без нужды. Если не нужно — так и напиши, где что хранится.`,
    architecture: `Сначала прочитай репозиторий и текущие зависимости. Предложи самую простую структуру и стек, которые подходят.

Зафиксируй риски и идею отката. Скучное рабочее лучше модной архитектуры.`,
    "project-rules": `Проверь существующие AGENTS.md и .cursor/rules/*.mdc. Предложи минимальные непротиворечивые правки.

Legacy .cursorrules по умолчанию не создавай. Уже написанные правила не дублируй. Файлы меняй только по просьбе.`,
    "risk-review": `Оцени спецификацию: ясность, полнота, YAGNI, безопасность, проверяемость.

Балл оценки проекта 0–10: ниже 7 — чинить до кода.

В самом конце обязательно:
KEYCODE_SCORE: N

Если балл < 7, назови одну карту спецификации, которую запустить следующей.`,
    readiness: `Проверь, что есть цель, scope, UX, нужные контракты, архитектура, приёмка и откат.

Не угадывай Хобби vs Продакшен, если пользователь не выбрал.

В конце:
KEYCODE_GATE: PASS
KEYCODE_NEXT: lazy-v1/plan

или (если уже выбран продакшен):
KEYCODE_GATE: PASS
KEYCODE_NEXT: pro-v1/plan

или:
KEYCODE_GATE: FAIL
KEYCODE_NEXT: spec-v1/brief

(brief замени на id недостающей карты спецификации, если знаешь).`,
    "spec-summary": `Прочитай этот чат. Код не пиши и не меняй.

Четыре коротких блока:
1. Цель
2. Принято
3. Открыто
4. Следующий шаг (карта Спецификации или Работа · Хобби / Работа · Продакшен)

Строк KEYCODE_SCORE / GATE / NEXT не добавляй.`,
    "release-plan": `Выбери профиль релиза по реальному проекту: desktop / web / mobile / open source (или скажи, что неизвестно).

Канал, критерии релиза и действия, которым нужно явное «да» человека (публикация, подпись, миграция production, загрузка в магазин).

Не предполагай Vercel, Stripe, Docker или npm.`,
    "quality-audit": `Найди и запусти только существующие сборки/тесты/линтеры в этом репозитории. Не выдумывай npm/Docker/CI.

Покажи реальный вывод команд. Балл 0–10 по фактам.

В конце:
KEYCODE_SCORE: N

Если красный или балл < 7, следующий шаг — карта Фикс в колоде Продакшен.`,
    "security-audit": `Только чтение: секреты, валидация ввода, риск зависимостей, приватность. Приоритеты с доказательствами.

Патчи не применяй. Значения секретов не печатай.

Если есть критичное:
KEYCODE_GATE: FAIL
KEYCODE_NEXT: pro-v1/fix

Иначе напиши, что критичных блокеров нет, дальше Сборка.`,
    package: `Подготовь пакет/деплой и откат под выбранный профиль.

Установки, миграции БД, подпись, загрузка в магазин и production-команды — только после явного «да». Стой и спроси. Не публикуй.`,
    docs: `Обнови только уместные README, заметки релиза, установку/обновление/откат. Лишние документы не плоди.`,
    operations: `Минимум эксплуатации: логи, ошибки, бэкапы, поддержка, реакция на сбой. Внешние сервисы — только после выбора пользователя.`,
    "release-gate": `Проверь сборку/тесты, критичную безопасность, документы, откат и оставшиеся ручные шаги.

В конце:
KEYCODE_GATE: PASS
KEYCODE_NEXT: release-v1/launch

или:
KEYCODE_GATE: FAIL
KEYCODE_NEXT: pro-v1/fix`,
    launch: `Сначала список действий запуска, риски и откат. Не публикуй, не загружай и не выкатывай, пока пользователь явно не сказал сделать это.

После подтверждённого запуска проверь артефакт/доступность, если можно.

Дальше рекомендуй Валидация → Вердикт по реальной обратной связи (не новую выдуманную идею). Если запуск состоялся, можно закончить:
KEYCODE_NEXT: validate-v1/evidence-review`,
    "release-summary": `Прочитай этот чат. Ничего не публикуй и production не меняй.

Четыре коротких блока:
1. Готово
2. Блокеры
3. Откат
4. Следующий шаг

Строку KEYCODE_SCORE не добавляй.`,
  },
};

function card(id, loc, image, hotkey, promptKey) {
  const promptLoc = loc === "ru" ? "ru" : "en";
  return {
    id,
    title: tmap(TITLES[id], loc),
    description: (DESC[loc] && DESC[loc][id]) || DESC.en[id],
    prompt: P[promptLoc][promptKey || id],
    image,
    hotkey,
  };
}

function deckValidate(loc) {
  return {
    id: "validate-v1",
    name: tmap(NAMES["validate-v1"], loc),
    cards: [
      card("problem", loc, "fool", "F1"),
      card("evidence-plan", loc, "hierophant", "F2"),
      card("interview", loc, "cups_02", "F3"),
      card("market", loc, "wheel_of_fortune", "F4"),
      card("experiment", loc, "magician", "F5"),
      card("evidence-review", loc, "justice", "F6"),
      card("pivot", loc, "hanged_man", "F7"),
      card("validation-cycle", loc, "world", "F8"),
      card("summary", loc, "high_priestess", "", "validate-summary"),
    ],
  };
}

function deckSpec(loc) {
  return {
    id: "spec-v1",
    name: tmap(NAMES["spec-v1"], loc),
    cards: [
      card("brief", loc, "emperor", "F1"),
      card("scope", loc, "swords_02", "F2"),
      card("ux", loc, "cups_ace", "F3"),
      card("data-contracts", loc, "pentacles_ace", "F4"),
      card("architecture", loc, "chariot", "F5"),
      card("project-rules", loc, "hierophant", "F6"),
      card("risk-review", loc, "justice", "F7"),
      card("readiness", loc, "judgement", "F8"),
      card("summary", loc, "high_priestess", "", "spec-summary"),
    ],
  };
}

function deckRelease(loc) {
  return {
    id: "release-v1",
    name: tmap(NAMES["release-v1"], loc),
    cards: [
      card("release-plan", loc, "wands_03", "F1"),
      card("quality-audit", loc, "star", "F2"),
      card("security-audit", loc, "swords_ace", "F3"),
      card("package", loc, "pentacles_03", "F4"),
      card("docs", loc, "hermit", "F5"),
      card("operations", loc, "temperance", "F6"),
      card("release-gate", loc, "justice", "F7"),
      card("launch", loc, "sun", "F8"),
      card("summary", loc, "high_priestess", "", "release-summary"),
    ],
  };
}

const FULLCYCLE_TAIL_EN =
  "\n\nIf the approved scope is fully done and checks are green, also end with:\nKEYCODE_GATE: PASS\nKEYCODE_NEXT: release-v1/release-plan\n\nIf not done or checks are red:\nKEYCODE_GATE: FAIL";
const FULLCYCLE_TAIL_RU =
  "\n\nЕсли утверждённый scope полностью закрыт и проверки зелёные, также добавь:\nKEYCODE_GATE: PASS\nKEYCODE_NEXT: release-v1/release-plan\n\nЕсли не готово или проверки красные:\nKEYCODE_GATE: FAIL";

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

for (const loc of locales) {
  const dir = path.join(root, "data", "locales", loc);
  writeJson(path.join(dir, "validate-v1.json"), deckValidate(loc));
  writeJson(path.join(dir, "spec-v1.json"), deckSpec(loc));
  writeJson(path.join(dir, "release-v1.json"), deckRelease(loc));

  for (const id of ["lazy-v1", "pro-v1"]) {
    const file = path.join(dir, `${id}.json`);
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    d.name = tmap(NAMES[id], loc);
    const full = (d.cards || []).find((c) => c.id === "fullcycle");
    if (full && full.prompt && !full.prompt.includes("KEYCODE_NEXT: release-v1/release-plan")) {
      full.prompt += loc === "ru" ? FULLCYCLE_TAIL_RU : FULLCYCLE_TAIL_EN;
    }
    writeJson(file, d);
  }
}

console.log("wrote phase decks for", locales.length, "locales");
