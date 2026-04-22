# MakeMyThread v3 — Project Context

## What this is
People-centric Nepali news intelligence platform. Users follow politicians/celebrities and get personalised news feeds organised around those personalities.

## Stack
- **Backend:** Node.js + Express 4 + better-sqlite3 (SQLite at `database/mmt.db`)
- **Frontend:** Single HTML file SPA — `public/index.html` (no framework)
- **Auth:** JWT Bearer tokens (`Authorization: Bearer <token>`), bcrypt password hashing
- **AI:** Proxied via `/api/ai/` routes → `services/aiRouter.js` → Anthropic

## Key directories
```
routes/
  auth.js           — login, register, /me
  admin.js          — admin panel routes (requireAdmin middleware), PLUS Expert-Panel-style admin endpoints appended at end
  personalities.js  — Expert-Panel-style public personalities API
  newsV2.js         — Expert-Panel-style news API
  threads.js        — persistent threads
  users.js          — user management
  notifications.js  — notifications
  apiKeys.js        — API key management
  dashboard.js      — feed-summary, trending
  health.js         — GET /health
  news.js           — OLD news routes (keep, used by admin.html)
  aiProxy.js        — AI proxy endpoints
database/
  schema.sql        — SQLite schema (idempotent, IF NOT EXISTS everywhere)
  db.js             — DB init + migrations block (ALTER TABLE in try/catch)
public/
  index.html        — new SPA frontend (MakeMyThread (2).html + API integration layer injected at end)
  admin.html        — admin panel (must keep working, uses /api/admin/* routes)
services/
  aiRouter.js       — AI abstraction layer
  ssr.js            — SSR for SEO routes
```

## Dual API compatibility
- Old admin routes: `/api/admin/*` (requireAdmin middleware in server.js, handled by routes/admin.js)
- New Expert-Panel-style routes: `/api/personalities`, `/api/news`, `/api/threads`, etc. (mounted at `/api` in server.js)
- Both must remain working — admin.html depends on old routes

## Field name mapping (SQLite → API response)
| DB column | API field |
|-----------|-----------|
| `title` | `headline` |
| `source_name` | `source` |
| `img_color` | `bannerColor` |
| `initials` | `avatarInitials` |
| `avatar_bg` | `avatarColor` |
| `topics` (JSON string) | `tags` (parsed array) |

Mappers live in `formatPersonality()` (personalities.js) and `formatNewsItem()` (newsV2.js).

## Rating system
- DB stores ratings as integers 1–5 in `news_ratings` table
- API uses text: `'fact'` | `'notsure'` | `'fake'`
- Mapping: fact→5, notsure→3, fake→1 on write; >=4→fact, >=2→notsure, else→fake on read

## SQLite migration pattern
```js
// In database/db.js after db.exec(schema):
const migrations = [
  "ALTER TABLE ...",
  "CREATE TABLE IF NOT EXISTS ...",
];
for (const m of migrations) {
  try { db.exec(m); } catch(e) { /* already exists */ }
}
```
Never use `ADD COLUMN IF NOT EXISTS` — SQLite doesn't support it.

## Frontend API integration
`public/index.html` has an IIFE block injected before `</body>` that overrides:
- `doLogin()`, `doSignup()`, `doLogout()` — real auth via backend
- `toggleFollow()`, `rateNews()`, `likeNews()` — synced to backend after local UI update
- `runAIOnCard()`, `summarizeThread()`, `runAIFactCheck()` — routed through `/api/ai/*`
- `tryRestoreSession()` — auto-login from stored JWT on page load

JWT stored in `localStorage('mmt_token')`. To edit wiring, change the IIFE block only — don't overwrite the whole file.

## Reference project
`/home/panthi/.openclaw/workspace/Expert-Panel-Deploy-main` — TypeScript + Express 5 + Drizzle + PostgreSQL. Used as API design reference. NOT copied directly — patterns recreated in JS/SQLite.

## Known gotchas
- `system_settings` table (used by master-toggle) is created via migration in db.js, NOT in schema.sql
- `gender` and `age` columns on personalities are also migration-only
- Direct `fetch('https://api.anthropic.com/...')` calls in the original HTML are overridden by the injected layer — don't restore them
- `ON CONFLICT(col) DO UPDATE SET` — SQLite syntax, not Postgres style
