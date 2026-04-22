const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './database/mmt.db';
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Ensure database directory exists
const dbDir = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.resolve(DB_PATH));

// WAL mode: prevents lock errors under concurrent reads + significantly faster writes
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -32000');   // 32 MB page cache

// Apply schema on first run
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// Migrations: add columns that may not exist in older DBs
const migrations = [
  "ALTER TABLE personalities ADD COLUMN gender TEXT DEFAULT 'other'",
  "ALTER TABLE personalities ADD COLUMN age INTEGER",
  `CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS article_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    news_id INTEGER NOT NULL REFERENCES news(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_article_tags ON article_tags(thread_id, news_id, user_id, tag)`,
  `CREATE INDEX IF NOT EXISTS idx_article_tags_thread ON article_tags(thread_id)`,
  `CREATE INDEX IF NOT EXISTS idx_article_tags_thread_news ON article_tags(thread_id, news_id)`,
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token_hash)`,
];
for (const m of migrations) {
  try { db.exec(m); } catch(e) { /* already exists */ }
}

// Helpers
const audit = (adminId, action, entityType, entityId, detail = {}) => {
  db.prepare(
    `INSERT INTO audit_log (admin_id, action, entity_type, entity_id, detail)
     VALUES (?, ?, ?, ?, ?)`
  ).run(adminId, action, entityType, entityId, JSON.stringify(detail));
};

const logAI = (userId, endpoint, promptLen, tokensEst, cached = 0) => {
  db.prepare(
    `INSERT INTO ai_usage (user_id, endpoint, prompt_len, tokens_est, cached)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, endpoint, promptLen, tokensEst, cached ? 1 : 0);
};

module.exports = { db, audit, logAI };
