# Local Comet — Итерация 6

**Версия:** 0.6.0  
**Дата:** 2026-03-30  
**Порт:** 5051 (без изменений)

---

## Новые возможности

### 1. Workspaces (Рабочие пространства)

Поддержка нескольких рабочих пространств (проектов) с изоляцией данных.

- **Создание workspace** — через кнопку «+» в секции WORKSPACES левой панели
- **Переключение** — клик по имени workspace в списке; активный выделен цветом и точкой
- **Workspace по умолчанию** — «Default» создаётся автоматически при первом запуске
- **Привязка данных** — задачи, логи, снимки и вкладки привязаны к активному workspace
- **Индикация** — имя текущего workspace отображается в шапке и в строке сессии

**API-эндпоинты:**
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/workspaces` | Список всех workspace |
| POST | `/api/workspaces` | Создать workspace `{ name, description? }` |
| POST | `/api/workspaces/:id/activate` | Активировать workspace |

### 2. Multi-Tab Session Context (Многовкладочные сессии)

Сессия может содержать несколько логических вкладок, каждая со своим URL, превью, снимком DOM, выбранным элементом и историей.

- **Создание вкладки** — кнопка «+» на панели вкладок (Tab Bar) над рабочей областью
- **Переключение** — клик по вкладке в Tab Bar; активная вкладка выделена цветом
- **Обновление** — URL, snapshot, selectedElement, history обновляются через PATCH
- **Привязка к workspace** — вкладки автоматически получают workspaceId текущего workspace

**API-эндпоинты:**
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/tabs?sessionId=...` | Список вкладок сессии |
| POST | `/api/tabs` | Создать вкладку `{ sessionId, label, url? }` |
| POST | `/api/tabs/:id/activate` | Активировать вкладку |
| PATCH | `/api/tabs/:id` | Обновить вкладку (url, snapshot, selectedElement, history) |

### 3. Workspace-Aware Queue / History

Очередь задач и история фильтруются по активному workspace.

- `GET /api/tasks` — возвращает задачи только текущего active workspace
- `POST /api/agent/run` — новые задачи создаются с workspaceId текущего workspace
- Задачи, логи и шаги привязаны к workspace через поле `workspaceId`

### 4. Session / Tab Inspector (Инспектор контекста)

Новая вкладка **INSPECT** на правой панели, показывающая полное состояние текущей сессии.

- **Workspace** — имя и ID текущего workspace
- **Сессия** — идентификатор текущей сессии
- **Активная вкладка** — label, URL, кол-во вкладок
- **Preview** — URL, syncId, наличие скриншота
- **Snapshot** — количество элементов, заголовок
- **Задачи / Шаги** — счётчики для текущей сессии
- **Выбранный элемент** — данные selected element (если есть)

**API-эндпоинт:**
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/inspector?sessionId=...` | JSON со всеми данными инспектора |

### 5. Экспорт Session / Task в JSON

Экспорт текущей сессии или конкретной задачи через backend endpoint и кнопку в UI.

- **Кнопка «Экспорт сессии (JSON)»** — на панели INSPECT, скачивает JSON файл
- **Формат экспорта** включает: workspace, sessionId, задачи, логи, вкладки, summary
- **Экспорт задачи** — по ID через отдельный endpoint

**API-эндпоинты:**
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/export/session?sessionId=...` | Экспорт полной сессии в JSON |
| GET | `/api/export/task/:id` | Экспорт конкретной задачи в JSON |

---

## Ключевые файлы

| Файл | Изменения |
|------|-----------|
| `shared/schema.ts` | Таблицы `workspaces`, `sessionTabs`; поле `workspaceId` в `agentTasks`, `agentLogs`, `stepSnapshots` |
| `server/storage.ts` | CRUD для workspace/tab, миграции CREATE TABLE IF NOT EXISTS для всех таблиц, методы exportSession/exportTask |
| `server/routes.ts` | Эндпоинты workspace, tab, inspector, export; workspace-aware agent/run и tasks |
| `client/src/pages/control-center.tsx` | WorkspaceSwitcher, TabBar, InspectorPanel, кнопка экспорта |

### Файлы без изменений (сохранены)

- `server/index.ts` — порт 5051, базовая конфигурация
- `server/agent-engine.ts` — логика агента
- `server/task-queue.ts` — очередь задач
- `server/event-bus.ts` — SSE события
- `client/src/App.tsx` — маршрутизация

---

## Проверки (выполнены)

| Проверка | Результат |
|----------|-----------|
| Health check `/api/health` → v0.6.0 | ✅ |
| Создание workspace через API | ✅ |
| Список workspaces (Default + новые) | ✅ |
| Активация/переключение workspace | ✅ |
| Создание workspace через UI (кнопка +) | ✅ |
| Создание вкладки через API | ✅ |
| Список вкладок для сессии | ✅ |
| Активация/переключение вкладок | ✅ |
| Обновление вкладки (URL, snapshot) | ✅ |
| Создание вкладки через UI (кнопка +) | ✅ |
| Inspector — данные отображаются | ✅ |
| Экспорт сессии — JSON с workspace, tasks, logs, tabs | ✅ |
| Экспорт задачи — 404 для несуществующей | ✅ |
| Существующие вкладки (PREVIEW, DOM, ACTION, REPLAY) | ✅ |
| Сценарии (демо-кнопки) | ✅ |
| Интерфейс на русском языке | ✅ |
| Порт 5051 без изменений | ✅ |

---

## Схема данных (новые таблицы)

### workspaces
```
id          INTEGER PRIMARY KEY
name        TEXT NOT NULL
description TEXT DEFAULT ''
isActive    INTEGER DEFAULT 0
createdAt   TEXT DEFAULT (current timestamp)
```

### session_tabs
```
id              INTEGER PRIMARY KEY
workspaceId     INTEGER → workspaces(id)
sessionId       TEXT NOT NULL
label           TEXT NOT NULL
url             TEXT DEFAULT ''
isActive        INTEGER DEFAULT 0
previewState    TEXT DEFAULT '{}'
snapshotJson    TEXT
selectedElement TEXT
historyJson     TEXT DEFAULT '[]'
createdAt       TEXT DEFAULT (current timestamp)
```

### Изменения существующих таблиц
- `agent_tasks` → добавлен `workspaceId INTEGER DEFAULT 1`
- `agent_logs` → добавлен `workspaceId INTEGER DEFAULT 1`
- `step_snapshots` → добавлен `workspaceId INTEGER DEFAULT 1`

---

## Ограничения

1. **Удаление workspace** — не реализовано; workspace «Default» нельзя удалить
2. **Удаление вкладок** — не реализовано в текущей версии
3. **Переименование workspace/tab** — не реализовано через UI
4. **Миграция старых данных** — существующие задачи/логи получают `workspaceId = 1` (Default)
5. **Экспорт** — только в формате JSON; PDF/CSV не поддерживается
6. **Вкладки** — состояние preview/snapshot/history обновляется только через API; автосинхронизация с browser preview не реализована
7. **Лимит вкладок** — нет ограничения на количество вкладок в сессии
