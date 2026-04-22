const router = require('express').Router();
const { db } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const crypto = require('crypto');

// GET /api/api-keys
router.get('/api-keys', requireAuth, (req, res) => {
  const keys = db.prepare('SELECT * FROM api_keys WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json(keys.map(k => ({
    id: k.id, name: k.name, keyPrefix: k.key_prefix,
    createdAt: k.created_at, lastUsedAt: k.last_used_at || null,
  })));
});

// POST /api/api-keys
router.post('/api-keys', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const rawKey = `mmt_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 12);
  const result = db.prepare(
    'INSERT INTO api_keys (user_id, name, key_hash, key_prefix) VALUES (?,?,?,?)'
  ).run(req.user.id, name, keyHash, keyPrefix);
  const k = db.prepare('SELECT * FROM api_keys WHERE id=?').get(result.lastInsertRowid);
  res.status(201).json({
    id: k.id, name: k.name, key: rawKey, keyPrefix: k.key_prefix, createdAt: k.created_at,
  });
});

// DELETE /api/api-keys/:id
router.delete('/api-keys/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM api_keys WHERE id=? AND user_id=?').run(id, req.user.id);
  res.sendStatus(204);
});

module.exports = router;
