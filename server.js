require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const compression = require('compression');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Compression (gzip/brotli — must be first) ─────────────────────
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// ── Security ─────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === 'production';

app.use(helmet({
  contentSecurityPolicy: isProd ? {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'"],   // SPA uses inline scripts
      styleSrc:       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:        ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:         ["'self'", 'data:', 'https:'],
      connectSrc:     ["'self'"],
      frameSrc:       ["'none'"],
      objectSrc:      ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null,
    }
  } : false,
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || (isProd ? false : '*'),
  credentials: true
}));

// Stricter rate limit on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { error: 'Too many attempts — try again in 15 minutes' },
  standardHeaders: true, legacyHeaders: false
});
app.use('/api/auth/login',           authLimiter);
app.use('/api/auth/register',        authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false }));

// ── Body parsing ──────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Request logger ────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const start = Date.now();
    res.on('finish', () => {
      const ms  = Date.now() - start;
      const col = res.statusCode >= 500 ? '\x1b[31m'
                : res.statusCode >= 400 ? '\x1b[33m' : '\x1b[32m';
      console.log(`${col}${res.statusCode}\x1b[0m ${req.method} ${req.path} ${ms}ms`);
    });
  }
  next();
});

// ── Static files ──────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────────────────
const { requireAdmin } = require('./middleware/auth');

app.use('/api/auth',    require('./routes/auth'));
app.use('/api/admin',  requireAdmin, require('./routes/admin'));
app.use('/api/news',   require('./routes/news'));
app.use('/api/ai',     require('./routes/aiProxy'));
app.use('/api/scraper',require('./routes/scraper'));

const { sseRouter } = require('./routes/sse');
app.use('/api/sse', sseRouter);

// ── Expert-Panel-style routes ──────────────────────────────────────
app.use('/api', require('./routes/personalities'));
app.use('/api', require('./routes/newsV2'));
app.use('/api', require('./routes/threads'));
app.use('/api', require('./routes/users'));
app.use('/api', require('./routes/notifications'));
app.use('/api', require('./routes/apiKeys'));
app.use('/api', require('./routes/dashboard'));
app.use('/api', require('./routes/health'));

// ── Public files ──────────────────────────────────────────────────
app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'MakeMyThread', short_name: 'MakeMyThread',
    description: 'People-centric news intelligence',
    start_url: '/', display: 'standalone',
    background_color: '#FFF8E7', theme_color: '#C9963A',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  });
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    'User-agent: *\nAllow: /\nAllow: /p/\nAllow: /fakeradar\nDisallow: /api/\nDisallow: /admin'
  );
});

// ── SSR Routes (SEO-optimised, server-rendered HTML) ─────────────
const ssr = require('./services/ssr');

app.get('/', (req, res) => {
  try { res.send(ssr.renderHome()); }
  catch (e) { res.sendFile(path.join(__dirname, 'public', 'index.html')); }
});

app.get('/discover', (req, res) => {
  try { res.send(ssr.renderDiscover()); }
  catch (e) { res.sendFile(path.join(__dirname, 'public', 'index.html')); }
});

app.get('/fakeradar', (req, res) => {
  try { res.send(ssr.renderFakeRadar()); }
  catch (e) { res.sendFile(path.join(__dirname, 'public', 'index.html')); }
});

app.get('/p/:slug', (req, res) => {
  try {
    const html = ssr.renderPersonality(req.params.slug);
    if (!html) return res.status(404).send(ssr.renderHome());
    res.send(html);
  } catch (e) { res.sendFile(path.join(__dirname, 'public', 'index.html')); }
});

app.get('/news/:id', (req, res) => {
  try {
    const html = ssr.renderArticle(parseInt(req.params.id));
    if (!html) return res.status(404).send(ssr.renderHome());
    res.send(html);
  } catch (e) { res.sendFile(path.join(__dirname, 'public', 'index.html')); }
});

// Password reset — serve SPA so the JS can read ?token= and show the reset form
app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── SPA catch-all for /admin ──────────────────────────────────────
app.get('/admin*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🧵  MakeMyThread`);
  console.log(`    App:   http://localhost:${PORT}`);
  console.log(`    Admin: http://localhost:${PORT}/admin`);
  console.log(`    Env:   ${process.env.NODE_ENV || 'development'}\n`);
});

// ── Start news ingestion cron ─────────────────────────────────────
require('./services/newsIngestion').startCron();

// ── Daily DB backup at 2:00 AM ────────────────────────────────────
const cron = require('node-cron');
cron.schedule('0 2 * * *', () => {
  require('child_process').fork('./scripts/backup.js', { silent: false });
});
console.log('[Backup] Daily backup scheduled at 2:00 AM');
