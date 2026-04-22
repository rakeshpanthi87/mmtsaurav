/**
 * services/newsIngestion.js
 *
 * Three parallel news sources per cron run:
 *   1. GNews API  — targeted search by personality name (structured)
 *   2. PINews API — supplemental search  
 *   3. RSS feeds  — broad coverage from 8 Nepali outlets
 *
 * Each article is auto-categorised by OpenRouter free model before insert.
 * Deduplication via source_url UNIQUE constraint in DB.
 */

const cron   = require('node-cron');
const Parser = require('rss-parser');
const { db } = require('../database/db');
const { categoriseArticle } = require('./aiRouter');

const rssParser = new Parser({ timeout: 10000 });

function getPersonalities() {
  return db.prepare('SELECT * FROM personalities').all();
}

// ── GNews API ─────────────────────────────────────────────────────
// Docs: https://gnews.io/docs/v4
async function fetchGNews(personality) {
  const key = process.env.GNEWS_API_KEY;
  if (!key) return [];

  const queries = [personality.name];
  if (personality.name_local) queries.push(personality.name_local);

  const articles = [];
  for (const q of queries) {
    try {
      const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(`"${q}"`)}&lang=en&max=10&sortby=publishedAt&token=${key}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) { console.warn(`[GNews] ${resp.status} for "${q}"`); continue; }
      const data = await resp.json();
      for (const a of (data.articles || [])) {
        articles.push({
          title:        a.title,
          snippet:      a.description  || '',
          full_content: a.content      || a.description || '',
          source_name:  a.source?.name || 'GNews',
          source_url:   a.url,
          published_at: a.publishedAt,
        });
      }
      console.log(`  [GNews] "${q}" → ${data.articles?.length || 0} articles`);
    } catch (e) { console.warn(`  [GNews] "${q}": ${e.message}`); }
  }
  return articles;
}

// ── PINews API ────────────────────────────────────────────────────
async function fetchPINews(personality) {
  const key      = process.env.PINEWS_API_KEY;
  const endpoint = process.env.PINEWS_ENDPOINT || 'https://api.apinews.net/news';
  if (!key) return [];

  const queries = [personality.name];
  if (personality.name_local) queries.push(personality.name_local);

  const articles = [];
  for (const q of queries) {
    try {
      const url = `${endpoint}?q=${encodeURIComponent(q)}&apiKey=${key}&language=en&pageSize=10`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) { console.warn(`  [PINews] ${resp.status} for "${q}"`); continue; }
      const data = await resp.json();
      // Handle different response shapes across API versions
      const items = data.articles || data.results || data.data || [];
      for (const a of items) {
        articles.push({
          title:        a.title       || a.headline    || '',
          snippet:      a.description || a.summary     || '',
          full_content: a.content     || a.body        || a.description || '',
          source_name:  (typeof a.source === 'string' ? a.source : a.source?.name) || 'PINews',
          source_url:   a.url         || a.link        || '',
          published_at: a.publishedAt || a.pubDate     || new Date().toISOString(),
        });
      }
      console.log(`  [PINews] "${q}" → ${items.length} articles`);
    } catch (e) { console.warn(`  [PINews] "${q}": ${e.message}`); }
  }
  return articles;
}

// ── RSS source (DB-managed, called by admin manual fetch too) ─────
async function fetchSource(source) {
  if (source.type !== 'rss') return 0;
  let feed;
  try { feed = await rssParser.parseURL(source.url); }
  catch (e) { console.warn(`[RSS] ${e.message}`); return 0; }

  const personality = source.personality_id
    ? db.prepare('SELECT * FROM personalities WHERE id=?').get(source.personality_id)
    : null;

  let added = 0;
  for (const item of (feed.items || []).slice(0, 15)) {
    const title = item.title?.trim();
    if (!title) continue;
    if (db.prepare('SELECT id FROM news WHERE source_url=?').get(item.link)) continue;

    const snippet  = (item.contentSnippet || item.summary || '').slice(0, 500);
    const category = await categoriseArticle(title, snippet).catch(() => 'general');
    const pubAt    = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();

    const r = db.prepare(
      `INSERT OR IGNORE INTO news
         (personality_id, source_id, title, snippet, source_name, source_url, category, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(source.personality_id || null, source.id, title, snippet,
          feed.title || 'RSS', item.link || '', category, pubAt);

    if (r.changes > 0) added++;
  }
  db.prepare('UPDATE news_sources SET last_fetched=CURRENT_TIMESTAMP WHERE id=?').run(source.id);
  if (added > 0 && source.personality_id) pushSSE(source.personality_id, personality?.name);
  return added;
}

// ── Insert helper (GNews + PINews both use this) ──────────────────
const COLOR_MAP = {
  politics:'#DBEAFE', sports:'#D1FAE5', business:'#FEF3C7',
  technology:'#EDE9FE', health:'#D1FAE5', social:'#FCE7F3',
  international:'#E0F2FE', general:'#F3F4F6'
};

async function insertArticles(articles, personalityId) {
  let inserted = 0;
  for (const a of articles) {
    if (!a.title || !a.source_url) continue;
    if (db.prepare('SELECT id FROM news WHERE source_url=?').get(a.source_url)) continue;

    const category = await categoriseArticle(a.title, a.snippet).catch(() => 'general');
    const r = db.prepare(
      `INSERT OR IGNORE INTO news
         (personality_id, title, snippet, full_content, source_name, source_url,
          category, credibility, is_breaking, img_color, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 88, 0, ?, ?)`
    ).run(
      personalityId,
      a.title,
      (a.snippet || '').slice(0, 500),
      (a.full_content || '').slice(0, 10000),
      a.source_name,
      a.source_url,
      category,
      COLOR_MAP[category] || '#DBEAFE',
      a.published_at || new Date().toISOString()
    );
    if (r.changes > 0) inserted++;
  }
  return inserted;
}

// ── SSE helper ────────────────────────────────────────────────────
function pushSSE(personalityId, personName) {
  try {
    const { notifyFollowers } = require('../routes/sse');
    const followers = db.prepare('SELECT user_id FROM follows WHERE personality_id=?')
      .all(personalityId).map(r => r.user_id);
    if (followers.length && personName) notifyFollowers(followers, personName, 'New articles');
  } catch {}
}

// ── Main run ──────────────────────────────────────────────────────
async function runAll() {
  const personalities = getPersonalities();
  if (!personalities.length) {
    console.log('[News] No personalities in DB — add them via admin panel');
    return;
  }

  console.log(`\n[News] ${new Date().toLocaleTimeString()} — ${personalities.length} personalities`);
  let total = 0;

  for (const p of personalities) {
    console.log(`  ${p.name}`);

    const [gnews, pinews] = await Promise.all([fetchGNews(p), fetchPINews(p)]);
    const gc = await insertArticles(gnews, p.id);
    const pc = await insertArticles(pinews, p.id);
    if (gc + pc > 0) pushSSE(p.id, p.name);
    total += gc + pc;

    await new Promise(r => setTimeout(r, 1500)); // rate limit pause
  }

  // RSS sources from DB
  const sources = db.prepare('SELECT * FROM news_sources WHERE is_active=1').all();
  for (const src of sources) {
    const mins = src.last_fetched
      ? (Date.now() - new Date(src.last_fetched).getTime()) / 60000 : Infinity;
    if (mins >= (src.fetch_interval || 60)) {
      const c = await fetchSource(src);
      total += c;
    }
  }

  console.log(`[News] Done — inserted: ${total} new articles`);
}

// ── Cron ──────────────────────────────────────────────────────────
function startCron() {
  cron.schedule('*/15 * * * *', () => runAll().catch(e => console.error('[Cron]', e.message)));
  console.log('[News] Cron started — GNews + PINews + RSS every 15 min');
  setTimeout(() => runAll().catch(() => {}), 8000);
}

module.exports = { startCron, fetchSource, runAll, fetchGNews, fetchPINews };
