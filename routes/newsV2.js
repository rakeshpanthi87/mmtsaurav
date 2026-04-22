const router = require('express').Router();
const { db } = require('../database/db');
const { requireAuth, requireAdmin, optionalAuth } = require('../middleware/auth');

function formatNewsItem(n, userId) {
  let personality = null;
  if (n.personality_id) {
    const p = db.prepare('SELECT * FROM personalities WHERE id=?').get(n.personality_id);
    if (p) personality = {
      id: p.id, name: p.name, category: p.category || '',
      nationality: p.nationality || '', gender: p.gender || 'other', age: p.age || null,
      bio: p.bio || '', avatarInitials: p.initials || p.name.slice(0,2).toUpperCase(),
      avatarColor: p.avatar_bg || '#C9963A', isBreaking: !!p.is_breaking,
      followersCount: 0, newsCount: 0, isFollowed: false, tags: [], createdAt: p.created_at,
    };
  }
  let userRating = null;
  let userReactions = { liked: false, saved: false, shared: false };
  if (userId) {
    const rating = db.prepare('SELECT rating FROM news_ratings WHERE user_id=? AND news_id=?').get(userId, n.id);
    if (rating) userRating = rating.rating >= 4 ? 'fact' : rating.rating <= 2 ? 'fake' : 'notsure';
    const reactions = db.prepare('SELECT type FROM reactions WHERE user_id=? AND news_id=?').all(userId, n.id);
    userReactions = {
      liked: reactions.some(r => r.type === 'like'),
      saved: reactions.some(r => r.type === 'save'),
      shared: reactions.some(r => r.type === 'share'),
    };
  }
  const factRatings = db.prepare('SELECT COUNT(*) as c FROM news_ratings WHERE news_id=? AND rating>=4').get(n.id).c;
  const fakeRatings = db.prepare('SELECT COUNT(*) as c FROM news_ratings WHERE news_id=? AND rating<=2').get(n.id).c;
  const totalRatings = db.prepare('SELECT COUNT(*) as c FROM news_ratings WHERE news_id=?').get(n.id).c;
  const notsureRatings = Math.max(0, totalRatings - factRatings - fakeRatings);
  const likeCount = db.prepare("SELECT COUNT(*) as c FROM reactions WHERE news_id=? AND type='like'").get(n.id).c;
  const saveCount = db.prepare("SELECT COUNT(*) as c FROM reactions WHERE news_id=? AND type='save'").get(n.id).c;
  const shareCount = db.prepare("SELECT COUNT(*) as c FROM reactions WHERE news_id=? AND type='share'").get(n.id).c;

  let tags = [];
  try { tags = typeof n.tags === 'string' ? JSON.parse(n.tags || '[]') : (n.tags || []); } catch(e) {}

  return {
    id: n.id,
    headline: n.title || n.headline || '',
    snippet: n.snippet || '',
    source: n.source_name || n.source || '',
    category: n.category || 'general',
    tags,
    personalityId: n.personality_id || null,
    personality,
    bannerColor: n.img_color || n.banner_color || '#C9963A',
    isBreaking: !!n.is_breaking,
    factRatings, notsureRatings, fakeRatings,
    userRating, likeCount, shareCount, saveCount, commentCount: 0,
    userReactions,
    publishedAt: n.published_at || n.created_at,
    createdAt: n.created_at,
    url: n.source_url || null,
  };
}

// GET /api/news
router.get('/news', optionalAuth, (req, res) => {
  const { personalityId, category, search, feedOnly, page=1, limit=20 } = req.query;
  const userId = req.user?.id;
  const pageNum = parseInt(page), limitNum = Math.min(parseInt(limit), 100);
  const offset = (pageNum-1)*limitNum;

  let sql = 'SELECT * FROM news WHERE 1=1';
  const params = [];

  if (personalityId) { sql += ' AND personality_id=?'; params.push(parseInt(personalityId)); }
  if (category && category !== 'all') { sql += ' AND category=?'; params.push(category); }
  if (search) { sql += ' AND title LIKE ?'; params.push(`%${search}%`); }

  if (feedOnly === 'true' && userId) {
    const follows = db.prepare('SELECT personality_id FROM follows WHERE user_id=?').all(userId).map(f=>f.personality_id);
    if (!follows.length) return res.json({ posts: [], total: 0, page: pageNum, totalPages: 0 });
    sql += ` AND personality_id IN (${follows.map(()=>'?').join(',')})`;
    params.push(...follows);
  }

  const total = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as c')).get(...params).c;
  sql += ' ORDER BY COALESCE(published_at, created_at) DESC LIMIT ? OFFSET ?';
  params.push(limitNum, offset);

  const posts = db.prepare(sql).all(...params);
  res.json({ posts: posts.map(n => formatNewsItem(n, userId)), total, page: pageNum, totalPages: Math.ceil(total/limitNum) });
});

// POST /api/news/:id/rate
router.post('/news/:id/rate', requireAuth, (req, res) => {
  const newsId = parseInt(req.params.id);
  if (isNaN(newsId)) return res.status(400).json({ error: 'Invalid id' });
  const userId = req.user.id;
  const { rating } = req.body;
  if (!['fact','notsure','fake'].includes(rating))
    return res.status(400).json({ error: 'rating must be fact|notsure|fake' });
  const ratingNum = rating === 'fact' ? 5 : rating === 'notsure' ? 3 : 1;
  db.prepare('INSERT OR REPLACE INTO news_ratings (user_id, news_id, rating) VALUES (?,?,?)').run(userId, newsId, ratingNum);
  const n = db.prepare('SELECT * FROM news WHERE id=?').get(newsId);
  if (!n) return res.status(404).json({ error: 'Not found' });
  res.json(formatNewsItem(n, userId));
});

// POST /api/news/:id/react
router.post('/news/:id/react', requireAuth, (req, res) => {
  const newsId = parseInt(req.params.id);
  if (isNaN(newsId)) return res.status(400).json({ error: 'Invalid id' });
  const userId = req.user.id;
  const { type } = req.body;
  if (!['like','save','share','comment'].includes(type))
    return res.status(400).json({ error: 'type must be like|save|share|comment' });

  const n = db.prepare('SELECT id FROM news WHERE id=?').get(newsId);
  if (!n) return res.status(404).json({ error: 'Not found' });

  const existing = db.prepare('SELECT id FROM reactions WHERE user_id=? AND news_id=? AND type=?').get(userId, newsId, type);
  let active = false;
  if (existing) {
    db.prepare('DELETE FROM reactions WHERE id=?').run(existing.id);
  } else {
    db.prepare('INSERT INTO reactions (user_id, news_id, type) VALUES (?,?,?)').run(userId, newsId, type);
    active = true;
  }
  const count = db.prepare('SELECT COUNT(*) as c FROM reactions WHERE news_id=? AND type=?').get(newsId, type).c;
  res.json({ type, active, count });
});

// ── GET /api/fake-news — public fake news list ──────────────────
router.get('/fake-news', optionalAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT f.*, p.name as p_name, p.initials as p_initials,
            p.avatar_bg as p_bg, p.avatar_fg as p_fg, p.slug as p_slug
     FROM fake_news f LEFT JOIN personalities p ON p.id=f.personality_id
     ORDER BY f.created_at DESC`
  ).all();

  // Also include real news articles that community has flagged as mostly-fake
  const flaggedNews = db.prepare(`
    SELECT n.id, n.title as headline, n.snippet as claim, n.source_name, n.created_at,
           p.name as p_name, p.initials as p_initials, p.avatar_bg as p_bg, p.id as p_id,
           SUM(CASE WHEN nr.rating<=2 THEN 1 ELSE 0 END) as fake_votes,
           SUM(CASE WHEN nr.rating>=4 THEN 1 ELSE 0 END) as fact_votes,
           COUNT(*) as total_votes
    FROM news n
    JOIN news_ratings nr ON nr.news_id=n.id
    LEFT JOIN personalities p ON p.id=n.personality_id
    GROUP BY n.id
    HAVING total_votes >= 3 AND fake_votes * 1.0 / total_votes >= 0.5
    ORDER BY fake_votes DESC LIMIT 20
  `).all();

  const fakeItems = rows.map(f => {
    let sources = [];
    try { sources = JSON.parse(f.sources || '[]'); } catch(_) {}
    return {
      id: f.id, type: 'admin',
      personalityId: f.personality_id,
      personName: f.p_name || null,
      personInitials: f.p_initials || '?',
      personBg: f.p_bg || '#C9963A',
      personColor: f.p_fg || '#fff',
      personSlug: f.p_slug || null,
      headline: f.headline,
      claim: f.claim || '',
      debunk: f.debunk || '',
      verdict: f.verdict || 'fake',
      sources,
      severity: f.severity || 'medium',
      communityVotes: { fact: 0, notsure: 0, fake: 0 },
      createdAt: f.created_at,
    };
  });

  const flaggedItems = flaggedNews.map(n => ({
    id: `flagged_${n.id}`,
    newsId: n.id,
    type: 'community',
    personalityId: n.p_id,
    personName: n.p_name || null,
    personInitials: n.p_initials || '?',
    personBg: n.p_bg || '#C9963A',
    headline: n.headline,
    claim: n.claim || '',
    debunk: 'Community members have flagged this article as likely false or misleading.',
    verdict: 'fake',
    sources: [n.source_name].filter(Boolean),
    communityVotes: { fact: n.fact_votes || 0, notsure: 0, fake: n.fake_votes || 0 },
    createdAt: n.created_at,
  }));

  res.json([...fakeItems, ...flaggedItems]);
});

module.exports = router;
module.exports.formatNewsItem = formatNewsItem;
