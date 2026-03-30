# Local Comet — Comet-style UX Redesign Summary

## Дата: 2026-03-30

## Обзор изменений

Полная переработка главного интерфейса Local Comet в стиле Comet: browser-like shell с правой AI-sidecar панелью. Бэкенд, API, и вся бизнес-логика не затронуты.

---

## Архитектура нового интерфейса

### 1. Browser Tab Bar (верхняя полоса)
- **Traffic light buttons** (красный/жёлтый/зелёный) — визуальный маркер «это браузер»
- **Вкладки** — переключение между browser tabs (как в Chrome)
- **Кнопка «+»** — создание новой вкладки
- **Статус-индикаторы** — SRV (сервер), количество задач в очереди
- **Переключатель темы** (светлая/тёмная)

### 2. Toolbar (панель инструментов)
- **Back / Forward / Reload** — кнопки навигации по истории
- **Omnibox** (умная адресная строка):
  - Ввод URL → автоматическая навигация в Browser
  - Ввод текста → автоматическая постановка задачи агенту
  - Объединяет адресную строку и командную строку
- **Кнопка Assistant** — открытие/скрытие правой sidecar-панели

### 3. Browser Viewport (центральная область)
- **Live Preview** — скриншот текущей страницы агента с реальным временем
- **Floating phase indicator** — текущая фаза агента поверх preview (при работе)
- **URL overlay** — отображение текущего URL внизу viewport
- **Empty state / Onboarding** — при отсутствии preview:
  - Логотип Local Comet
  - Объяснение: «Введите URL или дайте команду ассистенту»
  - 4 карточки Quick Start (Суммаризировать, Исследовать, Найти форму, План действий)
  - Схема цикла: observe → reason → act → re-observe

### 4. Right Sidecar — Assistant / Computer Panel
Правая панель шириной 360px, переключаемая кнопкой «Assistant».

#### Заголовок
- Иконка + «Assistant»
- Бейдж режима безопасности (Только чтение / Подтверждение / Полный доступ)
- Кнопка скрытия панели

#### Режимы (табы)
- **Chat** — основной режим: URL + задача + запуск + быстрые действия + лог
- **Research** — режим исследования: запрос → агент анализирует несколько источников
- **Computer** — режим Computer:
  - Цель задачи
  - Текущий шаг агента
  - Что агент видит (DOM-статистика)
  - Что собирается сделать
  - Лог действий

#### Быстрые действия
4 кнопки: Суммаризировать, Исследовать, Действовать, Перевести

#### История / Event Log
Прокручиваемый лог SSE-событий с цветовой кодировкой по типу

### 5. Блок подключения локальной модели
Всегда видимый в нижней части sidecar (сворачиваемый):
- **Заголовок** «Локальная модель» с иконкой, бейджем провайдера и модели
- **Переключатель провайдера**: Ollama / LM Studio (toggle buttons)
- **Base URL** — поле ввода (http://localhost)
- **Порт** — поле ввода (11434 / 1234)
- **Подсказка** по стандартному порту
- **Модель** — поле ввода или Select (если модели загружены)
- **Режим безопасности** — Select (Только чтение / Подтверждение / Полный доступ)
- **3 кнопки действий**:
  - ⚡ Проверить — проверка подключения
  - ↻ Модели — загрузка списка моделей
  - 💾 Сохранить — сохранение настроек
- **Статусное сообщение** — результат проверки (зелёный/красный)

### 6. Вторичные инструменты (скрытые в drawer)
Кнопка «Доп. инструменты» раскрывает:
- Очередь и история задач
- Workspace / Session информация
- Кнопки: создать Workspace, создать Сессию, Экспорт

### 7. Replay — теперь overlay/drawer
Replay переехал из правой панели в модальный overlay. Вызывается по клику на задачу в истории.

---

## Что было удалено с первого экрана (спрятано или перемещено)
- **Левая sidebar** со списком workspaces / sessions / scenarios — перемещена в «Доп. инструменты» и карточки empty state
- **Preview / DOM / Action / Replay / Inspector** tabs в правой панели — заменены на Chat / Research / Computer
- **Inspector panel** — убран в глубину (доступен через API)
- **DOM Snapshot panel** — данные доступны через Computer mode
- **Action Console** — интегрирован через omnibox + быстрые действия

---

## Файлы изменены
| Файл | Описание |
|------|----------|
| `client/src/pages/control-center.tsx` | Полная переработка: новый layout, sidecar, omnibox, model connection block |
| `REDESIGN-SUMMARY.md` | Этот документ |

## Файлы НЕ изменены (бэкенд сохранён)
- `server/routes.ts`
- `server/agent-engine.ts`
- `server/task-queue.ts`
- `server/event-bus.ts`
- `server/provider-gateway.ts`
- `server/storage.ts`
- `shared/schema.ts`
- `client/src/App.tsx` (маршруты сохранены)
- `client/src/pages/settings.tsx` (доступна как fallback по /#/settings)
- `client/src/index.css` (палитра и стили сохранены)

---

## Критерий успеха (проверка)

✅ **Это браузер** — Tab bar, traffic lights, omnibox, back/forward/reload  
✅ **Справа AI-помощник** — Sidecar с Chat/Research/Computer  
✅ **Можно подключить Ollama/LM Studio** — Видимый блок с toggle, URL, порт, модель, 3 кнопки  
✅ **Можно дать команду агенту** — Omnibox + поле задачи + быстрые действия  
✅ **Похоже на Comet** — Browser shell + sidecar, а не dev-панель  
✅ **Понятно за 5 секунд** — Onboarding empty state, карточки быстрого старта

---

## Скриншоты
- `screenshots/redesign-main.png` — Главный экран с sidecar (Chat mode)
- `screenshots/redesign-computer.png` — Computer mode
- `screenshots/redesign-research.png` — Research mode
- `screenshots/redesign-advanced.png` — Развёрнутые доп. инструменты
- `screenshots/redesign-no-sidecar.png` — Без sidecar (чистый browser view)
- `screenshots/redesign-chat-mode.png` — Chat mode с URL в omnibox
