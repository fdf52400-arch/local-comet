# Kwork Scoring Workflow — Implementation Summary

## Status: ✅ Ready for local preview and next public deploy

## What Was Built

### New Files
| File | Description |
|------|-------------|
| `shared/kwork-scoring.ts` | Scoring engine — pure function, no side effects, importable anywhere |
| `client/src/pages/kwork-leads.tsx` | Full Kwork leads page (942 lines) |

### Modified Files
| File | Changes |
|------|---------|
| `shared/schema.ts` | Added `kworkLeads` table with 25 columns |
| `server/storage.ts` | Added migration, IStorage interface methods, DatabaseStorage implementation, seed data (7 real leads) |
| `server/routes.ts` | Added 9 Kwork API routes |
| `server/index.ts` | Auto-seed on startup |
| `client/src/App.tsx` | Registered `/kwork` route |
| `client/src/pages/control-center.tsx` | Added "Kwork" nav button in top-right header |

---

## Architecture

### Data Model (`kworkLeads` table)
- Source tracking: `source` (email/manual/browser), `sourceRaw`
- Project fields: `title`, `budget`, `budgetRaw`, `orderUrl` (nullable), `brief`, `category`
- 6 boolean flags: `flagFitsProfile`, `flagNeedsCall`, `flagNeedsAccess`, `flagNeedsDesign`, `flagNeedsMobile`, `flagCloudVmFit`
- Scoring output: `fitScore` (0–100), `recommendation` (reject/review_manually/strong_fit), `whyFits` (JSON[]), `keyRisks` (JSON[])
- Workflow state: `status` (new/shortlisted/rejected/opened/in_review), `isShortlisted`, `computerTaskId`

### Scoring Engine (`shared/kwork-scoring.ts`)

Budget gate:
- `budget < 50 000 ₽` → **Reject** immediately, score ≈ budget/1000

Budget passed → base 30 points, then:

| Signal | Points |
|--------|--------|
| Budget ≥ 100 000 ₽ | +10 |
| Budget ≥ 75 000 ₽ | +5 |
| AI/LLM keywords (gpt, llm, openai, нейросет...) | +15 |
| Automation keywords | +10 |
| Browser agent keywords (playwright, selenium...) | +12 |
| Telegram bot keywords | +8 |
| Integration keywords (n8n, zapier, webhook, crm...) | +8 |
| Web stack keywords | +6 |
| Cloud/infra keywords | +5 |
| `flagFitsProfile` | +10 |
| `flagCloudVmFit` | +8 |

Penalties:
| Signal | Points |
|--------|--------|
| Vague brief / brief < 30 chars | -10 |
| Mobile/store publishing | -15 |
| Forced manual call | -8 |
| Unclear access/credentials | -5 |
| Design dependency | -8 |
| No brief at all (email-only) | -15 |

Recommendation thresholds:
- **Strong Fit**: fitScore ≥ 70
- **Review Manually**: 40–69
- **Reject**: < 40

---

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/kwork/leads` | List all leads |
| GET | `/api/kwork/leads/:id` | Single lead |
| POST | `/api/kwork/leads` | Create with auto-scoring |
| PATCH | `/api/kwork/leads/:id` | Update (status, shortlist, etc.) |
| DELETE | `/api/kwork/leads/:id` | Delete |
| POST | `/api/kwork/leads/:id/rescore` | Recalculate score |
| POST | `/api/kwork/leads/:id/open` | Mark opened, return URL or note |
| POST | `/api/kwork/leads/:id/computer-review` | Launch Computer agent task |
| POST | `/api/kwork/seed` | Load demo data (idempotent) |
| POST | `/api/kwork/score-preview` | Preview score without saving |

---

## UI Features (`/kwork` page)

### Stats Bar
- 5 counters: Total / Strong Fit / Review / Reject / Shortlist

### Filter Tabs
- All / Strong Fit / Review Manually / Reject / Shortlist / Новые
- Search by title, category, brief

### Lead Card (collapsed)
- Score circle (color-coded: green/amber/red)
- Recommendation badge + status badge
- Shortlist star badge (violet)
- Title, budget, category, source icon
- "нет URL" warning on email-sourced leads
- Progress bar (fitScore visual)

### Lead Card (expanded)
- **ТЗ / Описание** section — shows brief, or amber warning if email-only
- **Почему подходит** — green list of scoring reasons
- **Ключевые риски** — red list of penalties/risks
- **Признаки** — 6 flag chips (positive/negative color)
- **Actions**: "Открыть заказ" / "Перейти к поиску", "Запустить Computer review", "В шортлист", "Отклонить", delete

### Honesty about email-only leads
When `orderUrl` is null AND `brief` is empty, the UI shows:
> "Полное ТЗ недоступно — получено только из email-дайджеста. Для полного анализа откройте страницу заказа на Kwork или запустите Computer review."

### "Добавить лид" intake form
- Title, budget, source (email/manual/browser), category, URL, brief
- 6 flag toggle buttons
- "Preview score" button — calls `/api/kwork/score-preview` in real time
- Submits with auto-scoring

---

## Seed Data (7 Real-Profile Leads)

| Title | Budget | Score | Rec |
|-------|--------|-------|-----|
| AI-агент для AmoCRM | 120 000 ₽ | 88 | strong_fit |
| Чат-бот GPT-4o + база знаний | 90 000 ₽ | 84 | strong_fit |
| Telegram-бот для онлайн-школы | 75 000 ₽ | 77 | strong_fit |
| Парсер маркетплейсов (Playwright) | 55 000 ₽ | 73 | strong_fit |
| N8N workflow + Notion/Telegram | 60 000 ₽ | 69 | review_manually |
| Мобильное iOS/Android приложение | 200 000 ₽ | 18 | reject |
| SEO-продвижение | 30 000 ₽ | 2 | reject |

---

## Computer Integration

**"Открыть заказ"** (`POST /api/kwork/leads/:id/open`):
- If `orderUrl` is set → opens URL in new tab, marks status `opened`
- If no URL → shows honest message: email-digest lead, manual step needed

**"Запустить Computer review"** (`POST /api/kwork/leads/:id/computer-review`):
- Creates an `AgentTask` targeting `orderUrl` (or Kwork search URL)
- Goal: extract full spec, requirements, timeline from the order page
- Enqueues via `task-queue`, marks lead status `in_review`, stores `computerTaskId`
- Works regardless of whether URL is known — falls back to Kwork search by title

---

## Local Preview

```bash
cd /home/user/workspace/local-comet
npm run dev
# Open http://localhost:5051/#/kwork
```

The dev server auto-seeds 7 demo leads on startup (idempotent — won't duplicate).

## Next Deploy Steps

The production build is already compiled (`dist/`). To deploy:
```bash
cd /home/user/workspace/local-comet
npm run build
# Then deploy dist/public with the backend server
```

All existing functionality (Control Center, settings, agent tasks, workspaces) is preserved.

---

## Files Changed (Summary)

```
MODIFIED:
  shared/schema.ts          — kworkLeads table added
  server/storage.ts         — Kwork storage impl + migration + seed
  server/routes.ts          — 9 Kwork API routes
  server/index.ts           — auto-seed on startup
  client/src/App.tsx        — /kwork route registered
  client/src/pages/control-center.tsx — Kwork nav button

CREATED:
  shared/kwork-scoring.ts                  — scoring engine
  client/src/pages/kwork-leads.tsx         — Kwork leads UI (942 lines)
  KWORK-WORKFLOW-SUMMARY.md                — this file
```
