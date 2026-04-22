# MakeMyThread v3 — Project Summary

**Project:** People-centric news intelligence platform  
**Location:** `/home/panthi/.openclaw/workspace/makemythread_v3/`  
**Last Updated:** 2026-04-21

---

## 🎯 What It Does

MakeMyThread tracks news about specific public figures ( Nepali politicians) and delivers personalized news feeds to users. Think of it as a "person-based news aggregator" rather than topic-based.

### Key Features
- **Personalized feed** — users follow personalities, get their news
- **AI integration** — article analysis, thread summaries, fact-checking via Claude
- **Fake news radar** — database of fake news with verdicts and debunks
- **Admin panel** — full CMS for personalities, news, categories, reactions, sources
- **RSS ingestion** — automatic polling of Nepali news sources every 15 min
- **Python scraper** — multi-source scraping (GNews API, PINews API, RSS feeds)
- **SEO pages** — server-rendered HTML for discoverability

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (SPA)                       │
│              public/index.html, admin.html               │
└─────────────────────┬───────────────────────────────────┘
                      │ API
┌─────────────────────▼───────────────────────────────────┐
│                  Express Server (server.js)              │
│  ┌──────────┬──────────┬──────────┬──────────┐         │
│  │ auth.js  │ admin.js │ news.js  │ aiProxy.js│         │
│  └──────────┴──────────┴──────────┴──────────┘         │
│  ┌──────────┬──────────┐                              │
│  │ scraper.js│ sse.js   │                              │
│  └──────────┴──────────┘                              │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│              Services (Node.js)                          │
│  newsIngestion.js — RSS cron (15 min)                   │
│  aiRouter.js — Multi-provider AI routing               │
│  ssr.js — Server-side rendering for SEO                 │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│              SQLite Database                             │
│           database/mmt.db (portable, single file)        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│            Python Scraper (final_scraper_v3.py)         │
│  Sources: GNews API + PINews API + Nepali RSS feeds     │
│  Pushes to /api/scraper/push endpoint                   │
└─────────────────────────────────────────────────────────┘
```

---

## 📁 File Structure

```
makemythread_v3/
├── server.js                  # Express entry point + cron startup
├── setup.js                   # First-run: creates DB, seeds admin
├── package.json               # Dependencies
├── .env.example               # Template for .env
├── final_scraper_v3.py        # Python scraper (main project)
│
├── database/
│   ├── db.js                  # SQLite helpers (db, audit(), logAI())
│   └── schema.sql             # Full 14-table schema
│
├── middleware/
│   └── auth.js                # JWT middleware (requireAuth, requireAdmin)
│
├── routes/
│   ├── auth.js                # Login/signup/me
│   ├── admin.js               # 9 admin panel APIs
│   ├── news.js                # Public feed, follows, reactions
│   ├── aiProxy.js             # Claude proxy + caching + rate limits
│   ├── sse.js                 # Real-time push notifications
│   └── scraper.js             # Python scraper ingest endpoint
│
├── services/
│   ├── newsIngestion.js       # RSS cron + fetch logic
│   ├── aiRouter.js            # Multi-provider AI routing
│   └── ssr.js                 # SEO page rendering
│
└── public/
    ├── index.html             # Main SPA
    └── admin.html            # Admin panel
```

---

## 👤 personalities Being Tracked

| Name | English Name | Slug | Bio |
|------|-------------|------|-----|
| बालेन शाह | Balen Shah | balen-shah | Mayor of Kathmandu |
| प्रचण्ड | Prachanda | prachanda | Former PM — CPN (Maoist) |
| केपी ओली | KP Oli | kp-oli | Former PM — CPN-UML |
| गगन थापा | Gagan Thapa | gagan-thapa | MP — Nepali Congress |
| हर्क साम्पाङ | Harka Sampang | harka-sampang | Mayor of Dharan |

---

## 🔌 API Keys Required

### Required
- `ANTHROPIC_API_KEY` — Claude for AI features (console.anthropic.com)
- `JWT_SECRET` — Sign tokens: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `SCRAPER_SECRET` — Same generator as JWT_SECRET

### Optional
- `NEWS_API_KEY` — newsapi.org (free tier 100/day)
- `GNEWS_API_KEY` — in final_scraper_v3.py (already set: `243261f5ab25fecc02d80e82d3859d20`)
- `PINEWS_API_KEY` — in final_scraper_v3.py (already set: `6b5856851f6e40ada902001dfc069158`)

---

## 🚀 Quick Start

```bash
cd /home/panthi/.openclaw/workspace/makemythread_v3

# Install Node deps
npm install

# Copy and edit env
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY, JWT_SECRET, SCRAPER_SECRET

# Create DB + admin account
npm run setup

# Start server
npm start
# App: http://localhost:3000
# Admin: http://localhost:3000/admin (admin@mmt.com / Admin@1234)

# In another terminal — run scraper
export MMT_API_URL=http://localhost:3000
export MMT_API_SECRET=your_scraper_secret
python final_scraper_v3.py --push
```

---

## 🔧 Python Scraper Usage

```bash
python final_scraper_v3.py              # CSV mode only
python final_scraper_v3.py --push       # Push to backend
python final_scraper_v3.py --status     # Check backend connection
python final_scraper_v3.py --api-only   # Skip RSS, APIs only
python final_scraper_v3.py --rss-only   # Skip APIs, RSS only
python final_scraper_v3.py --push --csv # Push + save CSV backup
```

### Scraper Sources
1. **GNews API** — targeted search by personality name
2. **PINews API** — supplemental coverage
3. **RSS feeds** — 8 Nepali news outlets (broad fallback)

---

## 📊 Database Schema (14 tables)

Key tables:
- `users` — user accounts + roles
- `personalities` — public figures being tracked
- `news` — articles linked to personalities
- `follows` — user follows personality
- `reactions` — likes/saves on articles
- `ratings` — truth ratings on articles
- `fake_news` — fake news entries with verdicts
- `sources` — RSS feeds per personality
- `categories` — enforced category list
- `reaction_controls` — global/personality/user kill switches
- `audit_log` — timestamped admin action history

---

## 🔐 Security

- JWT-based auth (login/signup)
- Admin-only routes protected by `requireAdmin` middleware
- Scraper endpoint protected by `x-scraper-secret` header
- Rate limiting: 500 req/15 min per IP
- CORS configured for production frontend URL

---

## 🔄 Cron Jobs

- **RSS Ingestion** — runs every 15 minutes via newsIngestion.js
- **Scraper** — manually or via system cron (every 30-60 min recommended)

```
# Crontab suggestion:
*/30 * * * * cd /path/to/makemythread && MMT_API_URL=http://localhost:3000 MMT_API_SECRET=secret python final_scraper_v3.py --push >> logs/scraper.log 2>&1
```

---

## 🔍 For Continuing Work

1. **Add more personalities** — edit `TARGETS` array in `final_scraper_v3.py`
2. **Add more RSS feeds** — edit `RSS_FEEDS` dict in `final_scraper_v3.py`
3. **Customize AI prompts** — edit `services/aiRouter.js`
4. **Change frontend** — edit `public/index.html` and `public/admin.html`
5. **Add new API endpoints** — add to `routes/` and register in `server.js`
6. **Database changes** — edit `database/schema.sql`, then update `setup.js`

---

## 📝 Notes

- DB is a single file (`database/mmt.db`) — easy to back up, portable
- AI has 1-hour cache + 10 calls/user/hour rate limit to control costs
- SSR pages inject `window.__SSR__` to avoid double API calls
- The scraper uses `INSERT OR IGNORE` for deduplication by URL
- Admin email/password set in `.env` before `npm run setup`