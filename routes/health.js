const router = require('express').Router();
const { db } = require('../database/db');

router.get('/health', (_req, res) => {
  let dbOk = false;
  try { db.prepare('SELECT 1').get(); dbOk = true; } catch (_) {}
  res.json({ status: dbOk ? 'ok' : 'degraded', timestamp: new Date().toISOString() });
});

module.exports = router;
