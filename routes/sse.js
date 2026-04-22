const router = require('express').Router();

const sseClients = new Map();

router.get('/feed', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('data: connected\n\n');

  const clientId = req.query.userId || req.ip;
  sseClients.set(clientId, res);

  const hb = setInterval(() => res.write(': heartbeat\n\n'), 30000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(clientId); });
});

function notifyFollowers(followerUserIds, personName, articleTitle) {
  const payload = JSON.stringify({ type: 'new_articles', person: personName, title: articleTitle });
  followerUserIds.forEach(uid => {
    const client = sseClients.get(String(uid));
    if (client) {
      try { client.write(`data: ${payload}\n\n`); }
      catch { sseClients.delete(String(uid)); }
    }
  });
}

function broadcastStats() {
  const payload = JSON.stringify({ type: 'stats_update' });
  sseClients.forEach((client) => {
    try { client.write(`data: ${payload}\n\n`); } catch {}
  });
}

module.exports = { sseRouter: router, notifyFollowers, broadcastStats };
