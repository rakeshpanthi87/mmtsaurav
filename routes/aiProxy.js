const router = require('express').Router();
const { optionalAuth } = require('../middleware/auth');
const ai = require('../services/aiRouter');

const userUsage = new Map();
function checkRateLimit(userId) {
  const key = `${userId}_${Math.floor(Date.now() / 3_600_000)}`;
  const limit = parseInt(process.env.AI_RATE_LIMIT || '10');
  const count = userUsage.get(key) || 0;
  if (count >= limit) return false;
  userUsage.set(key, count + 1);
  return true;
}

router.post('/proxy', optionalAuth, async (req, res) => {
  const userId = req.user?.id || req.ip;
  if (!checkRateLimit(userId)) return res.status(429).json({ error: 'AI rate limit reached. Try again in an hour.' });
  const { messages, max_tokens = 200, task = 'proxy' } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });
  try {
    const prompt = messages.map(m => m.content).join('\n');
    const result = await ai.call(task, prompt, max_tokens, req.user?.id);
    res.json({ content: [{ type: 'text', text: result.text }], cached: result.cached, provider: result.provider, model: result.model });
  } catch (err) {
    res.status(500).json({ error: 'AI service unavailable', message: err.message });
  }
});

router.post('/analyze-article', optionalAuth, async (req, res) => {
  const { headline, snippet, person_name } = req.body;
  if (!headline) return res.status(400).json({ error: 'headline required' });
  try {
    const result = await ai.analyseArticle(headline, snippet, person_name);
    res.json({ analysis: result.text, cached: result.cached, provider: result.provider });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/summarize-thread', optionalAuth, async (req, res) => {
  const { person_name, thread_name, headlines } = req.body;
  if (!headlines?.length) return res.status(400).json({ error: 'No articles' });
  try {
    const result = await ai.summariseThread(thread_name, person_name, headlines);
    res.json({ summary: result.text, cached: result.cached, provider: result.provider });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/fact-check', optionalAuth, async (req, res) => {
  const { headline, claim } = req.body;
  try {
    const result = await ai.factCheck(headline, claim);
    res.json({ verdict: result.text, cached: result.cached, provider: result.provider });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/status', (req, res) => {
  res.json({
    anthropic:  !!process.env.ANTHROPIC_API_KEY,
    openrouter: !!process.env.OPENROUTER_API_KEY,
    gnews:      !!process.env.GNEWS_API_KEY,
    pinews:     !!process.env.PINEWS_API_KEY,
    models: {
      article_analysis: process.env.AI_MODEL            || 'claude-sonnet-4-20250514',
      thread_summary:   process.env.AI_MODEL            || 'claude-sonnet-4-20250514',
      fact_check:       process.env.OR_MODEL_FACTCHECK  || 'google/gemini-flash-1.5',
      auto_categorise:  process.env.OR_MODEL_CATEGORISE || 'mistralai/mistral-7b-instruct:free',
      fallback:         process.env.OR_MODEL_FALLBACK   || 'anthropic/claude-3-haiku',
    }
  });
});

module.exports = router;
