const router = require('express').Router();
const { db } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

// GET /api/notifications
router.get('/notifications', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50'
  ).all(req.user.id);
  res.json(rows.map(n => ({
    id: n.id, type: n.type, message: n.message, read: !!n.read, createdAt: n.created_at,
  })));
});

// POST /api/notifications/read — mark all as read
router.post('/notifications/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id);
  res.json({ success: true, message: 'All marked read' });
});

module.exports = router;
