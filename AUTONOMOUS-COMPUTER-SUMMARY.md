# Autonomous Computer Flow & Provider Gateway — Summary

**Date:** 2026-03-30  
**Status:** ✅ Built, smoke-tested, ready for local preview

---

## What Changed

### 1. Provider Gateway — Fixed (`server/provider-gateway.ts`)

**Problem:** LM Studio check was returning Ollama error text; both providers could generate incorrect URL if `baseUrl` already contained a port.

**Fixes:**

- `buildBaseUrl()` now checks whether the URL already has an explicit port (`:NNNN` at the end). If it does, the port is **not** appended again — eliminating double-port URLs like `http://localhost:11434:11434`.
- Error messages are now **provider-specific** in every case:
  - Ollama: `"Не удалось подключиться к Ollama (http://localhost:11434): fetch failed"`
  - LM Studio: `"Не удалось подключиться к LM Studio (http://localhost:1234): fetch failed"`
- Timeout errors now include the endpoint URL so users know which address was tried.
- All fetch calls use a shared `fetchWithTimeout()` helper with `AbortController` — consistent 5 s check timeout, 8 s models timeout, 60 s chat timeout.

**URL Normalization cases handled:**

| Input baseUrl | Port | Result |
|---|---|---|
| `http://localhost` | 11434 | `http://localhost:11434` ✓ |
| `http://localhost:11434` | 11434 | `http://localhost:11434` (no duplicate) ✓ |
| `http://192.168.1.1:8080` | 1234 | `http://192.168.1.1:8080` (explicit port respected) ✓ |

---

### 2. Autonomous Computer Flow — Redesigned

#### Backend: `server/routes.ts` — `POST /api/computer/run`

Previously returned only `{ task, queued, sessionId, resolvedUrl, goal }`.

**Now returns:**
```json
{
  "task": {...},
  "queued": true,
  "sessionId": "...",
  "workspaceId": 1,
  "resolvedUrl": "https://github.com",
  "goal": "Открыть github и изучить страницу",
  "queryType": "open_site",
  "planSteps": [
    { "index": 0, "action": "navigate", "description": "Открыть https://github.com", "status": "pending" },
    { "index": 1, "action": "dom_snapshot", "description": "Сканировать структуру страницы", "status": "pending" },
    { "index": 2, "action": "extract_text", "description": "Извлечь текст страницы", "status": "pending" },
    { "index": 3, "action": "find_links", "description": "Найти ссылки на странице", "status": "pending" },
    { "index": 4, "action": "summarize_page", "description": "Составить сводку страницы", "status": "pending" }
  ],
  "planSource": "heuristic"
}
```

- If a model is configured and reachable, `planSteps` may come from the model (`planSource: "model"`).
- Heuristic plan is always available as an instant fallback.
- Added `describeAction()` helper that generates human-readable step descriptions in Russian.

#### Frontend: `client/src/pages/control-center.tsx`

**`handleCommandSubmit` — Unified flow:**  
ALL commands (open site, search, URL, natural language) now go through `computerRunMutation` → `POST /api/computer/run`. There are no more "silent" navigations that bypass the agent queue. For known sites/URLs, a fast local preview navigate still fires in parallel for immediate visual feedback.

**`computerRunMutation` — Enhanced:**
- `onMutate`: Immediately shows a pending mission card ("Анализ запроса…") so the UI reacts in <100 ms.
- `onSuccess`: Populates the mission card with real plan steps from the server response.
- `onError`: Marks the mission as failed with the error message.

**New `ActiveMission` type + `MissionCard` component:**

The Computer sidecar panel now shows a **Mission Card** containing:
1. **User request** — what the user typed, verbatim
2. **Query type badge** — Поиск / Открыть сайт / Навигация / Задача агента
3. **Resolved URL** — where Computer is actually going
4. **Plan steps** — with live status icons:
   - `⏰` pending (muted)
   - `↻ blue` running (animated spin)
   - `✓ green strikethrough` success
   - `✗ red` error
5. **Progress bar** — completed steps / total steps
6. **Result** — success message or error text after completion

**SSE-driven step status updates:**  
The SSE handler now calls `setActiveMission()` on every `action` / `action_result` / `completed` event to keep step statuses in sync in real time.

---

### 3. Terminal / Code Tabs — Made Secondary

**Before:** Terminal and Code were tabs at the same level as Agent and Chat.

**After:**  
- Primary tabs: **Agent · Chat · Research**  
- The `···` icon at the far right of the tab bar expands a secondary sub-row: **Terminal · Code**
- The secondary row has amber highlighting to distinguish it from primary tabs
- No functionality removed — just visually de-emphasized

---

## Files Changed

| File | Change |
|---|---|
| `server/provider-gateway.ts` | Fixed `buildBaseUrl` (no double-port), provider-specific errors, `fetchWithTimeout` helper |
| `server/routes.ts` | `/api/computer/run` now returns `planSteps` + `planSource`; added `describeAction()` |
| `client/src/pages/control-center.tsx` | `ActiveMission` type, `MissionCard` component, unified `handleCommandSubmit`, SSE step tracking, secondary Terminal/Code tabs |

---

## Smoke Test Results

```
1. /api/health                     → OK
2. /api/providers/check (ollama)   → ok: False | msg: Не удалось подключиться к Ollama (http://localhost:11434): fetch failed
3. /api/providers/check (lmstudio) → ok: False | msg: Не удалось подключиться к LM Studio (http://localhost:1234): fetch failed ✓ no Ollama mention
4. /api/computer/run "открой google"   → queued: True | url: https://www.google.com | 5 planSteps | heuristic
5. /api/computer/run "найди в google …" → queued: True | url: google search URL | queryType: search | 5 planSteps
6. /api/computer/run "изучи github"     → queued: True | url: https://github.com | 5 planSteps
7. URL normalization: all 5 cases PASS (no double-port)
```

---

## How the Flow Works Now

```
User types "открой github"
    ↓
handleCommandSubmit()
    ↓
computerRunMutation.mutate({ query: "открой github" })
    ↓ onMutate (immediate, <50 ms)
Mission Card appears: "Анализ запроса…" (running spinner)
    + fast local navigate fires to github.com for preview
    ↓
POST /api/computer/run → resolves URL, generates plan
    ↓ onSuccess (~200 ms)
Mission Card populated:
  ЗАПРОС: "открой github"
  URL: https://github.com
  ПЛАН (АВТО): 5 steps, all pending
    ↓
Agent task enqueued → agent-engine runs
    ↓ SSE events stream in
Mission Card steps update live:
  step 0 (navigate)    → running → success ✓
  step 1 (dom_snapshot) → running → success ✓
  step 2 (extract_text) → running → success ✓
  …
    ↓ "completed" SSE event
Mission Card: "Задача выполнена" (emerald badge)
```

---

## Ready for Local Preview?

Yes. Build is clean, smoke tests pass. To run locally:

```bash
cd /home/user/workspace/local-comet
npm run build
node dist/index.cjs
# → http://localhost:5051
```

The next iteration could:
- Add more granular plan-step descriptions based on page content (requires model)
- Show a collapsed "Previous missions" list below the active mission
- Add cancel button on the mission card during execution
