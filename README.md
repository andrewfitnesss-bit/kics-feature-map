# Редактор описаний v88

Окно карточки расширено до 1240 px, поле описания — от 380 px по высоте.
Есть заголовки, списки, отступы, цитаты/код, таблица, ссылки, изображения,
отмена/повтор и Ctrl+Enter для сохранения. Вставка HTML очищается по разрешённому
набору тегов; скрипты, обработчики событий, iframe и небезопасные URL удаляются.
Не все стили Word/TFS воспроизводятся: сохраняется структурная разметка,
а не точная копия произвольного оформления. Shift+Tab выводит фокус из редактора.

Хранение: `note` — текст для поиска/AI, `noteHtml` — очищенный HTML,
`noteHtmlText` — соответствующий текст, `noteFormat` — `html-v1`.
JSON экспорт/импорт и существующий payload сохраняют эти поля; SQL не меняется.
При несовпадении `note` и `noteHtmlText` показывается обычный текст, чтобы старый
HTML не перекрыл замену через AI. Для будущего импортера предусмотрен
`KicsRich.assignHtml(node, html, sourceBaseURL)` с разрешением относительных URL.
Коннектор TFS и скачивание его защищённых вложений пока не реализованы.

Картинки: HTTPS URL либо PNG/JPEG/GIF/WebP файл до 500 КБ; встроенные файлы
увеличивают JSON таблицы. На описание установлен предел 1,5 млн символов HTML.
Внешние картинки загружаются с исходного сервера и требуют доступной ссылки.
Для большого числа вложений потребуется отдельное файловое хранилище.

Редактор без новых зависимостей использует contenteditable/execCommand;
последний API устаревающий, поэтому браузерные регрессионные тесты обязательны.
Проверен Chrome; полного кросс-браузерного прогона пока нет.

# Майндкарта v84

Новый редактор использует те же карточки, что и таблица. Доступны стабильная
раскладка вправо/в обе стороны, плотность, поиск по названию/описанию/тегам,
фильтр статуса, фокус на ветке, раскрытие до уровня, миникарта и SVG-экспорт
видимой структуры. Камера, раскладка и свёрнутые ветки сохраняются локально
отдельно для аккаунта и таблицы.

Клик выбирает карточку, Shift+клик — несколько. Правая панель показывает
описание, заметку и сводку ветки. F2 переименовывает, Tab создаёт дочернюю,
Enter — соседнюю карточку, стрелки перемещают выбор (когда фокус на холсте).
Перетаскивание на карточку меняет родителя после подтверждения. Недопустимые
циклы и выход за колонки запрещены. Для нового уровня сначала добавьте колонку
на доске. Статус и горизонт можно менять сразу у выбранных карточек.

Отмена/повтор относятся к операциям редактора карты, максимум 30 шагов за
сеанс; при внешнем изменении данных история сбрасывается во избежание потерь.
AI может заполнить только пустые описания выбранной ветки; анализ пробелов и
дублей доступен через «ИИ для карточки» и ничего не применяет автоматически.

Проверки: `node --test mindmap.test.cjs ai.test.cjs` и
`node mindmap.browser-test.cjs` (Chrome; путь можно задать через CHROME_PATH).
Браузерный тест изолирован от Supabase и платных API.

Ограничения: нет виртуализации, произвольных поперечных связей и совместного
редактирования в реальном времени. SVG экспортирует видимые названия и линии,
а не полное содержимое описаний. Поиск карты независим от фильтров доски.

# v78: targeted documentation search

In AI → Analyze documentation, enter the documentation URL and product/version. The URL selects a search domain, not a five-page crawl. Before each action, OpenRouter searches that domain for evidence; the selected generation model receives that evidence. Bulk descriptions search separately for each empty card. An OpenRouter key is required even when general web search is disabled (store it using proxy settings). No citations means the action stops rather than silently inventing documentation. This uses external indexed search, not Kaspersky's internal search API; completeness and immediate indexing are not guaranteed. Up to eight relevant results per search are budgeted, not the first eight links in the documentation. Redeploy ai-proxy and publish frontend v78; no new SQL migration beyond v77.

# v77: security migration (required before deploying the frontend)

1. Back up the database. Run `ai_schema.sql` only on a new installation, then run `ai_security.sql` in the SQL editor. Existing credentials are migrated into Vault transactionally; plaintext rows are removed. Do not re-run the legacy credential schema afterwards.
2. Set the Edge secret `AI_ALLOWED_HOSTS` to a comma-separated list of **trusted exact domain names** for documentation and custom API endpoints. Unlisted domains fail closed. Approve only domains you control or trust; DNS checks do not replace network-level egress restrictions against DNS rebinding.
3. Deploy `ai-proxy` and `fetch-url` from this directory using `supabase functions deploy NAME --project-ref bqddhtamnpgkrrhrvudy`.
4. Deploy the frontend and refresh the browser. Proxy keys persist in Vault; direct-mode keys stay in memory and must be re-entered after reload.

Documentation ingestion follows at most four additional same-origin links. HTML/plain text only; PDF and JavaScript-rendered pages require a text/HTML export. This is a bounded collection, not an exhaustive documentation audit. Context is scoped to account and map; remove it in AI settings. Search uses the OpenRouter model even when another provider is selected; reasoning and proxy now apply to that route too.

Local checks: `node --test ai.test.cjs`, `node _audit_v63.js`, and `node --check` on frontend JavaScript. SQL and Deno deployment must also be validated against a staging project before production.

# KICS Feature Map (v66)

Инструмент планирования фич для PM. Одна рабочая версия с облачным
сохранением в Supabase.

## Деплой

1. В Supabase → SQL Editor выполни `schema.sql` (создаёт таблицу
   `public.maps_next` с RLS).
2. Для переноса данных из старой версии выполни `migrate_legacy.sql`
   (копирует `public.maps` → `public.maps_next`, старые данные побеждают
   конфликты).
3. Укажи `url` и `anonKey` в `config.js`.
4. Разверни каталог на GitHub Pages.

## Заметки

- Заметка карточки — это отдельный узел в последней колонке; на карточке
  показывается маленьким значком справа внизу (подпись «to do» при
  наведении), редактор открывается из меню карточки (⋮ → «Заметка»).
- Сворачивание ветки — компактный переключатель внизу карточки со
  счётчиком скрытых элементов.
- «Отменить» в шапке восстанавливает последний снимок удаления.

## ИИ-инструменты (v75)

Кнопка «✨ ИИ» в шапке и пункт «ИИ…» в меню карточки. Работает в двух режимах:

- **Клиентский BYOK** (по умолчанию): API-ключ хранится в `localStorage` и
  отправляется напрямую провайдеру. Работает для OpenRouter и Anthropic;
  OpenAI и DeepSeek блокируют CORS — для них включи прокси.
- **Прокси** (галочка «Выполнять через сервер»): ключ хранится в Supabase
  (таблица `ai_credentials`, RLS), запросы идут через Edge Function
  `ai-proxy` (обходит CORS).

Дополнительные режимы точности:

- **Ризонинг** — модель-резонер текущего провайдера (`deepseek-v4-pro`,
  `o3-mini`, `claude-3-7-sonnet-latest`, `deepseek/deepseek-r1`). Для DeepSeek
  включает режим «размышлений» (`thinking`).
- **Веб-поиск** — реальный поиск через OpenRouter (модель с суффиксом
  `:online`). Требует отдельный API-ключ OpenRouter (поле в настройках).
  Когда включён, все действия ищут в интернете и отвечают с учётом свежих
  источников.

Развёртывание ИИ-функций:

1. В Supabase → SQL Editor выполни `ai_schema.sql` (создаёт `ai_credentials`).
2. Установи Supabase CLI и, находясь в папке `kics_map` (там лежит `supabase/`),
   выполни:
   ```
   supabase login
   supabase functions deploy ai-proxy
   supabase functions deploy fetch-url
   ```
   Функции лежат в `supabase/functions/…`; `project_id` уже прописан в
   `supabase/config.toml`, поэтому `--project-ref` указывать не нужно.
   Предупреждение «Docker is not running» можно игнорировать — для деплоя
   функций Docker не нужен (он нужен только для локального `supabase start`).
3. В настройках ИИ выбери провайдера, укажи ключ/модель и (при прокси)
   включи соответствующую галочку — ключ запишется на сервер автоматически.

Действия «по ссылке» используют Edge Function `fetch-url` (браузер не может
обходить CORS сам). Добавить новый ИИ-инструмент можно через
`KicsAI.registerAction({ id, label, scope, needsUrl, buildPrompt, apply })`.

