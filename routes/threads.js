const router = require('express').Router();
const { db } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

// Keyword → PascalCase tag mapping for auto-tag generation
const TAG_KEYWORDS = {
  'balen shah': 'BalenShah', 'mayor balen': 'BalenShah', 'balen': 'BalenShah',
  'kp sharma oli': 'KPOli', 'kp oli': 'KPOli', 'k.p. oli': 'KPOli', 'pm oli': 'KPOli', 'oli': 'KPOli',
  'pushpa kamal dahal': 'Prachanda', 'prachanda': 'Prachanda', 'dahal': 'Prachanda',
  'sher bahadur deuba': 'SherBahadurDeuba', 'deuba': 'SherBahadurDeuba',
  'gagan thapa': 'GaganThapa',
  'rabi lamichhane': 'RabiLamichhane', 'rabi lamichane': 'RabiLamichhane',
  'madhav kumar nepal': 'MadhavNepal', 'madhav nepal': 'MadhavNepal',
  'biswas': 'GovtOfficial', 'minister': 'Cabinet', 'prime minister': 'PMOffice',
  'nepali congress': 'NepaliCongress', 'congress party': 'NepaliCongress',
  'cml-uml': 'CPN_UML', 'uml': 'CPN_UML', 'maoist': 'MaoistCenter',
  'rpp': 'RPP', 'rastriya prajatantra': 'RPP',
  'parliament': 'Parliament', 'house of representatives': 'Parliament', 'national assembly': 'NationalAssembly',
  'supreme court': 'SupremeCourt', 'judiciary': 'Judiciary', 'court': 'Judiciary',
  'election commission': 'ElectionCommission', 'election': 'Election',
  'ciaa': 'AntiCorruption', 'commission for investigation': 'AntiCorruption', 'corruption': 'Corruption',
  'nepal army': 'NepalArmy', 'armed police': 'ArmedPolice', 'nepal police': 'NepalPolice',
  'nepal rastra bank': 'CentralBank', 'nrb': 'CentralBank', 'central bank': 'CentralBank',
  'nepal telecom': 'NepalTelecom', 'ncell': 'Ncell',
  'nepse': 'StockMarket', 'share market': 'StockMarket', 'stock market': 'StockMarket',
  'budget': 'Budget', 'fiscal policy': 'FiscalPolicy', 'tax': 'Taxation',
  'china': 'ChinaRelations', 'belt and road': 'BeltAndRoad', 'bri': 'BeltAndRoad',
  'india': 'IndiaRelations', 'border': 'BorderDispute', 'kalapani': 'BorderDispute',
  'hydropower': 'HydroPower', 'electricity': 'Energy', 'energy crisis': 'Energy',
  'earthquake': 'Earthquake', 'flood': 'NaturalDisaster', 'disaster': 'NaturalDisaster',
  'remittance': 'Economy', 'inflation': 'Economy', 'economy': 'Economy',
  'tourism': 'Tourism', 'everest': 'Everest',
  'real estate': 'RealEstate', 'property': 'RealEstate',
  'agriculture': 'Agriculture', 'farming': 'Agriculture',
  'education': 'Education', 'school': 'Education', 'university': 'Education',
  'health': 'Health', 'hospital': 'Health', 'medical': 'Health',
  'technology': 'Technology', 'internet': 'Technology', 'digital': 'Technology',
};

function generateAutoTags(newsItem, personality) {
  const tags = new Set();
  const text = [newsItem.title || '', newsItem.snippet || '', newsItem.source_name || ''].join(' ').toLowerCase();

  if (personality) {
    const pTag = personality.name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    tags.add(pTag);
    if (personality.category) {
      const cat = personality.category.charAt(0).toUpperCase() + personality.category.slice(1).toLowerCase();
      tags.add(cat);
    }
  }

  for (const [kw, tag] of Object.entries(TAG_KEYWORDS)) {
    if (text.includes(kw.toLowerCase())) tags.add(tag);
  }

  if (newsItem.category && newsItem.category !== 'general') {
    tags.add(newsItem.category.charAt(0).toUpperCase() + newsItem.category.slice(1).toLowerCase());
  }

  const dateStr = newsItem.published_at || newsItem.created_at;
  if (dateStr) {
    const yr = new Date(dateStr).getFullYear();
    if (yr >= 2020 && yr <= 2030) tags.add('Year' + yr);
  }

  if (newsItem.source_name) {
    const src = newsItem.source_name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
    if (src) tags.add(src);
  }

  return [...tags].sort();
}

// ── Cluster intelligence helpers ──────────────────────────────
function classifyClusterType(n) {
  const text = ((n.title || '') + ' ' + (n.snippet || '')).toLowerCase();
  if (/arrest|detain|custody|jail|imprison/.test(text)) return 'Arrest';
  if (/court|verdict|ruling|charge|acquit|case/.test(text)) return 'Legal';
  if (/corruption|scam|bribe|scandal|fraud|embezzl/.test(text)) return 'Scandal';
  if (/conflict|clash|dispute|protest|unrest|riot/.test(text)) return 'Conflict';
  if (/election|vote|ballot|campaign|candidate/.test(text)) return 'Election';
  if (/policy|law|bill|act|reform|regulation|amend/.test(text)) return 'Policy';
  if (/interview|spoke|statement|press conference|address/.test(text)) return 'Interview';
  if (/china|india|foreign|international|diplomat|united nations|world/.test(text)) return 'International';
  if (/economy|budget|finance|market|inflation|gdp|fiscal/.test(text)) return 'Economy';
  if (/death|died|killed|murder|assassin/.test(text)) return 'Breaking';
  return 'General';
}

function computeImpactScore(newsId, n) {
  const likes = db.prepare("SELECT COUNT(*) as c FROM reactions WHERE news_id=? AND type='like'").get(newsId).c;
  const shares = db.prepare("SELECT COUNT(*) as c FROM reactions WHERE news_id=? AND type='share'").get(newsId).c;
  const ratings = db.prepare('SELECT COUNT(*) as c FROM news_ratings WHERE news_id=?').get(newsId).c;
  const raw = likes * 2 + shares * 3 + ratings + (n.is_breaking ? 8 : 0);
  if (raw >= 10) return 'high';
  if (raw >= 3) return 'medium';
  return 'low';
}

function computeCredibility(newsId) {
  const votes = db.prepare('SELECT rating FROM news_ratings WHERE news_id=?').all(newsId);
  if (votes.length < 2) return { score: null, mixed: false };
  const fact = votes.filter(v => v.rating >= 4).length;
  const fake = votes.filter(v => v.rating <= 2).length;
  const total = votes.length;
  const score = Math.round((fact / total) * 100);
  const mixed = fact > 0 && fake > 0 && (fake / total > 0.2) && (fact / total > 0.2);
  return { score, mixed };
}

function formatThread(t) {
  const count = db.prepare('SELECT COUNT(*) as c FROM thread_news WHERE thread_id=?').get(t.id).c;
  let personality = null;
  if (t.personality_id) {
    const p = db.prepare('SELECT * FROM personalities WHERE id=?').get(t.personality_id);
    if (p) personality = {
      id: p.id, name: p.name,
      avatarInitials: p.initials || p.name.slice(0,2).toUpperCase(),
      avatarColor: p.avatar_bg || '#C9963A',
      category: p.category || '',
    };
  }
  return {
    id: t.id, name: t.name, userId: t.user_id,
    personalityId: t.personality_id || null, personality,
    itemCount: count, createdAt: t.created_at,
  };
}

// GET /api/threads
router.get('/threads', requireAuth, (req, res) => {
  const threads = db.prepare('SELECT * FROM threads WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json(threads.map(formatThread));
});

// POST /api/threads
router.post('/threads', requireAuth, (req, res) => {
  const { name, personalityId } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare('INSERT INTO threads (user_id, personality_id, name) VALUES (?,?,?)').run(req.user.id, personalityId||null, name);
  const t = db.prepare('SELECT * FROM threads WHERE id=?').get(result.lastInsertRowid);
  res.status(201).json(formatThread(t));
});

// GET /api/threads/:id
router.get('/threads/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const t = db.prepare('SELECT * FROM threads WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const items = db.prepare('SELECT * FROM thread_news WHERE thread_id=? ORDER BY saved_at DESC').all(id);
  const userId = req.user.id;
  const newsPosts = items.map(item => {
    const n = db.prepare('SELECT * FROM news WHERE id=?').get(item.news_id);
    if (!n) return null;
    const p = n.personality_id ? db.prepare('SELECT * FROM personalities WHERE id=?').get(n.personality_id) : null;
    const autoTags = generateAutoTags(n, p);
    const userTags = db.prepare('SELECT tag FROM article_tags WHERE thread_id=? AND news_id=? AND user_id=?')
      .all(id, n.id, userId).map(r => r.tag);
    const clusterType = classifyClusterType(n);
    const impactScore = computeImpactScore(n.id, n);
    const { score: credibilityScore, mixed: credibilityMixed } = computeCredibility(n.id);
    const reasonForInclusion = p
      ? `Personality match: ${p.name}`
      : (n.category && n.category !== 'general' ? `Category: ${n.category}` : 'Manually saved');
    return {
      id: n.id, headline: n.title, snippet: n.snippet || '', source: n.source_name || '',
      category: n.category || 'general',
      personalityId: n.personality_id,
      personality: p ? { id: p.id, name: p.name, avatarInitials: p.initials || p.name.slice(0,2).toUpperCase(), avatarColor: p.avatar_bg || '#C9963A' } : null,
      bannerColor: n.img_color || '#C9963A', isBreaking: !!n.is_breaking,
      autoTags, userTags,
      url: n.source_url || null,
      clusterType, impactScore, credibilityScore, credibilityMixed, reasonForInclusion,
      publishedAt: n.published_at || n.created_at, createdAt: n.created_at,
    };
  }).filter(Boolean);
  res.json({ ...formatThread(t), items: newsPosts });
});

// PATCH /api/threads/:id
router.patch('/threads/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const t = db.prepare('SELECT * FROM threads WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const { name } = req.body;
  if (name) db.prepare('UPDATE threads SET name=? WHERE id=?').run(name, id);
  res.json(formatThread(db.prepare('SELECT * FROM threads WHERE id=?').get(id)));
});

// DELETE /api/threads/:id
router.delete('/threads/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM threads WHERE id=? AND user_id=?').run(id, req.user.id);
  res.sendStatus(204);
});

// POST /api/threads/:id/items
router.post('/threads/:id/items', requireAuth, (req, res) => {
  const threadId = parseInt(req.params.id);
  const t = db.prepare('SELECT * FROM threads WHERE id=? AND user_id=?').get(threadId, req.user.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const { newsId } = req.body;
  if (!newsId) return res.status(400).json({ error: 'newsId required' });
  db.prepare('INSERT OR IGNORE INTO thread_news (thread_id, news_id) VALUES (?,?)').run(threadId, parseInt(newsId));
  res.json({ success: true, message: 'Added' });
});

// DELETE /api/threads/:id/items/:newsId
router.delete('/threads/:id/items/:newsId', requireAuth, (req, res) => {
  const threadId = parseInt(req.params.id);
  const newsId = parseInt(req.params.newsId);
  db.prepare('DELETE FROM thread_news WHERE thread_id=? AND news_id=?').run(threadId, newsId);
  res.sendStatus(204);
});

// GET /api/threads/:id/tags — aggregated tag list for the thread
router.get('/threads/:id/tags', requireAuth, (req, res) => {
  const threadId = parseInt(req.params.id);
  const t = db.prepare('SELECT id FROM threads WHERE id=? AND user_id=?').get(threadId, req.user.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const userTagRows = db.prepare('SELECT news_id, tag FROM article_tags WHERE thread_id=? AND user_id=?')
    .all(threadId, req.user.id);
  const userTags = {};
  userTagRows.forEach(r => {
    if (!userTags[r.news_id]) userTags[r.news_id] = [];
    userTags[r.news_id].push(r.tag);
  });
  res.json({ userTags });
});

// POST /api/threads/:id/items/:newsId/tags — add a user tag to an article
router.post('/threads/:id/items/:newsId/tags', requireAuth, (req, res) => {
  const threadId = parseInt(req.params.id);
  const newsId = parseInt(req.params.newsId);
  const t = db.prepare('SELECT id FROM threads WHERE id=? AND user_id=?').get(threadId, req.user.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const { tag } = req.body;
  if (!tag) return res.status(400).json({ error: 'tag required' });
  const normalizedTag = String(tag).replace(/^#+/, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 50);
  if (!normalizedTag) return res.status(400).json({ error: 'Invalid tag' });
  db.prepare('INSERT OR IGNORE INTO article_tags (thread_id, news_id, user_id, tag) VALUES (?,?,?,?)')
    .run(threadId, newsId, req.user.id, normalizedTag);
  const tags = db.prepare('SELECT tag FROM article_tags WHERE thread_id=? AND news_id=? AND user_id=?')
    .all(threadId, newsId, req.user.id).map(r => r.tag);
  res.json({ tags });
});

// DELETE /api/threads/:id/items/:newsId/tags/:tag — remove a user tag
router.delete('/threads/:id/items/:newsId/tags/:tag', requireAuth, (req, res) => {
  const threadId = parseInt(req.params.id);
  const newsId = parseInt(req.params.newsId);
  const t = db.prepare('SELECT id FROM threads WHERE id=? AND user_id=?').get(threadId, req.user.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM article_tags WHERE thread_id=? AND news_id=? AND user_id=? AND tag=?')
    .run(threadId, newsId, req.user.id, req.params.tag);
  res.sendStatus(204);
});

module.exports = router;
