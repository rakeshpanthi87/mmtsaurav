const router = require('express').Router();
const { db } = require('../database/db');
const { requireAuth, requireAdmin, optionalAuth } = require('../middleware/auth');

function formatPersonality(p, userId) {
  const followers = db.prepare('SELECT COUNT(*) as c FROM follows WHERE personality_id=?').get(p.id).c;
  const newsCount = db.prepare('SELECT COUNT(*) as c FROM news WHERE personality_id=?').get(p.id).c;
  let isFollowed = false;
  if (userId) {
    isFollowed = !!db.prepare('SELECT 1 FROM follows WHERE user_id=? AND personality_id=?').get(userId, p.id);
  }
  let tags = [];
  try { tags = typeof p.topics === 'string' ? JSON.parse(p.topics || '[]') : (p.topics || []); } catch(e) {}
  return {
    id: p.id,
    name: p.name,
    category: p.category || '',
    nationality: p.nationality || '',
    gender: p.gender || 'other',
    age: p.age || null,
    bio: p.bio || '',
    avatarInitials: p.initials || p.name.slice(0,2).toUpperCase(),
    avatarColor: p.avatar_bg || '#C9963A',
    isBreaking: !!p.is_breaking,
    followersCount: followers,
    newsCount,
    isFollowed,
    tags,
    slug: p.slug || null,
    nameLocal: p.name_local || null,
    verified: !!p.verified,
    createdAt: p.created_at,
  };
}

// GET /api/personalities
router.get('/personalities', optionalAuth, (req, res) => {
  const { category, nationality, gender, search, ageGroup } = req.query;
  let sql = 'SELECT * FROM personalities WHERE 1=1';
  const params = [];
  if (category && category !== 'all') { sql += ' AND LOWER(category)=LOWER(?)'; params.push(category); }
  if (nationality && nationality !== 'all') { sql += ' AND LOWER(nationality)=LOWER(?)'; params.push(nationality); }
  if (gender && gender !== 'all') { sql += ' AND gender=?'; params.push(gender); }
  if (search) { sql += ' AND name LIKE ?'; params.push(`%${search}%`); }
  if (ageGroup === 'under40') { sql += ' AND age IS NOT NULL AND age < 40'; }
  if (ageGroup === '40plus') { sql += ' AND age IS NOT NULL AND age >= 40'; }
  sql += ' ORDER BY name';
  const rows = db.prepare(sql).all(...params);
  const userId = req.user?.id;
  res.json(rows.map(p => formatPersonality(p, userId)));
});

// POST /api/personalities (admin)
router.post('/personalities', requireAdmin, (req, res) => {
  const { name, category, nationality, gender, age, bio, avatarInitials, avatarColor, isBreaking, tags } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'name and category required' });
  const initials = avatarInitials || name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const slug = name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
  const existingSlug = db.prepare('SELECT id FROM personalities WHERE slug=?').get(slug);
  if (existingSlug) return res.status(409).json({ error: 'Personality with similar name already exists' });
  const result = db.prepare(
    `INSERT INTO personalities (slug, name, category, nationality, gender, age, bio, initials, avatar_bg, is_breaking, topics)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(slug, name, category, nationality||'', gender||'other', age||null, bio||'', initials, avatarColor||'#C9963A', isBreaking?1:0, JSON.stringify(tags||[]));
  const p = db.prepare('SELECT * FROM personalities WHERE id=?').get(result.lastInsertRowid);
  res.status(201).json(formatPersonality(p));
});

// GET /api/personalities/followed — must be defined before /:id
router.get('/personalities/followed', requireAuth, (req, res) => {
  const follows = db.prepare('SELECT personality_id FROM follows WHERE user_id=?').all(req.user.id);
  if (!follows.length) return res.json([]);
  const ids = follows.map(f => f.personality_id);
  const rows = db.prepare(`SELECT * FROM personalities WHERE id IN (${ids.map(()=>'?').join(',')})`).all(...ids);
  res.json(rows.map(p => formatPersonality(p, req.user.id)));
});

// GET /api/personalities/:id
router.get('/personalities/:id', optionalAuth, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const p = db.prepare('SELECT * FROM personalities WHERE id=?').get(id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(formatPersonality(p, req.user?.id));
});

// PATCH /api/personalities/:id (admin)
router.patch('/personalities/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const p = db.prepare('SELECT * FROM personalities WHERE id=?').get(id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const fieldMap = {
    name:'name', category:'category', nationality:'nationality', gender:'gender',
    age:'age', bio:'bio', avatarColor:'avatar_bg', isBreaking:'is_breaking',
  };
  const updates = {};
  for (const [apiField, dbField] of Object.entries(fieldMap)) {
    if (req.body[apiField] !== undefined) {
      updates[dbField] = apiField === 'isBreaking' ? (req.body[apiField]?1:0) : req.body[apiField];
    }
  }
  if (req.body.tags !== undefined) updates.topics = JSON.stringify(req.body.tags);
  if (req.body.name) updates.initials = req.body.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  if (!Object.keys(updates).length) return res.json(formatPersonality(p, req.user?.id));
  const sets = Object.keys(updates).map(k=>`${k}=?`).join(',');
  db.prepare(`UPDATE personalities SET ${sets} WHERE id=?`).run(...Object.values(updates), id);
  res.json(formatPersonality(db.prepare('SELECT * FROM personalities WHERE id=?').get(id), req.user?.id));
});

// DELETE /api/personalities/:id (admin)
router.delete('/personalities/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM personalities WHERE id=?').run(id);
  res.sendStatus(204);
});

// POST /api/personalities/:id/follow — toggle follow
router.post('/personalities/:id/follow', requireAuth, (req, res) => {
  const personalityId = parseInt(req.params.id);
  if (isNaN(personalityId)) return res.status(400).json({ error: 'Invalid id' });
  const userId = req.user.id;
  const existing = db.prepare('SELECT 1 FROM follows WHERE user_id=? AND personality_id=?').get(userId, personalityId);
  if (existing) {
    db.prepare('DELETE FROM follows WHERE user_id=? AND personality_id=?').run(userId, personalityId);
  } else {
    db.prepare('INSERT OR IGNORE INTO follows (user_id, personality_id) VALUES (?,?)').run(userId, personalityId);
  }
  const followersCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE personality_id=?').get(personalityId).c;
  res.json({ followed: !existing, followersCount });
});

module.exports = router;
module.exports.formatPersonality = formatPersonality;
