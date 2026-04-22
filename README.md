# 🧵 MakeMyThread — Local Setup Guide

People-centric news intelligence platform. Fully self-contained, no cloud services required except the Anthropic API key.

---

## Requirements

- Node.js v18 or higher
- npm v8 or higher

No database server needed — SQLite runs inside the app.

---

## First-time setup

```bash
# 1. Clone or unzip the project
cd makemythread

# 2. Install dependencies
npm install

# 3. Run setup (creates DB, seeds admin account, copies .env)
npm run setup

# 4. Edit .env — add your Anthropic API key
#    Open .env and set ANTHROPIC_API_KEY=sk-ant-...

# 5. Start the server
npm start

# Development mode (auto-restarts on changes)
npm run dev
```

The app will be running at:
- **Frontend:** http://localhost:3000
- **Admin Panel:** http://localhost:3000/admin

---

## Default admin credentials

| Field    | Value           |
|----------|-----------------|
| Email    | admin@mmt.com   |
| Password | Admin@1234      |

Change these in `.env` before running `npm run setup` on a fresh install.

---

## Environment variables (`.env`)

| Key                  | Description                                      |
|----------------------|--------------------------------------------------|
| `PORT`               | Server port (default: 3000)                      |
| `JWT_SECRET`         | Long random string for signing tokens            |
| `ANTHROPIC_API_KEY`  | Your Claude API key — required for AI features   |
| `AI_MODEL`           | Claude model (default: claude-sonnet-4-20250514) |
| `NEWS_API_KEY`       | Optional NewsAPI.org key                         |
| `ADMIN_EMAIL`        | Admin email used in first-run setup              |
| `ADMIN_PASSWORD`     | Admin password used in first-run setup           |
| `DB_PATH`            | SQLite file path (default: ./database/mmt.db)    |

---

## Admin Panel — Tabs

| Tab              | What you can do                                                    |
|------------------|--------------------------------------------------------------------|
| Dashboard        | Stats overview, news by category chart, AI usage (7-day)          |
| Users            | Search, filter by role, change roles, delete users                 |
| Personalities    | Add/edit/delete public figures, avatar colors, categories          |
| News Posts       | Add/edit/delete articles, bulk delete, filter by category          |
| Fake News        | Add/edit/delete fake news entries with verdicts and debunks        |
| Sources          | Add RSS feeds per personality, manual fetch, set fetch intervals   |
| Categories       | Manage the enforced category list (eliminates politics/Politics)   |
| Reactions        | Kill switch, per-personality overrides, per-user blocks            |
| Audit Log        | Full timestamped history of every admin action                     |

---

## How news ingestion works

1. Add a personality in the Personalities tab
2. Go to Sources, add an RSS feed URL and assign it to the personality
3. Set a fetch interval (minimum 15 minutes)
4. The cron job runs every 15 minutes and fetches due sources
5. New articles appear in the Feed automatically
6. Users following that personality get an SSE push notification

You can also trigger a manual fetch anytime from the Sources tab.

---

## API Endpoints

### Auth
- `POST /api/auth/signup` — Register new user
- `POST /api/auth/login` — Login, returns JWT
- `GET  /api/auth/me` — Get current user
- `PATCH /api/auth/me` — Update profile

### Public News
- `GET /api/news/personalities` — All personalities
- `GET /api/news/personalities/:slug` — Single personality + news
- `GET /api/news/feed` — Personalised feed (JWT optional)
- `GET /api/news/fake-news` — All fake news entries
- `GET /api/news/categories` — Category list
- `POST /api/news/follows/:id` — Toggle follow
- `POST /api/news/reactions` — Like or save
- `POST /api/news/ratings` — Submit truth rating

### AI (all POST)
- `/api/ai/proxy` — Universal Claude proxy
- `/api/ai/analyze-article` — Article analysis
- `/api/ai/summarize-thread` — Thread summary
- `/api/ai/fact-check` — Fact check

### SSE
- `GET /api/sse/feed?userId=...` — Real-time news push

### Admin (all require admin JWT)
- `/api/admin/stats`
- `/api/admin/users` — CRUD + role change
- `/api/admin/personalities` — CRUD
- `/api/admin/news` — CRUD + bulk delete
- `/api/admin/fake-news` — CRUD
- `/api/admin/sources` — CRUD + manual fetch
- `/api/admin/categories` — CRUD
- `/api/admin/reaction-controls` — Global + per-personality + per-user
- `/api/admin/audit-log` — Read only
- `/api/admin/ai-usage` — Usage stats

---

## File structure

```
makemythread/
├── server.js                  # Express entry point
├── setup.js                   # First-run setup script
├── package.json
├── .env.example
├── database/
│   ├── db.js                  # SQLite connection + helpers
│   └── schema.sql             # Full DB schema
├── middleware/
│   └── auth.js                # JWT middleware
├── routes/
│   ├── auth.js                # Login / signup / me
│   ├── admin.js               # All admin CRUD routes
│   ├── news.js                # Public news + follow + reaction routes
│   ├── aiProxy.js             # Claude AI proxy with caching
│   └── sse.js                 # Server-sent events
├── services/
│   └── newsIngestion.js       # RSS cron + fetch logic
└── public/
    ├── index.html             # Main MakeMyThread app (copy your HTML here)
    ├── admin.html             # Admin panel
    └── manifest.json          # Served dynamically by server.js
```

---

## Moving from Replit

1. Download your current Replit project
2. Copy your existing SQLite database file to `./database/mmt.db`
   - Or just run `npm run setup` to start fresh
3. Copy your `.env` values from Replit's Secrets panel to `.env`
4. `npm install && npm start`

Your data is fully portable — it's all in a single SQLite file.

---

## Production tips

- Set `NODE_ENV=production` in `.env`
- Change `JWT_SECRET` to a long random string
- Run behind nginx for SSL termination
- Use `pm2` for process management: `pm2 start server.js --name mmt`
- Back up `./database/mmt.db` regularly — that file is your entire data layer
