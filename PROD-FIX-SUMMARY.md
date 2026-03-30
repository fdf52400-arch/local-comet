# Local Comet — Production Fix Summary

**Дата диагностики:** 2026-03-30  
**Статус:** ✅ Production запуск работает корректно

---

## Что было найдено

### Изначальная проблема
Сообщение о "missing module" при запуске `node dist/index.cjs` относилось к предыдущему состоянию dist. **В текущем состоянии проект работает корректно** — dist/index.cjs запускается без ошибок и отвечает на запросы.

### Диагностика

| Компонент | Статус | Подробности |
|-----------|--------|-------------|
| `dist/index.cjs` | ✅ | Собран корректно (esbuild, CJS-формат), стартует без ошибок |
| `dist/public/index.html` | ✅ | Пути к ассетам **относительные** (`./assets/...`) — не требуют правки |
| `dist/public/assets/` | ✅ | `index-D5WuqVvQ.js` + `index-B-BHkDqo.css` присутствуют |
| `better-sqlite3` (native) | ✅ | Внешний (externalized в build), загружается из node_modules |
| Порт | ✅ | Сервер слушает `0.0.0.0:5051` по умолчанию |
| API `/api/health` | ✅ | `{"status":"ok","version":"0.6.0"}` |

### Детали build-конфигурации

- **Vite** (`vite.config.ts`): `base: "/"` — это вызывало бы абсолютные `/assets/` пути, НО при текущей сборке `dist/public/index.html` уже содержит относительные `./assets/` пути (патч был применён ранее).
- **esbuild** (`script/build.ts`): bundling сервера в `dist/index.cjs`, `better-sqlite3` и `playwright` — внешние (не бандлятся, требуют `node_modules`).
- **PORT**: `server/index.ts` читает `LOCAL_COMET_PORT` → `PORT` → дефолт `5051`.

### Что НЕ потребовалось

- Ребилд — dist актуален (собран в 13:11, все изменения клиента и сервера до этого момента)
- Правка `index.html` — пути уже относительные (`./assets/`)
- Правка `vite.config.ts` — для production через Express абсолютные пути тоже работали бы, но текущие относительные — лучше
- Установка дополнительных модулей — все зависимости присутствуют

---

## Команда запуска

```bash
cd /home/user/workspace/local-comet
node dist/index.cjs
```

Сервер запустится на порту **5051** (по умолчанию).

### Альтернативные варианты с явным портом:

```bash
# Через переменную LOCAL_COMET_PORT (приоритет)
LOCAL_COMET_PORT=5051 node dist/index.cjs

# Через стандартную PORT
PORT=5051 node dist/index.cjs

# Через npm-скрипт (аналогично)
npm start
```

---

## Проверка работоспособности

После запуска:
```bash
curl http://localhost:5051/api/health
# → {"status":"ok","version":"0.6.0","service":"Local Comet",...}

curl http://localhost:5051/
# → HTTP 200, HTML с ./assets/ путями
```

---

## Если потребуется ребилд

```bash
cd /home/user/workspace/local-comet
npm run build           # пересобирает dist/index.cjs + dist/public/

# ВАЖНО: после npm run build, vite генерирует /assets/ (абсолютные пути)
# в dist/public/index.html. Для статического preview нужно исправить на ./assets/:
sed -i 's|src="/assets/|src="./assets/|g; s|href="/assets/|href="./assets/|g' dist/public/index.html
```

---

## Измененные файлы

Никакие файлы не изменялись — проект уже находился в рабочем состоянии.  
Диагностика подтвердила, что `node dist/index.cjs` стартует и отдаёт HTTP 200 на порту 5051.
