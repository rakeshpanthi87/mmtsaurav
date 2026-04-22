# 🔑 MakeMyThread — API Keys & Full-Stack Requirements

Complete reference for everything needed to run the platform end-to-end.

---

## 1. Required — Cannot run without these

| Key / Setting | Where to get it | Used for |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | AI analysis, thread summaries, fact-checks |
| `JWT_SECRET` | Generate locally (see below) | Signing login tokens |
| `SCRAPER_SECRET` | Generate locally (see below) | Authenticating Python scraper pushes |

**Generate secure random strings:**
```bash
# JWT_SECRET and SCRAPER_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 2. Optional — Platform works without these, features degrade gracefully

| Key / Setting | Where to get it | Used for | Without it |
|---|---|---|---|
| `NEWS_API_KEY` | newsapi.org → Get API Key (free tier: 100 req/day) | NewsAPI.org article fetching | RSS-only mode |
| `GOOGLE_CLIENT_ID` | console.cloud.google.com → OAuth 2.0 | Google Sign-In button | Email/password auth only |
| `GOOGLE_CLIENT_SECRET` | Same as above | Google OAuth callback | Email/password auth only |

---

## 3. Anthropic API — Cost estimates

| Feature | Model | Est. tokens | Est. cost per call |
|---|---|---|---|
| Article analysis (Refresh button) | claude-sonnet-4 | ~300 tokens | ~$0.001 |
| Thread summary (AI Summary button) | claude-sonnet-4 | ~600 tokens | ~$0.002 |
| Fact check | claude-sonnet-4 | ~300 tokens | ~$0.001 |

With the built-in 1-hour cache and 10 calls/user/hour rate limit, a 100-user platform costs roughly $2–5/day in AI.

---

## 4. Python scraper dependencies

```bash
pip install requests beautifulsoup4 pandas feedparser
```

No API key needed for scraper — it uses free RSS feeds.

---

## 5. Scraper → Backend flow

```
Python scraper (final_scraper_v3.py)
    │
    │  POST /api/scraper/push
    │  Header: x-scraper-secret: SCRAPER_SECRET
    │  Body: { personalities: [...], news: [...] }
    │
    ▼
Express backend (routes/scraper.js)
    │  ── resolves personality names to DB IDs
    │  ── deduplicates by source_url
    │  ── inserts new articles
    │
    ▼
SQLite DB (database/mmt.db)
    │
    ▼
Frontend feed (SSE push to followers)
```

**Running the scraper:**
```bash
# Check backend connection first
python final_scraper_v3.py --status

# Push scraped data to running backend
python final_scraper_v3.py --push

# CSV mode (original — no backend needed)
python final_scraper_v3.py

# Push + save CSV backup
python final_scraper_v3.py --push --csv

# Override API URL for production
python final_scraper_v3.py --push --api-url https://yourdomain.com --secret your_secret
```

---

## 6. Modular architecture — what each module does

```
server.js                  ← Entry point only. Imports, middleware, starts cron.
                             No business logic here.

middleware/auth.js          ← JWT decode/verify. Three exports:
                               requireAuth   — any logged-in user
                               requireAdmin  — admin role only
                               optionalAuth  — user if token present, anonymous if not

routes/auth.js              ← POST /login, /signup, GET /me, PATCH /me
routes/admin.js             ← All 9 admin panel APIs. Protected by requireAdmin.
routes/news.js              ← Public feed, follows, reactions, ratings. optionalAuth.
routes/aiProxy.js           ← Claude API proxy with caching + rate limiting + DB logging.
routes/sse.js               ← SSE connections. exports notifyFollowers() for cron use.
routes/scraper.js           ← Python scraper ingest. Protected by x-scraper-secret header.

services/newsIngestion.js   ← RSS cron (every 15 min). Calls notifyFollowers() after insert.
services/ssr.js             ← Server-side HTML rendering for SEO pages:
                               / (home), /discover, /fakeradar, /p/:slug, /news/:id

database/db.js              ← SQLite connection. Exposes db, audit(), logAI() helpers.
database/schema.sql         ← All 14 tables. Applied on first run. Idempotent (IF NOT EXISTS).
```

---

## 7. SEO — which pages are server-side rendered

| URL | SSR? | Meta tags | JSON-LD type |
|---|---|---|---|
| `/` | ✅ | Title, OG, Twitter | WebSite + SearchAction |
| `/discover` | ✅ | Title, OG | ItemList (Person) |
| `/p/:slug` | ✅ | Title, OG, description from bio | Person + NewsArticle |
| `/fakeradar` | ✅ | Title, OG, fake count | WebPage + Claim |
| `/news/:id` | ✅ | Title, OG, article meta | NewsArticle |
| `/feed` | ❌ | Requires login — not crawlable | — |
| `/threads` | ❌ | Private user content | — |
| `/admin` | ❌ | Admin only | — |

Each SSR page also injects `window.__SSR__` with the preloaded data so the SPA doesn't make a second API call on load.

---

## 8. Running locally — complete checklist

```bash
# 1. Install Node deps
npm install

# 2. Copy env file
cp .env.example .env

# 3. Edit .env — set at minimum:
#    ANTHROPIC_API_KEY=sk-ant-...
#    JWT_SECRET=<generated>
#    SCRAPER_SECRET=<generated>

# 4. Create DB + seed admin
npm run setup

# 5. Start backend
npm start
# → http://localhost:3000       (app)
# → http://localhost:3000/admin (admin panel)

# 6. Install Python deps (separate terminal)
pip install requests beautifulsoup4 pandas feedparser

# 7. Set scraper env vars
export MMT_API_URL=http://localhost:3000
export MMT_API_SECRET=your_scraper_secret   # same as SCRAPER_SECRET in .env

# 8. Check scraper can see the backend
python final_scraper_v3.py --status

# 9. Run scraper and push data
python final_scraper_v3.py --push
```

---

## 9. Production deployment checklist

- [ ] Set `NODE_ENV=production`
- [ ] Change `JWT_SECRET` to a fresh 64-char random string
- [ ] Change `SCRAPER_SECRET` to a fresh random string
- [ ] Change `ADMIN_PASSWORD` before running `npm run setup`
- [ ] Set `APP_URL` to your public domain (for SSR canonical URLs)
- [ ] Set `FRONTEND_URL` to your public domain (for CORS)
- [ ] Run behind nginx with SSL
- [ ] Schedule `python final_scraper_v3.py --push` as a cron job (every 30–60 min)
- [ ] Back up `./database/mmt.db` daily
- [ ] Use `pm2` to keep the server alive: `pm2 start server.js --name mmt`

---

## 10. Cron schedule suggestion (crontab)

```cron
# Scraper — runs every 30 minutes
*/30 * * * * cd /path/to/makemythread && MMT_API_URL=http://localhost:3000 MMT_API_SECRET=your_secret python final_scraper_v3.py --push >> logs/scraper.log 2>&1

# DB backup — daily at 2am
0 2 * * * cp /path/to/makemythread/database/mmt.db /backups/mmt_$(date +\%Y\%m\%d).db
```
