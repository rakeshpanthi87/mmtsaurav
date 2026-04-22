const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { db }  = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'mmt_dev_secret_change_in_production';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

function makeToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function safeUser(u) {
  const { password, ...rest } = u;
  return {
    ...rest,
    avatarInitials: rest.initials || (rest.name ? rest.name.slice(0,2).toUpperCase() : 'U'),
    avatarColor: rest.avatar_bg || '#C9963A',
  };
}

// POST /api/auth/signup
router.post('/signup', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email, password required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const hash = bcrypt.hashSync(password, 10);
  const initials = name.slice(0, 2).toUpperCase();
  const colors = ['#1A1208','#2B5EA7','#4A6741','#B54A2E','#C9963A','#9D174D'];
  const avatar_bg = colors[Math.floor(Math.random() * colors.length)];

  const result = db.prepare(
    `INSERT INTO users (name, email, password, role, initials, avatar_bg)
     VALUES (?, ?, ?, 'user', ?, ?)`
  ).run(name, email, hash, initials, avatar_bg);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.json({ token: makeToken(user), user: safeUser(user) });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password || ''))
    return res.status(401).json({ error: 'Invalid email or password' });

  res.json({ token: makeToken(user), user: safeUser(user) });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: safeUser(req.user) });
});

// PATCH /api/auth/me — update own profile
router.patch('/me', requireAuth, (req, res) => {
  const { name, password } = req.body;
  const updates = {};
  if (name) { updates.name = name; updates.initials = name.slice(0, 2).toUpperCase(); }
  if (password) { updates.password = bcrypt.hashSync(password, 10); }
  if (!Object.keys(updates).length) return res.json({ user: safeUser(req.user) });

  const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...Object.values(updates), req.user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: safeUser(updated) });
});

// POST /api/auth/register — Expert-Panel compatibility alias for /signup
router.post('/register', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email, password required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'Email already in use' });

  const hash = bcrypt.hashSync(password, 10);
  const initials = name.slice(0, 2).toUpperCase();
  const colors = ['#1A1208','#2B5EA7','#4A6741','#B54A2E','#C9963A','#9D174D'];
  const avatar_bg = colors[Math.floor(Math.random() * colors.length)];
  const allowedRole = ['admin','user','personality'].includes(role) ? role : 'user';

  const result = db.prepare(
    `INSERT INTO users (name, email, password, role, initials, avatar_bg)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(name, email, hash, allowedRole, initials, avatar_bg);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ token: makeToken(user), user: safeUser(user) });
});

// POST /api/auth/forgot-password
// Generates a reset token (valid 1 hour). In production wire up email delivery.
// The token is returned in the response only in non-production so admins can test.
router.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  // Always respond 200 so attackers can't enumerate valid emails
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) return res.json({ message: 'If that email exists, a reset link has been sent.' });

  // Invalidate any existing tokens for this user
  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);

  // Generate a cryptographically secure token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  db.prepare(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
  ).run(user.id, tokenHash, expiresAt);

  const resetUrl = `${process.env.APP_URL || 'http://localhost:3000'}/reset-password?token=${rawToken}`;
  console.log(`[Auth] Password reset requested for ${email} — URL: ${resetUrl}`);

  // TODO: replace with email delivery (nodemailer / SendGrid / Resend)
  const response = { message: 'If that email exists, a reset link has been sent.' };
  if (process.env.NODE_ENV !== 'production') response.debug_reset_url = resetUrl;
  res.json(response);
});

// POST /api/auth/reset-password
router.post('/reset-password', (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'token and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare(
    `SELECT * FROM password_reset_tokens
     WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')`
  ).get(tokenHash);

  if (!row) return res.status(400).json({ error: 'Reset link is invalid or has expired' });

  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, row.user_id);
  db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').run(row.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  res.json({ message: 'Password reset successfully', token: makeToken(user), user: safeUser(user) });
});

// GET /api/auth/reset-password/validate/:token — check token validity before showing form
router.get('/reset-password/validate/:token', (req, res) => {
  const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const row = db.prepare(
    `SELECT id FROM password_reset_tokens
     WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')`
  ).get(tokenHash);
  res.json({ valid: !!row });
});

module.exports = router;
