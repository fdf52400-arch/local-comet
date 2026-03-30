# Computer-First Redesign — Local Comet

## Обзор изменений

Радикальный редизайн UX: убран URL-first сценарий, вместо него — один главный ввод на естественном языке. Пользователь пишет «открой google», «найди в google нейросети 2026», «открой github» — и приложение немедленно выполняет команду без копирования URL.

## Что изменилось

### 1. Новый файл: `client/src/lib/intent-parser.ts`
Локальный движок распознавания команд на фронтенде:
- **15+ встроенных сайтов** с алиасами на русском и английском: Google, YouTube, GitHub, Grok, Perplexity, Twitter/X, Reddit, Wikipedia, Hacker News, Habr, Gmail, Яндекс, StackOverflow, ChatGPT, Claude
- **8 поисковых движков** с шаблонами URL: Google, YouTube, GitHub, Reddit, Wikipedia, Яндекс, StackOverflow, Perplexity
- **Паттерны команд**: `открой`, `зайди на`, `перейди`, `open`, `go to`, `найди`, `найди в`, `search`, `find`
- **Каскадный парсинг**: поиск → открытие сайта → URL → агентская задача
- Экспортируемые массивы `EXAMPLE_COMMANDS`, `CAPABILITIES`, `KNOWN_SITES`

### 2. Переделан: `client/src/pages/control-center.tsx`
Полная переработка главного экрана:

#### Убрано:
- URL-first omnibox на главном экране
- URL-field как обязательный элемент для запуска
- Крупный блок настроек модели на главном экране
- Режим Chat как дефолтный

#### Добавлено:
- **Единая командная строка** (Command Bar) — главный элемент с `CommandIcon`, placeholder «Напишите команду: «открой google», «найди в google …», или любую задачу»
- **Computer — дефолтный режим** сайдкара (был Chat)
- **Intent parsing при Enter** — команда парсится через `parseIntent()`:
  - `open_site` / `navigate_url` → сразу `handleManualAction("navigate", { url })` в browser pane
  - `search` → формируется URL поиска, навигация
  - `agent_task` → запуск агента через `runMutation`
- **5 примеров-команд** на пустом экране: «открой google», «открой github», «найди в google нейросети 2026», «открой youtube», «открой сайт habr.com»
- **5 capabilities** под примерами: Открыть сайт, Поиск, Исследовать страницу, Выполнить задачу, Суммаризировать
- Кнопка сайдкара переименована «Computer» (вместо «Assistant»)
- Заголовок сайдкара — «Computer» с иконкой MonitorSmartphone

#### Настройки модели:
- **Свёрнуты по умолчанию** (expanded: false)
- Показывают только строку «Настройки модели» + значок модели
- Раскрываются по клику, содержат: провайдер, URL, порт, модель, safety mode
- Визуально вторичны — мелкий текст, без акцента

#### Вкладки сайдкара:
- Порядок: **Computer** (1st, default) → Chat → Research
- Chat сохранён как вторичный режим с ручным URL + goal
- Research сохранён без изменений

### 3. Не изменены:
- `server/routes.ts` — все API эндпоинты работают
- `server/agent-engine.ts`, `server/provider-gateway.ts`, `server/task-queue.ts`, `server/event-bus.ts`
- `shared/schema.ts` — схема БД без изменений
- `client/src/index.css` — стили без изменений
- `client/src/App.tsx` — роутинг без изменений
- `client/src/pages/settings.tsx` — страница настроек без изменений

## Сценарий «открой google»

1. Пользователь вводит `открой google` в командную строку
2. Нажимает Enter (или кнопку Send)
3. `parseIntent("открой google")` возвращает: `{ type: "open_site", url: "https://www.google.com", label: "Открыть Google", confidence: 0.95 }`
4. Фронтенд вызывает `handleManualAction("navigate", { url: "https://www.google.com" })`
5. В сайдкаре появляется лог: `[Computer] Навигация: Открыть Google`
6. Бэкенд выполняет навигацию в headless-браузере
7. Скриншот Google появляется в основном browser pane

Аналогично работают:
- `открой grok` → https://grok.com
- `открой github` → https://github.com
- `найди в google машинное обучение` → https://www.google.com/search?q=...
- `открой сайт habr.com` → https://habr.com

## QA Screenshots

- `screenshots/computer-first-main.png` — главный экран с командной строкой и примерами
- `screenshots/computer-first-chat-mode.png` — вторичный Chat режим
- `screenshots/computer-first-settings-expanded.png` — раскрытые настройки модели
- `screenshots/computer-first-command-typed.png` — команда «открой google» в строке ввода
- `screenshots/computer-first-advanced-tools.png` — секция доп. инструментов
- `screenshots/computer-first-light-theme.png` — светлая тема

## Готовность к деплою

- ✅ `npm run build` проходит без ошибок
- ✅ Production build в `dist/`
- ✅ Dev server работает
- ✅ Все существующие API эндпоинты сохранены
- ✅ Тёмная и светлая темы работают
- ✅ Проект готов к локальной проверке и повторному публичному деплою
