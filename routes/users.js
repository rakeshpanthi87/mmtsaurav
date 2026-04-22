const router = require('express').Router();
const { db } = require('../database/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

function formatUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role,
    avatarInitials: u.initials || (u.name ? u.name.slice(0,2).toUpperCase() : 'U'),
    avatarColor: u.avatar_bg || '#C9963A',
    bio: u.bio || null, createdAt: u.created_at,
  };
}

// GET /api/users (admin)
router.get('/users', requireAdmin, (req, res) => {
  const { role, search, page=1, limit=20 } = req.query;
  const pageNum = parseInt(page), limitNum = parseInt(limit);
  let sql = 'SELECT * FROM users WHERE 1=1';
  const params = [];
  if (role) { sql += ' AND role=?'; params.push(role); }
  if (search) { sql += ' AND (name LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  const total = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as c')).get(...params).c;
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limitNum, (pageNum-1)*limitNum);
  const users = db.prepare(sql).all(...params);
  res.json({ users: users.map(formatUser), total });
});

// GET /api/users/:id
router.get('/users/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json(formatUser(u));
});

// PATCH /api/users/:id
router.patch('/users/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const current = req.user;
  if (current.role !== 'admin' && current.id !== id)
    return res.status(403).json({ error: 'Forbidden' });
  const { name, bio, password } = req.body;
  const updates = {};
  if (name) { updates.name = name; updates.initials = name.slice(0,2).toUpperCase(); }
  if (bio !== undefined) updates.bio = bio;
  if (password) updates.password = bcrypt.hashSync(password, 10);
  if (!Object.keys(updates).length) {
    return res.json(formatUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)));
  }
  const sets = Object.keys(updates).map(k=>`${k}=?`).join(',');
  db.prepare(`UPDATE users SET ${sets} WHERE id=?`).run(...Object.values(updates), id);
  res.json(formatUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)));
});

// DELETE /api/users/:id (admin)
router.delete('/users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.sendStatus(204);
});

module.exports = router;
