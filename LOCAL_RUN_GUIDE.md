# Local Comet — запуск локально (Windows)

Local Comet подключается к **вашим локальным моделям** напрямую — данные не покидают машину.

---

## Требования

| Что нужно | Версия |
|---|---|
| Node.js | 18 LTS или новее — [nodejs.org](https://nodejs.org) |
| Ollama (опционально) | запущен на `http://localhost:11436` |
| LM Studio (опционально) | Local Server запущен на `http://localhost:1234` |

Хотя бы один из провайдеров (Ollama или LM Studio) должен быть запущен до старта Local Comet.

---

## Первый запуск

1. Откройте папку проекта в Проводнике.
2. Запустите один из скриптов:

**PowerShell (рекомендуется):**
```
Правой кнопкой на run-local-comet.ps1 → "Запуск с помощью PowerShell"
```
Или из терминала:
```powershell
powershell -ExecutionPolicy Bypass -File run-local-comet.ps1
```

**Командная строка (cmd.exe):**
```
Двойной клик на run-local-comet.bat
```

3. Дождитесь сообщения `serving on port 5051` в консоли.
4. Откройте браузер вручную и перейдите по адресу:

```
http://localhost:5051
```

> Автозапуск браузера не используется — Windows не всегда корректно открывает URL из скриптов. Откройте вкладку сами.

---

## Что делает скрипт

- Проверяет наличие Node.js.
- Устанавливает зависимости (`npm install`) при первом запуске.
- Запускает собранный сервер (`dist/index.cjs`) на порту 5051.
- Если `dist/index.cjs` отсутствует — запускает `npm run build` автоматически (только в `.ps1`).

---

## Настройка провайдеров

После открытия `http://localhost:5051` зайдите в **Settings** → **Provider**:

| Провайдер | Base URL | Port |
|---|---|---|
| Ollama | `http://localhost` | `11436` |
| LM Studio | `http://localhost` | `1234` |

Нажмите **Check connection** — статус должен стать **Available**.  
Затем выберите нужную модель из списка и сохраните.

---

## Проверка: видит ли Local Comet Ollama и LM Studio

**Через браузер** (не требует curl):
- Ollama: откройте `http://localhost:11436/api/tags` — должен вернуть JSON со списком моделей.
- LM Studio: откройте `http://localhost:1234/v1/models` — должен вернуть JSON со списком моделей.

**Через curl (PowerShell):**
```powershell
# Ollama
curl http://localhost:11436/api/tags

# LM Studio
curl http://localhost:1234/v1/models
```

Если страница не открывается — провайдер не запущен. Запустите Ollama или LM Studio и попробуйте снова.

---

## Пересборка (после обновления кода)

```powershell
# Из папки проекта:
npm run build
```
Затем запустите скрипт снова.

---

## Ошибки

| Ошибка | Причина | Решение |
|---|---|---|
| `Node.js not found` | Node.js не установлен | Установить с [nodejs.org](https://nodejs.org) |
| `Port 5051 is already in use` | Другой экземпляр запущен | Закрыть другую консоль или перезагрузить |
| `dist/index.cjs not found` | Проект не собран | Запустить `npm run build` |
| `ECONNREFUSED 11436` | Ollama не запущен | Запустить Ollama |
| `ECONNREFUSED 1234` | LM Studio не запущен | Включить Local Server в LM Studio |

---

## Остановка

Нажмите **Ctrl+C** в консоли, где запущен сервер.
