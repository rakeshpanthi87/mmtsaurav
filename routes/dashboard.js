const router = require('express').Router();
const { db } = require('../database/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');

// GET /api/dashboard/feed-summary
router.get('/dashboard/feed-summary', requireAuth, (req, res) => {
  const userId = req.user.id;
  const follows = db.prepare('SELECT personality_id FROM follows WHERE user_id=?').all(userId);
  const totalFollowed = follows.length;
  let unreadNewsCount = 0, categoryBreakdown = [], topPersonalities = [];

  if (follows.length) {
    const ids = follows.map(f => f.personality_id);
    const ph = ids.map(()=>'?').join(',');
    unreadNewsCount = db.prepare(`SELECT COUNT(*) as c FROM news WHERE personality_id IN (${ph})`).get(...ids).c;
    categoryBreakdown = db.prepare(
      `SELECT category, COUNT(*) as count FROM news WHERE personality_id IN (${ph}) GROUP BY category`
    ).all(...ids);
    topPersonalities = db.prepare(
      `SELECT * FROM personalities WHERE id IN (${ph}) LIMIT 5`
    ).all(...ids).map(p => ({
      id: p.id, name: p.name, category: p.category || '', nationality: p.nationality || '',
      avatarInitials: p.initials || p.name.slice(0,2).toUpperCase(),
      avatarColor: p.avatar_bg || '#C9963A', isFollowed: true,
    }));
  }

  res.json({ totalFollowed, unreadNewsCount, categoryBreakdown, topPersonalities });
});

// GET /api/dashboard/trending
router.get('/dashboard/trending', optionalAuth, (req, res) => {
  const trendingNews = db.prepare(`
    SELECT n.*, (SELECT COUNT(*) FROM reactions r WHERE r.news_id=n.id) as reaction_count
    FROM news n ORDER BY reaction_count DESC, n.created_at DESC LIMIT 5
  `).all();

  const trendingPersonalities = db.prepare(
    'SELECT * FROM personalities ORDER BY created_at DESC LIMIT 5'
  ).all();

  const fakeNewsAlerts = db.prepare('SELECT COUNT(*) as c FROM news_ratings WHERE rating<=2').get().c;
  const totalCommunityRatings = db.prepare('SELECT COUNT(*) as c FROM news_ratings').get().c;

  res.json({
    trendingNews: trendingNews.map(n => ({
      id: n.id, headline: n.title, snippet: n.snippet || '', source: n.source_name || '',
      category: n.category || 'general', personalityId: n.personality_id,
      bannerColor: n.img_color || '#C9963A', isBreaking: !!n.is_breaking, personality: null, tags: [],
      factRatings: 0, notsureRatings: 0, fakeRatings: 0,
      userRating: null, likeCount: 0, shareCount: 0, saveCount: 0, commentCount: 0,
      userReactions: { liked: false, saved: false, shared: false },
      publishedAt: n.published_at || n.created_at, createdAt: n.created_at,
    })),
    trendingPersonalities: trendingPersonalities.map(p => ({
      id: p.id, name: p.name, category: p.category || '', nationality: p.nationality || '',
      gender: p.gender || 'other', age: p.age || null, bio: p.bio || '',
      avatarInitials: p.initials || p.name.slice(0,2).toUpperCase(),
      avatarColor: p.avatar_bg || '#C9963A', isBreaking: !!p.is_breaking,
      followersCount: 0, newsCount: 0, isFollowed: false, tags: [], createdAt: p.created_at,
    })),
    fakeNewsAlerts, totalCommunityRatings,
  });
});

module.exports = router;
