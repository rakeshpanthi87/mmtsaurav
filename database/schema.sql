-- ═══════════════════════════════════════════
--  MakeMyThread — SQLite Schema
-- ═══════════════════════════════════════════

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  email       TEXT    UNIQUE NOT NULL,
  password    TEXT,
  role        TEXT    NOT NULL DEFAULT 'user',  -- user | admin | personality
  initials    TEXT,
  avatar_bg   TEXT    DEFAULT '#1A1208',
  avatar_fg   TEXT    DEFAULT '#FFF8E7',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Categories (managed list — prevents politics/Politics mismatch)
CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE NOT NULL,
  color      TEXT DEFAULT '#C9963A',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Personalities
CREATE TABLE IF NOT EXISTS personalities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  name_local    TEXT,
  category      TEXT,
  nationality   TEXT,
  bio           TEXT,
  bg_info       TEXT,
  initials      TEXT,
  avatar_bg     TEXT DEFAULT '#F5F5F5',
  avatar_fg     TEXT DEFAULT '#333333',
  verified      INTEGER DEFAULT 0,
  user_id       INTEGER REFERENCES users(id),  -- linked account if role=personality
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- News Sources (RSS / NewsAPI per personality)
CREATE TABLE IF NOT EXISTS news_sources (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  personality_id  INTEGER REFERENCES personalities(id) ON DELETE CASCADE,
  label           TEXT,
  url             TEXT NOT NULL,
  type            TEXT DEFAULT 'rss',  -- rss | newsapi | manual
  fetch_interval  INTEGER DEFAULT 60,  -- minutes
  last_fetched    DATETIME,
  is_active       INTEGER DEFAULT 1,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- News Posts
CREATE TABLE IF NOT EXISTS news (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  personality_id  INTEGER REFERENCES personalities(id) ON DELETE SET NULL,
  source_id       INTEGER REFERENCES news_sources(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  snippet         TEXT,
  full_content    TEXT,
  source_name     TEXT,
  source_url      TEXT UNIQUE,          -- deduplication: same URL = same article
  category        TEXT,
  credibility     INTEGER DEFAULT 80,
  bias            TEXT DEFAULT 'neutral',
  is_breaking     INTEGER DEFAULT 0,
  img_color       TEXT DEFAULT '#DBEAFE',
  published_at    DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Fake News entries
CREATE TABLE IF NOT EXISTS fake_news (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  personality_id  INTEGER REFERENCES personalities(id) ON DELETE SET NULL,
  headline        TEXT NOT NULL,
  claim           TEXT,
  verdict         TEXT DEFAULT 'fake',  -- fake | misleading | notsure
  debunk          TEXT,
  sources         TEXT DEFAULT '[]',    -- JSON array of source URLs
  severity        TEXT DEFAULT 'medium', -- low | medium | high
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User follows
CREATE TABLE IF NOT EXISTS follows (
  user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
  personality_id INTEGER REFERENCES personalities(id) ON DELETE CASCADE,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, personality_id)
);

-- User threads
CREATE TABLE IF NOT EXISTS threads (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
  personality_id INTEGER REFERENCES personalities(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- News saved in threads
CREATE TABLE IF NOT EXISTS thread_news (
  thread_id  INTEGER REFERENCES threads(id) ON DELETE CASCADE,
  news_id    INTEGER REFERENCES news(id) ON DELETE CASCADE,
  saved_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (thread_id, news_id)
);

-- Reactions (likes, saves)
CREATE TABLE IF NOT EXISTS reactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  news_id    INTEGER REFERENCES news(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,  -- like | save
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, news_id, type)
);

-- Community truth ratings
CREATE TABLE IF NOT EXISTS news_ratings (
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  news_id    INTEGER REFERENCES news(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, news_id)
);

-- Reaction controls (kill switch + granular blocks)
CREATE TABLE IF NOT EXISTS reaction_controls (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scope        TEXT NOT NULL,   -- global | personality | user
  target_id    INTEGER,         -- personality_id or user_id (NULL for global)
  enabled      INTEGER DEFAULT 1,
  blocked_types TEXT DEFAULT '[]', -- JSON: ["like","save"]
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- AI usage log
CREATE TABLE IF NOT EXISTS ai_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  endpoint    TEXT,
  prompt_len  INTEGER,
  tokens_est  INTEGER,
  cached      INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,   -- create | update | delete | role_change | fetch | toggle
  entity_type TEXT,            -- user | personality | news | fake_news | source | category | reaction_control
  entity_id   INTEGER,
  detail      TEXT,            -- JSON string with before/after or description
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Platform settings (key-value)
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed default categories
INSERT OR IGNORE INTO categories (name, color) VALUES
  ('politics',     '#B54A2E'),
  ('sports',       '#4A6741'),
  ('business',     '#2B5EA7'),
  ('technology',   '#7C3AED'),
  ('entertainment','#C9963A'),
  ('international','#0F766E'),
  ('social',       '#9D174D'),
  ('general',      '#6B5B3E');

-- Seed default global reaction control
INSERT OR IGNORE INTO reaction_controls (id, scope, target_id, enabled) VALUES (1, 'global', NULL, 1);

-- Seed default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('site_name', 'MakeMyThread'),
  ('news_fetch_interval', '60'),
  ('ai_rate_limit', '10'),
  ('fake_radar_public', '1');

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- API Keys
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME
);

-- Reaction Settings (global defaults per type)
CREATE TABLE IF NOT EXISTS reaction_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  icon TEXT NOT NULL
);

-- Per-personality reaction overrides
CREATE TABLE IF NOT EXISTS personality_reaction_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personality_id INTEGER NOT NULL REFERENCES personalities(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(personality_id, type)
);

-- User blocks (admin can block users from reacting)
CREATE TABLE IF NOT EXISTS user_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  blocked INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL DEFAULT 'Admin blocked',
  blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed reaction settings
INSERT OR IGNORE INTO reaction_settings (type, label, enabled, icon) VALUES
  ('like',    'Like',    1, 'Heart'),
  ('save',    'Save',    1, 'Bookmark'),
  ('share',   'Share',   1, 'Share2'),
  ('comment', 'Comment', 1, 'MessageCircle'),
  ('rate',    'Rate',    1, 'Star');
