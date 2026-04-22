const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, audit } = require('../database/db');

// ── DASHBOARD STATS ──────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const stats = {
    users:        db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    personalities:db.prepare('SELECT COUNT(*) as c FROM personalities').get().c,
    news:         db.prepare('SELECT COUNT(*) as c FROM news').get().c,
    fake_news:    db.prepare('SELECT COUNT(*) as c FROM fake_news').get().c,
    reactions:    db.prepare('SELECT COUNT(*) as c FROM reactions').get().c,
    threads:      db.prepare('SELECT COUNT(*) as c FROM threads').get().c,
    fake_flags:   db.prepare("SELECT COUNT(*) as c FROM fake_news WHERE verdict='fake'").get().c,
    sources:      db.prepare('SELECT COUNT(*) as c FROM news_sources WHERE is_active=1').get().c,
    news_by_category: db.prepare(
      `SELECT category, COUNT(*) as count FROM news
       WHERE category IS NOT NULL GROUP BY category ORDER BY count DESC LIMIT 10`
    ).all(),
    recent_news: db.prepare(
      `SELECT n.title, p.name as personality, n.created_at
       FROM news n LEFT JOIN personalities p ON p.id=n.personality_id
       ORDER BY n.created_at DESC LIMIT 5`
    ).all(),
  };

  // AI usage (last 7 days)
  const aiStats = db.prepare(
    `SELECT DATE(created_at) as day, COUNT(*) as calls, SUM(tokens_est) as tokens, SUM(cached) as cached_count
     FROM ai_usage WHERE created_at >= datetime('now','-7 days')
     GROUP BY day ORDER BY day`
  ).all();

  stats.ai_usage = aiStats;
  stats.ai_total_calls = db.prepare('SELECT COUNT(*) as c FROM ai_usage WHERE created_at >= datetime(\'now\',\'-7 days\')').get().c;
  stats.ai_cached_calls = db.prepare('SELECT COUNT(*) as c FROM ai_usage WHERE cached=1 AND created_at >= datetime(\'now\',\'-7 days\')').get().c;

  res.json(stats);
});

// ── USERS ────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  const { q, role } = req.query;
  let sql = 'SELECT id,name,email,role,initials,avatar_bg,avatar_fg,created_at FROM users WHERE 1=1';
  const params = [];
  if (q)    { sql += ' AND (name LIKE ? OR email LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (role) { sql += ' AND role = ?'; params.push(role); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.put('/users/:id/role', (req, res) => {
  const { role } = req.body;
  if (!['user','admin','personality'].includes(role))
    return res.status(400).json({ error: 'Invalid role' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET role=? WHERE id=?').run(role, req.params.id);
  audit(req.user.id, 'role_change', 'user', user.id, { from: user.role, to: role });
  res.json({ success: true });
});

router.delete('/users/:id', (req, res) => {
  if (parseInt(req.params.id) === req.user.id)
    return res.status(400).json({ error: 'Cannot delete your own account' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  audit(req.user.id, 'delete', 'user', user.id, { email: user.email });
  res.json({ success: true });
});

// ── PERSONALITIES ─────────────────────────────────────────────────
router.get('/personalities', (req, res) => {
  const rows = db.prepare(
    `SELECT p.*, COUNT(DISTINCT f.user_id) as followers
     FROM personalities p
     LEFT JOIN follows f ON f.personality_id=p.id
     GROUP BY p.id ORDER BY p.created_at DESC`
  ).all();
  res.json(rows);
});

router.post('/personalities', (req, res) => {
  const { name, name_local, slug, category, nationality, bio, bg_info,
          initials, avatar_bg, avatar_fg, verified } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name and slug required' });
  const existing = db.prepare('SELECT id FROM personalities WHERE slug=?').get(slug);
  if (existing) return res.status(409).json({ error: 'Slug already exists' });
  const result = db.prepare(
    `INSERT INTO personalities (name,name_local,slug,category,nationality,bio,bg_info,initials,avatar_bg,avatar_fg,verified)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(name, name_local||null, slug, category||null, nationality||null, bio||null,
        bg_info||null, initials||(name.slice(0,2).toUpperCase()), avatar_bg||'#C9963A',
        avatar_fg||'#fff', verified?1:0);
  const row = db.prepare('SELECT * FROM personalities WHERE id=?').get(result.lastInsertRowid);
  audit(req.user.id, 'create', 'personality', row.id, { name });
  res.json(row);
});

router.put('/personalities/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM personalities WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const fields = ['name','name_local','slug','category','nationality','bio','bg_info',
                  'initials','avatar_bg','avatar_fg','verified'];
  const updates = {};
  fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  if (!Object.keys(updates).length) return res.json(p);
  const sets = Object.keys(updates).map(k=>`${k}=?`).join(',');
  db.prepare(`UPDATE personalities SET ${sets} WHERE id=?`).run(...Object.values(updates), p.id);
  audit(req.user.id, 'update', 'personality', p.id, updates);
  res.json(db.prepare('SELECT * FROM personalities WHERE id=?').get(p.id));
});

router.delete('/personalities/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM personalities WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM personalities WHERE id=?').run(p.id);
  audit(req.user.id, 'delete', 'personality', p.id, { name: p.name });
  res.json({ success: true });
});

// ── NEWS POSTS ────────────────────────────────────────────────────
router.get('/news', (req, res) => {
  const { q, personality_id, category, page=1, limit=30 } = req.query;
  let sql = `SELECT n.*, p.name as personality_name, p.name_local as personality_name_local
             FROM news n LEFT JOIN personalities p ON p.id=n.personality_id WHERE 1=1`;
  const params = [];
  if (q)             { sql+=' AND n.title LIKE ?'; params.push(`%${q}%`); }
  if (personality_id){ sql+=' AND n.personality_id=?'; params.push(personality_id); }
  if (category)      { sql+=' AND n.category=?'; params.push(category); }
  const total = db.prepare(sql.replace('SELECT n.*,'+' p.name as personality_name, p.name_local as personality_name_local','SELECT COUNT(*) as c')).get(...params).c;
  sql += ` ORDER BY n.created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));
  res.json({ total, page: parseInt(page), data: db.prepare(sql).all(...params) });
});

router.post('/news', (req, res) => {
  const { personality_id, title, snippet, source_name, source_url,
          category, credibility, bias, is_breaking, img_color, published_at } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const result = db.prepare(
    `INSERT INTO news (personality_id,title,snippet,source_name,source_url,category,credibility,bias,is_breaking,img_color,published_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(personality_id||null, title, snippet||null, source_name||null, source_url||null,
        category||null, credibility||80, bias||'neutral', is_breaking?1:0,
        img_color||'#DBEAFE', published_at||null);
  const row = db.prepare('SELECT * FROM news WHERE id=?').get(result.lastInsertRowid);
  audit(req.user.id, 'create', 'news', row.id, { title });
  res.json(row);
});

router.put('/news/:id', (req, res) => {
  const n = db.prepare('SELECT * FROM news WHERE id=?').get(req.params.id);
  if (!n) return res.status(404).json({ error: 'Not found' });
  const fields = ['personality_id','title','snippet','source_name','source_url',
                  'category','credibility','bias','is_breaking','img_color','published_at'];
  const updates = {};
  fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  if (!Object.keys(updates).length) return res.json(n);
  const sets = Object.keys(updates).map(k=>`${k}=?`).join(',');
  db.prepare(`UPDATE news SET ${sets} WHERE id=?`).run(...Object.values(updates), n.id);
  audit(req.user.id, 'update', 'news', n.id, updates);
  res.json(db.prepare('SELECT * FROM news WHERE id=?').get(n.id));
});

router.delete('/news/:id', (req, res) => {
  const n = db.prepare('SELECT * FROM news WHERE id=?').get(req.params.id);
  if (!n) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM news WHERE id=?').run(n.id);
  audit(req.user.id, 'delete', 'news', n.id, { title: n.title });
  res.json({ success: true });
});

// Bulk delete
router.post('/news/bulk-delete', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
  const placeholders = ids.map(()=>'?').join(',');
  db.prepare(`DELETE FROM news WHERE id IN (${placeholders})`).run(...ids);
  audit(req.user.id, 'bulk_delete', 'news', null, { ids, count: ids.length });
  res.json({ success: true, deleted: ids.length });
});

// ── FAKE NEWS ─────────────────────────────────────────────────────
router.get('/fake-news', (req, res) => {
  const rows = db.prepare(
    `SELECT f.*, p.name as personality_name, p.name_local as personality_name_local
     FROM fake_news f LEFT JOIN personalities p ON p.id=f.personality_id
     ORDER BY f.created_at DESC`
  ).all();
  res.json(rows);
});

router.post('/fake-news', (req, res) => {
  const { personality_id, headline, claim, verdict, debunk, sources, severity } = req.body;
  if (!headline) return res.status(400).json({ error: 'headline required' });
  const result = db.prepare(
    `INSERT INTO fake_news (personality_id,headline,claim,verdict,debunk,sources,severity)
     VALUES (?,?,?,?,?,?,?)`
  ).run(personality_id||null, headline, claim||null, verdict||'fake', debunk||null,
        JSON.stringify(sources||[]), severity||'medium');
  const row = db.prepare('SELECT * FROM fake_news WHERE id=?').get(result.lastInsertRowid);
  audit(req.user.id, 'create', 'fake_news', row.id, { headline });
  res.json(row);
});

router.put('/fake-news/:id', (req, res) => {
  const fn = db.prepare('SELECT * FROM fake_news WHERE id=?').get(req.params.id);
  if (!fn) return res.status(404).json({ error: 'Not found' });
  const fields = ['personality_id','headline','claim','verdict','debunk','severity'];
  const updates = {};
  fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  if (req.body.sources !== undefined) updates.sources = JSON.stringify(req.body.sources);
  if (!Object.keys(updates).length) return res.json(fn);
  const sets = Object.keys(updates).map(k=>`${k}=?`).join(',');
  db.prepare(`UPDATE fake_news SET ${sets} WHERE id=?`).run(...Object.values(updates), fn.id);
  audit(req.user.id, 'update', 'fake_news', fn.id, updates);
  res.json(db.prepare('SELECT * FROM fake_news WHERE id=?').get(fn.id));
});

router.delete('/fake-news/:id', (req, res) => {
  const fn = db.prepare('SELECT * FROM fake_news WHERE id=?').get(req.params.id);
  if (!fn) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM fake_news WHERE id=?').run(fn.id);
  audit(req.user.id, 'delete', 'fake_news', fn.id, { headline: fn.headline });
  res.json({ success: true });
});

// ── NEWS SOURCES ──────────────────────────────────────────────────
router.get('/sources', (req, res) => {
  const rows = db.prepare(
    `SELECT s.*, p.name as personality_name FROM news_sources s
     LEFT JOIN personalities p ON p.id=s.personality_id
     ORDER BY s.created_at DESC`
  ).all();
  res.json(rows);
});

router.post('/sources', (req, res) => {
  const { personality_id, label, url, type, fetch_interval } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  const result = db.prepare(
    `INSERT INTO news_sources (personality_id,label,url,type,fetch_interval)
     VALUES (?,?,?,?,?)`
  ).run(personality_id||null, label||null, url, type||'rss', fetch_interval||60);
  const row = db.prepare('SELECT * FROM news_sources WHERE id=?').get(result.lastInsertRowid);
  audit(req.user.id, 'create', 'source', row.id, { url });
  res.json(row);
});

router.put('/sources/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM news_sources WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const fields = ['personality_id','label','url','type','fetch_interval','is_active'];
  const updates = {};
  fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  if (!Object.keys(updates).length) return res.json(s);
  const sets = Object.keys(updates).map(k=>`${k}=?`).join(',');
  db.prepare(`UPDATE news_sources SET ${sets} WHERE id=?`).run(...Object.values(updates), s.id);
  audit(req.user.id, 'update', 'source', s.id, updates);
  res.json(db.prepare('SELECT * FROM news_sources WHERE id=?').get(s.id));
});

router.delete('/sources/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM news_sources WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM news_sources WHERE id=?').run(s.id);
  audit(req.user.id, 'delete', 'source', s.id, { url: s.url });
  res.json({ success: true });
});

// Manual fetch trigger
router.post('/sources/:id/fetch', async (req, res) => {
  const s = db.prepare('SELECT * FROM news_sources WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  try {
    const { fetchSource } = require('../services/newsIngestion');
    const count = await fetchSource(s);
    audit(req.user.id, 'fetch', 'source', s.id, { url: s.url, articles_added: count });
    res.json({ success: true, articles_added: count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CATEGORIES ────────────────────────────────────────────────────
router.get('/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY name').all());
});

router.post('/categories', (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const exists = db.prepare('SELECT id FROM categories WHERE name=?').get(name.toLowerCase());
  if (exists) return res.status(409).json({ error: 'Category already exists' });
  const result = db.prepare('INSERT INTO categories (name,color) VALUES (?,?)').run(name.toLowerCase(), color||'#C9963A');
  const row = db.prepare('SELECT * FROM categories WHERE id=?').get(result.lastInsertRowid);
  audit(req.user.id, 'create', 'category', row.id, { name });
  res.json(row);
});

router.put('/categories/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const { name, color } = req.body;
  const updates = {};
  if (name) updates.name = name.toLowerCase();
  if (color) updates.color = color;
  if (!Object.keys(updates).length) return res.json(c);
  const sets = Object.keys(updates).map(k=>`${k}=?`).join(',');
  db.prepare(`UPDATE categories SET ${sets} WHERE id=?`).run(...Object.values(updates), c.id);
  res.json(db.prepare('SELECT * FROM categories WHERE id=?').get(c.id));
});

router.delete('/categories/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM categories WHERE id=?').run(c.id);
  audit(req.user.id, 'delete', 'category', c.id, { name: c.name });
  res.json({ success: true });
});

// ── REACTION CONTROLS ─────────────────────────────────────────────
router.get('/reaction-controls', (req, res) => {
  const global = db.prepare("SELECT * FROM reaction_controls WHERE scope='global'").get();
  const byPersonality = db.prepare(
    `SELECT rc.*, p.name as target_name FROM reaction_controls rc
     LEFT JOIN personalities p ON p.id=rc.target_id
     WHERE rc.scope='personality'`
  ).all();
  const byUser = db.prepare(
    `SELECT rc.*, u.name as target_name, u.email as target_email FROM reaction_controls rc
     LEFT JOIN users u ON u.id=rc.target_id
     WHERE rc.scope='user'`
  ).all();
  res.json({ global, byPersonality, byUser });
});

router.put('/reaction-controls/global', (req, res) => {
  const { enabled } = req.body;
  db.prepare("UPDATE reaction_controls SET enabled=?, updated_at=CURRENT_TIMESTAMP WHERE scope='global'")
    .run(enabled?1:0);
  audit(req.user.id, 'toggle', 'reaction_control', 1, { scope:'global', enabled });
  res.json({ success: true });
});

router.post('/reaction-controls/personality', (req, res) => {
  const { personality_id, enabled, blocked_types } = req.body;
  const existing = db.prepare("SELECT * FROM reaction_controls WHERE scope='personality' AND target_id=?").get(personality_id);
  if (existing) {
    db.prepare("UPDATE reaction_controls SET enabled=?,blocked_types=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(enabled?1:0, JSON.stringify(blocked_types||[]), existing.id);
  } else {
    db.prepare("INSERT INTO reaction_controls (scope,target_id,enabled,blocked_types) VALUES ('personality',?,?,?)")
      .run(personality_id, enabled?1:0, JSON.stringify(blocked_types||[]));
  }
  audit(req.user.id, 'update', 'reaction_control', personality_id, { scope:'personality', personality_id, enabled });
  res.json({ success: true });
});

router.post('/reaction-controls/user/block', (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const existing = db.prepare("SELECT * FROM reaction_controls WHERE scope='user' AND target_id=?").get(user_id);
  if (!existing) {
    db.prepare("INSERT INTO reaction_controls (scope,target_id,enabled) VALUES ('user',?,0)").run(user_id);
  } else {
    db.prepare("UPDATE reaction_controls SET enabled=0, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(existing.id);
  }
  const u = db.prepare('SELECT name,email FROM users WHERE id=?').get(user_id);
  audit(req.user.id, 'block', 'reaction_control', user_id, { email: u?.email });
  res.json({ success: true });
});

router.post('/reaction-controls/user/unblock', (req, res) => {
  const { user_id } = req.body;
  db.prepare("DELETE FROM reaction_controls WHERE scope='user' AND target_id=?").run(user_id);
  audit(req.user.id, 'unblock', 'reaction_control', user_id, {});
  res.json({ success: true });
});

// ── AUDIT LOG ─────────────────────────────────────────────────────
router.get('/audit-log', (req, res) => {
  const { page=1, limit=50, entity_type, action } = req.query;
  let sql = `SELECT al.*, u.name as admin_name, u.email as admin_email
             FROM audit_log al LEFT JOIN users u ON u.id=al.admin_id WHERE 1=1`;
  const params = [];
  if (entity_type) { sql+=' AND al.entity_type=?'; params.push(entity_type); }
  if (action)      { sql+=' AND al.action=?'; params.push(action); }
  const total = db.prepare(sql.replace('SELECT al.*, u.name as admin_name, u.email as admin_email','SELECT COUNT(*) as c')).get(...params).c;
  sql += ` ORDER BY al.created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));
  res.json({ total, page: parseInt(page), data: db.prepare(sql).all(...params) });
});

// ── AI USAGE ──────────────────────────────────────────────────────
router.get('/ai-usage', (req, res) => {
  const { days=7 } = req.query;
  const summary = db.prepare(
    `SELECT DATE(created_at) as day, COUNT(*) as calls, SUM(tokens_est) as tokens, SUM(cached) as cached
     FROM ai_usage WHERE created_at >= datetime('now','-${parseInt(days)} days')
     GROUP BY day ORDER BY day`
  ).all();
  const top_users = db.prepare(
    `SELECT au.user_id, u.name, u.email, COUNT(*) as calls
     FROM ai_usage au LEFT JOIN users u ON u.id=au.user_id
     WHERE au.created_at >= datetime('now','-${parseInt(days)} days')
     GROUP BY au.user_id ORDER BY calls DESC LIMIT 10`
  ).all();
  const by_endpoint = db.prepare(
    `SELECT endpoint, COUNT(*) as calls FROM ai_usage
     WHERE created_at >= datetime('now','-${parseInt(days)} days')
     GROUP BY endpoint ORDER BY calls DESC`
  ).all();
  res.json({ summary, top_users, by_endpoint });
});

// ── REACTION SETTINGS (Expert-Panel style) ────────────────────────
router.get('/reaction-settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM reaction_settings ORDER BY id').all();
  res.json(rows.map(r => ({ id: r.id, type: r.type, label: r.label, enabled: !!r.enabled, icon: r.icon })));
});

router.patch('/reaction-settings', (req, res) => {
  const { settings } = req.body;
  if (!Array.isArray(settings)) return res.status(400).json({ error: 'settings array required' });
  const update = db.prepare('UPDATE reaction_settings SET enabled=? WHERE type=?');
  const tx = db.transaction(() => { for (const s of settings) update.run(s.enabled ? 1 : 0, s.type); });
  tx();
  const rows = db.prepare('SELECT * FROM reaction_settings ORDER BY id').all();
  res.json(rows.map(r => ({ id: r.id, type: r.type, label: r.label, enabled: !!r.enabled, icon: r.icon })));
});

// ── MASTER TOGGLE ─────────────────────────────────────────────────
router.get('/master-toggle', (req, res) => {
  const row = db.prepare("SELECT value FROM system_settings WHERE key='reactions_enabled'").get();
  res.json({ enabled: row ? row.value !== '0' : true });
});

router.patch('/master-toggle', (req, res) => {
  const { enabled } = req.body;
  const val = enabled ? '1' : '0';
  const exists = db.prepare("SELECT id FROM system_settings WHERE key='reactions_enabled'").get();
  if (exists) {
    db.prepare("UPDATE system_settings SET value=? WHERE key='reactions_enabled'").run(val);
  } else {
    db.prepare("INSERT INTO system_settings (key, value) VALUES ('reactions_enabled', ?)").run(val);
  }
  res.json({ enabled: !!enabled });
});

// ── PERSONALITY REACTION OVERRIDES ────────────────────────────────
router.get('/personality-reaction-overrides/:personalityId', (req, res) => {
  const pid = parseInt(req.params.personalityId);
  const overrides = db.prepare('SELECT * FROM personality_reaction_overrides WHERE personality_id=?').all(pid);
  res.json(overrides.map(o => ({ id: o.id, personalityId: o.personality_id, type: o.type, enabled: !!o.enabled })));
});

router.patch('/personality-reaction-overrides/:personalityId', (req, res) => {
  const pid = parseInt(req.params.personalityId);
  const { overrides } = req.body;
  if (!Array.isArray(overrides)) return res.status(400).json({ error: 'overrides array required' });
  const upsert = db.prepare(
    `INSERT INTO personality_reaction_overrides (personality_id, type, enabled) VALUES (?,?,?)
     ON CONFLICT(personality_id, type) DO UPDATE SET enabled=excluded.enabled`
  );
  const tx = db.transaction(() => { for (const o of overrides) upsert.run(pid, o.type, o.enabled ? 1 : 0); });
  tx();
  const rows = db.prepare('SELECT * FROM personality_reaction_overrides WHERE personality_id=?').all(pid);
  res.json(rows.map(o => ({ id: o.id, personalityId: o.personality_id, type: o.type, enabled: !!o.enabled })));
});

// ── USER BLOCKS ───────────────────────────────────────────────────
router.get('/user-blocks', (req, res) => {
  const rows = db.prepare(
    `SELECT ub.*, u.name, u.email FROM user_blocks ub
     JOIN users u ON u.id=ub.user_id ORDER BY ub.blocked_at DESC`
  ).all();
  res.json(rows.map(b => ({
    id: b.id, userId: b.user_id, name: b.name, email: b.email,
    blocked: !!b.blocked, reason: b.reason, blockedAt: b.blocked_at,
  })));
});

router.post('/user-blocks', (req, res) => {
  const { userId, reason } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const u = db.prepare('SELECT id FROM users WHERE id=?').get(userId);
  if (!u) return res.status(404).json({ error: 'User not found' });
  db.prepare(
    `INSERT INTO user_blocks (user_id, blocked, reason) VALUES (?,1,?)
     ON CONFLICT(user_id) DO UPDATE SET blocked=1, reason=excluded.reason, blocked_at=CURRENT_TIMESTAMP`
  ).run(userId, reason || 'Admin blocked');
  res.json({ success: true });
});

router.delete('/user-blocks/:userId', (req, res) => {
  db.prepare('DELETE FROM user_blocks WHERE user_id=?').run(parseInt(req.params.userId));
  res.sendStatus(204);
});

// ── USER SEARCH ───────────────────────────────────────────────────
router.get('/user-search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  const rows = db.prepare(
    'SELECT id, name, email, role FROM users WHERE name LIKE ? OR email LIKE ? LIMIT 20'
  ).all(`%${q}%`, `%${q}%`);
  res.json(rows);
});

// ── USER ROLE ─────────────────────────────────────────────────────
router.patch('/users/:id/role', (req, res) => {
  const { role } = req.body;
  if (!['user','admin','personality'].includes(role))
    return res.status(400).json({ error: 'Invalid role' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET role=? WHERE id=?').run(role, req.params.id);
  audit(req.user.id, 'role_change', 'user', user.id, { from: user.role, to: role });
  res.json({ success: true });
});

module.exports = router;
