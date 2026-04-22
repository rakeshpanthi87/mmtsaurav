const router = require('express').Router();
const { db } = require('../database/db');
const { optionalAuth } = require('../middleware/auth');

// GET /api/news/feed — personalised feed (requires auth) or discovery feed
router.get('/feed', optionalAuth, (req, res) => {
  const { personality_id, category, page=1, limit=20 } = req.query;
  let sql = `SELECT n.*, p.name as person_name, p.initials, p.avatar_bg, p.avatar_fg, p.slug
             FROM news n LEFT JOIN personalities p ON p.id=n.personality_id WHERE 1=1`;
  const params = [];

  if (req.user && !personality_id) {
    // followed personalities
    const followed = db.prepare('SELECT personality_id FROM follows WHERE user_id=?').all(req.user.id).map(r=>r.personality_id);
    if (followed.length) { sql+= ` AND n.personality_id IN (${followed.map(()=>'?').join(',')})`; params.push(...followed); }
  }
  if (personality_id) { sql+=' AND n.personality_id=?'; params.push(personality_id); }
  if (category)       { sql+=' AND n.category=?'; params.push(category); }

  const total = db.prepare(sql.replace('SELECT n.*, p.name as person_name, p.initials, p.avatar_bg, p.avatar_fg, p.slug','SELECT COUNT(*) as c')).get(...params).c;
  sql += ` ORDER BY n.created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));
  res.json({ total, page: parseInt(page), data: db.prepare(sql).all(...params) });
});

// GET /api/news/personalities — all personalities for discover screen
router.get('/personalities', (req, res) => {
  const rows = db.prepare(
    `SELECT p.*, COUNT(DISTINCT f.user_id) as followers
     FROM personalities p LEFT JOIN follows f ON f.personality_id=p.id
     GROUP BY p.id ORDER BY followers DESC`
  ).all();
  res.json(rows);
});

// GET /api/news/personalities/:slug — single personality profile
router.get('/personalities/:slug', (req, res) => {
  const p = db.prepare(
    `SELECT p.*, COUNT(DISTINCT f.user_id) as followers
     FROM personalities p LEFT JOIN follows f ON f.personality_id=p.id
     WHERE p.slug=? GROUP BY p.id`
  ).get(req.params.slug);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const news = db.prepare('SELECT * FROM news WHERE personality_id=? ORDER BY created_at DESC LIMIT 20').all(p.id);
  const fake = db.prepare('SELECT * FROM fake_news WHERE personality_id=? ORDER BY created_at DESC').all(p.id);
  res.json({ ...p, news, fake_news: fake });
});

// GET /api/news/fake-news — all fake news for Fake Radar screen
router.get('/fake-news', (req, res) => {
  const rows = db.prepare(
    `SELECT f.*, p.name as person_name, p.initials, p.avatar_bg, p.avatar_fg
     FROM fake_news f LEFT JOIN personalities p ON p.id=f.personality_id
     ORDER BY f.created_at DESC`
  ).all();
  res.json(rows);
});

// GET /api/news/categories
router.get('/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY name').all());
});

// POST /api/news/follows/:personality_id — toggle follow
router.post('/follows/:personality_id', optionalAuth, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Login required' });
  const pid = parseInt(req.params.personality_id);
  const existing = db.prepare('SELECT 1 FROM follows WHERE user_id=? AND personality_id=?').get(req.user.id, pid);
  if (existing) {
    db.prepare('DELETE FROM follows WHERE user_id=? AND personality_id=?').run(req.user.id, pid);
    res.json({ following: false });
  } else {
    db.prepare('INSERT OR IGNORE INTO follows (user_id, personality_id) VALUES (?,?)').run(req.user.id, pid);
    res.json({ following: true });
  }
});

// GET /api/news/follows — my followed personalities
router.get('/follows', optionalAuth, (req, res) => {
  if (!req.user) return res.json([]);
  const rows = db.prepare(
    `SELECT p.* FROM personalities p
     INNER JOIN follows f ON f.personality_id=p.id WHERE f.user_id=?`
  ).all(req.user.id);
  res.json(rows);
});

// POST /api/news/reactions — like or save
router.post('/reactions', optionalAuth, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Login required' });
  const { news_id, type } = req.body;
  if (!['like','save'].includes(type)) return res.status(400).json({ error: 'Invalid type' });

  // Check global reaction control
  const ctrl = db.prepare("SELECT enabled FROM reaction_controls WHERE scope='global'").get();
  if (ctrl && !ctrl.enabled) return res.status(403).json({ error: 'Reactions are currently disabled' });

  // Check user block
  const blocked = db.prepare("SELECT enabled FROM reaction_controls WHERE scope='user' AND target_id=?").get(req.user.id);
  if (blocked && !blocked.enabled) return res.status(403).json({ error: 'Your reaction access is restricted' });

  const existing = db.prepare('SELECT id FROM reactions WHERE user_id=? AND news_id=? AND type=?').get(req.user.id, news_id, type);
  if (existing) {
    db.prepare('DELETE FROM reactions WHERE id=?').run(existing.id);
    res.json({ active: false });
  } else {
    db.prepare('INSERT INTO reactions (user_id,news_id,type) VALUES (?,?,?)').run(req.user.id, news_id, type);
    res.json({ active: true });
  }
});

// POST /api/news/ratings — community truth rating
router.post('/ratings', optionalAuth, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Login required' });
  const { news_id, rating } = req.body;
  if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });
  db.prepare('INSERT OR REPLACE INTO news_ratings (user_id,news_id,rating) VALUES (?,?,?)').run(req.user.id, news_id, rating);
  const avg = db.prepare('SELECT AVG(rating) as avg, COUNT(*) as count FROM news_ratings WHERE news_id=?').get(news_id);
  res.json({ avg: Math.round(avg.avg*10)/10, count: avg.count });
});

module.exports = router;
