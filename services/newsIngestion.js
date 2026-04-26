/**
 * services/newsIngestion.js
 *
 * News ingestion — three parallel sources per cron run:
 *   1. GNews API  — chunked batch queries (all 182 personalities, ~40s total)
 *   2. PINews API — chunked batch queries
 *   3. RSS feeds  — broad coverage from 8 Nepali outlets
 *
 * Deduplication via source_url UNIQUE constraint in DB.
 */

const cron   = require('node-cron');
const Parser = require('rss-parser');
const { db } = require('../database/db');
const { categoriseArticle } = require('./aiRouter');

const rssParser = new Parser({ timeout: 10000 });

// ── Helpers ───────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── GNews batch ───────────────────────────────────────────────────
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
      if (!resp.ok) { console.warn(`  [GNews] ${resp.status} for "${q}"`); continue; }
      const data = await resp.json();
      for (const a of (data.articles || [])) {
        articles.push({ title: a.title, snippet: a.description || '', full_content: a.content || a.description || '', source_name: a.source?.name || 'GNews', source_url: a.url, published_at: a.publishedAt });
      }
      console.log(`  [GNews] "${q}" → ${data.articles?.length || 0} articles`);
    } catch (e) { console.warn(`  [GNews] "${q}": ${e.message}`); }
  }
  return articles;
}

// Chunked batch GNews — all personalities in parallel chunks of 5, 3s gaps
async function fetchGNewsAll(personalities) {
  const key = process.env.GNEWS_API_KEY;
  if (!key) { console.log('[GNews] No API key'); return []; }

  // Build 15-term chunks (safe under 200-char query limit)
  const allArticles = [];
  const chunks = [];
  for (let i = 0; i < personalities.length; i += 5) {
    chunks.push(personalities.slice(i, i + 5));
  }
  console.log(`[GNews] ${personalities.length} personalities → ${chunks.length} batches (5 per batch)`);

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    // Build OR query from chunk names
    const names = chunk.map(p => `"${p.name}"`).join(' OR ') + ' Nepal';
    const url   = `https://gnews.io/api/v4/search?q=${encodeURIComponent(names)}&lang=en&max=10&sortby=publishedAt&token=${key}`;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (resp.status === 429) {
        console.log(`  [GNews] batch ${ci+1}/${chunks.length} rate-limited — waiting 65s`);
        await sleep(65000);
        // Retry once after wait
        const r2 = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!r2.ok) { console.warn(`  [GNews] batch ${ci+1} HTTP ${r2.status} after retry`); }
        else {
          const d = await r2.json();
          console.log(`  [GNews] batch ${ci+1}/${chunks.length}: ${(d.articles||[]).length} articles`);
          for (const a of (d.articles || [])) {
            allArticles.push({ title: a.title, snippet: a.description||'', full_content: a.content||a.description||'', source_name: a.source?.name||'GNews', source_url: a.url, published_at: a.publishedAt });
          }
        }
      } else if (!resp.ok) {
        console.warn(`  [GNews] batch ${ci+1} HTTP ${resp.status}`);
      } else {
        const data = await resp.json();
        console.log(`  [GNews] batch ${ci+1}/${chunks.length}: ${(data.articles||[]).length} articles`);
        for (const a of (data.articles || [])) {
          allArticles.push({ title: a.title, snippet: a.description||'', full_content: a.content||a.description||'', source_name: a.source?.name||'GNews', source_url: a.url, published_at: a.publishedAt });
        }
      }
    } catch (e) { console.warn(`  [GNews] batch ${ci+1} error: ${e.message}`); }
    // 3s gap between batches to avoid rate limiting
    if (ci < chunks.length - 1) await sleep(3000);
  }
  return allArticles;
}

// ── PINews batch ─────────────────────────────────────────────────
async function fetchPINewsAll(personalities) {
  const key      = process.env.PINEWS_API_KEY;
  const endpoint = process.env.PINEWS_ENDPOINT || 'https://api.apinews.net/news';
  if (!key) return [];
  const allArticles = [];
  const chunks = [];
  for (let i = 0; i < personalities.length; i += 15) {
    chunks.push(personalities.slice(i, i + 15));
  }
  console.log(`[PINews] ${personalities.length} personalities → ${chunks.length} batches`);

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    for (const p of chunk) {
      for (const q of [p.name, p.name_local].filter(Boolean)) {
        try {
          const url = `${endpoint}?q=${encodeURIComponent(q)}&apiKey=${key}&language=en&pageSize=10`;
          const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!resp.ok) continue;
          const data = await resp.json();
          const items = data.articles || data.results || data.data || [];
          for (const a of items) {
            allArticles.push({ title: a.title||a.headline||'', snippet: a.description||a.summary||'', full_content: a.content||a.body||a.description||'', source_name: (typeof a.source === 'string' ? a.source : a.source?.name)||'PINews', source_url: a.url||a.link||'', published_at: a.publishedAt||a.pubDate||new Date().toISOString() });
          }
        } catch {}
      }
      await sleep(1000);
    }
  }
  return allArticles;
}

// ── RSS source ────────────────────────────────────────────────────
async function fetchSource(source) {
  if (source.type !== 'rss') return 0;
  let feed;
  try { feed = await rssParser.parseURL(source.url); }
  catch (e) { console.warn(`[RSS] ${source.name}: ${e.message}`); return 0; }

  const personality = source.personality_id ? db.prepare('SELECT * FROM personalities WHERE id=?').get(source.personality_id) : null;
  let added = 0;
  for (const item of (feed.items || []).slice(0, 15)) {
    const title = item.title?.trim();
    if (!title) continue;
    if (db.prepare('SELECT id FROM news WHERE source_url=?').get(item.link)) continue;
    const snippet  = (item.contentSnippet || item.summary || '').slice(0, 500);
    const category = await categoriseArticle(title, snippet).catch(() => 'general');
    const pubAt    = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();
    const r = db.prepare(
      `INSERT OR IGNORE INTO news (personality_id, source_id, title, snippet, source_name, source_url, category, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(source.personality_id || null, source.id, title, snippet, feed.title || 'RSS', item.link || '', category, pubAt);
    if (r.changes > 0) added++;
  }
  db.prepare('UPDATE news_sources SET last_fetched=CURRENT_TIMESTAMP WHERE id=?').run(source.id);
  if (added > 0 && source.personality_id) pushSSE(source.personality_id, personality?.name);
  return added;
}

// ── Insert helper ─────────────────────────────────────────────────
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
         (personality_id, title, snippet, full_content, source_name, source_url, category, credibility, is_breaking, img_color, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 88, 0, ?, ?)`
    ).run(personalityId, a.title, (a.snippet||'').slice(0,500), (a.full_content||'').slice(0,10000), a.source_name, a.source_url, category, COLOR_MAP[category]||'#DBEAFE', a.published_at || new Date().toISOString());
    if (r.changes > 0) inserted++;
  }
  return inserted;
}

// ── SSE helper ────────────────────────────────────────────────────
function pushSSE(personalityId, personName) {
  try {
    const { notifyFollowers } = require('../routes/sse');
    const followers = db.prepare('SELECT user_id FROM follows WHERE personality_id=?').all(personalityId).map(r => r.user_id);
    if (followers.length && personName) notifyFollowers(followers, personName, 'New articles');
  } catch {}
}

// ── Main run ──────────────────────────────────────────────────────
async function runAll() {
  const personalities = db.prepare('SELECT * FROM personalities').all();
  if (!personalities.length) {
    console.log('[News] No personalities in DB');
    return;
  }

  console.log(`\n[News] ${new Date().toLocaleTimeString()} — ${personalities.length} personalities`);

  // Run GNews and PINews in parallel (each handles all personalities internally)
  const [gnewsArticles, pinewsArticles] = await Promise.all([
    fetchGNewsAll(personalities),
    fetchPINewsAll(personalities),
  ]);
  console.log(`[News] GNews: ${gnewsArticles.length} articles, PINews: ${pinewsArticles.length} articles`);

  // Distribute articles to personalities by keyword matching
  let total = 0;
  const slugIndex = {};
  for (const p of personalities) {
    slugIndex[p.slug] = p.id;
  }

  // Match GNews articles
  for (const a of gnewsArticles) {
    const text = (a.title + ' ' + a.snippet).toLowerCase();
    let matched = false;
    for (const p of personalities) {
      const kws = (p.name + ' ' + (p.name_local || '') + ' ' + p.slug).toLowerCase().split(/[\s\-]+/);
      if (kws.some(kw => kw.length > 3 && text.includes(kw))) {
        const inserted = await insertArticles([a], p.id);
        if (inserted > 0) { total++; pushSSE(p.id, p.name); }
        matched = true;
        break;
      }
    }
  }

  // Match PINews articles
  for (const a of pinewsArticles) {
    const text = (a.title + ' ' + a.snippet).toLowerCase();
    for (const p of personalities) {
      const kws = (p.name + ' ' + (p.name_local || '') + ' ' + p.slug).toLowerCase().split(/[\s\-]+/);
      if (kws.some(kw => kw.length > 3 && text.includes(kw))) {
        const inserted = await insertArticles([a], p.id);
        if (inserted > 0) { total++; pushSSE(p.id, p.name); }
        break;
      }
    }
  }

  // RSS sources
  const sources = db.prepare('SELECT * FROM news_sources WHERE is_active=1').all();
  for (const src of sources) {
    const mins = src.last_fetched ? (Date.now() - new Date(src.last_fetched).getTime()) / 60000 : Infinity;
    if (mins >= (src.fetch_interval || 60)) {
      total += await fetchSource(src);
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

module.exports = { startCron, fetchSource, runAll, fetchGNews, fetchPINewsAll };
