/**
 * services/aiRouter.js
 *
 * Central AI routing layer.
 * ─────────────────────────────────────────────────────────────
 * Task              Provider          Model
 * ─────────────────────────────────────────────────────────────
 * article_analysis  Anthropic         claude-sonnet (best quality)
 * thread_summary    Anthropic         claude-sonnet (best quality)
 * fact_check        OpenRouter        gemini-flash  (cheap + fast)
 * auto_categorise   OpenRouter        mistral-7b    (FREE)
 * auto_verdict      OpenRouter        mistral-7b    (FREE)
 * fallback          OpenRouter        claude-haiku  (if Anthropic down)
 * ─────────────────────────────────────────────────────────────
 *
 * All callers use: aiRouter.call(task, prompt, maxTokens)
 * The router picks the right provider + model automatically.
 */

const { logAI } = require('../database/db');

// ── In-memory cache (shared across providers) ────────────────────
const cache = new Map();
const CACHE_TTL = 3_600_000; // 1 hour

function cacheKey(prompt) {
  return Buffer.from(prompt.slice(0, 300)).toString('base64');
}
function fromCache(key) {
  const hit = cache.get(key);
  return hit && Date.now() - hit.ts < CACHE_TTL ? hit.text : null;
}
function toCache(key, text) {
  cache.set(key, { text, ts: Date.now() });
}

// ── Model routing table ──────────────────────────────────────────
function getRoute(task) {
  const routes = {
    article_analysis: { provider: 'anthropic', model: process.env.AI_MODEL || 'claude-sonnet-4-20250514' },
    thread_summary:   { provider: 'anthropic', model: process.env.AI_MODEL || 'claude-sonnet-4-20250514' },
    fact_check:       { provider: 'openrouter', model: process.env.OR_MODEL_FACTCHECK  || 'google/gemini-flash-1.5' },
    auto_categorise:  { provider: 'openrouter', model: process.env.OR_MODEL_CATEGORISE || 'mistralai/mistral-7b-instruct:free' },
    auto_verdict:     { provider: 'openrouter', model: process.env.OR_MODEL_CATEGORISE || 'mistralai/mistral-7b-instruct:free' },
    proxy:            { provider: 'anthropic', model: process.env.AI_MODEL || 'claude-sonnet-4-20250514' },
  };
  return routes[task] || routes.proxy;
}

// ── Anthropic caller ─────────────────────────────────────────────
async function callAnthropic(prompt, maxTokens, model) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${err.slice(0, 100)}`);
  }
  const data = await resp.json();
  return data?.content?.[0]?.text || '';
}

// ── OpenRouter caller ─────────────────────────────────────────────
async function callOpenRouter(prompt, maxTokens, model) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': 'MakeMyThread'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenRouter ${resp.status}: ${err.slice(0, 100)}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || '';
}

// ── Main router function ─────────────────────────────────────────
async function call(task, prompt, maxTokens = 200, userId = null) {
  const key = cacheKey(prompt);
  const cached = fromCache(key);
  if (cached) {
    logAI(userId, task, prompt.length, maxTokens, 1);
    return { text: cached, cached: true, provider: 'cache' };
  }

  const route = getRoute(task);
  let text = '';
  let provider = route.provider;

  try {
    if (route.provider === 'anthropic') {
      text = await callAnthropic(prompt, maxTokens, route.model);
    } else {
      text = await callOpenRouter(prompt, maxTokens, route.model);
    }
  } catch (primaryErr) {
    console.warn(`[AI] Primary failed (${route.provider}/${route.model}): ${primaryErr.message}`);

    // Fallback: if Anthropic failed → try OpenRouter claude-haiku
    // if OpenRouter failed → try Anthropic
    try {
      const fallbackModel = process.env.OR_MODEL_FALLBACK || 'anthropic/claude-3-haiku';
      if (route.provider === 'anthropic' && process.env.OPENROUTER_API_KEY) {
        console.log(`[AI] Falling back to OpenRouter ${fallbackModel}`);
        text = await callOpenRouter(prompt, maxTokens, fallbackModel);
        provider = 'openrouter-fallback';
      } else if (route.provider === 'openrouter' && process.env.ANTHROPIC_API_KEY) {
        console.log(`[AI] Falling back to Anthropic`);
        text = await callAnthropic(prompt, maxTokens, process.env.AI_MODEL || 'claude-sonnet-4-20250514');
        provider = 'anthropic-fallback';
      } else {
        throw primaryErr;
      }
    } catch (fallbackErr) {
      throw new Error(`All AI providers failed. Primary: ${primaryErr.message}. Fallback: ${fallbackErr.message}`);
    }
  }

  toCache(key, text);
  logAI(userId, task, prompt.length, maxTokens, 0);
  return { text, cached: false, provider, model: route.model };
}

// ── Convenience wrappers ─────────────────────────────────────────

async function categoriseArticle(title, snippet) {
  const prompt = `Categorise this news article into exactly ONE of these categories:
politics, sports, business, technology, health, social, international, general

Title: "${title}"
Snippet: "${snippet?.slice(0, 200) || ''}"

Reply with ONLY the category name, nothing else. No explanation.`;
  const result = await call('auto_categorise', prompt, 20);
  const raw = result.text.trim().toLowerCase().replace(/[^a-z]/g, '');
  const valid = ['politics','sports','business','technology','health','social','international','general'];
  return valid.includes(raw) ? raw : 'general';
}

async function quickVerdict(headline, claim) {
  const prompt = `Is this news claim TRUE, FALSE, or MISLEADING? One word answer only.
Headline: "${headline}"
Claim: "${claim || headline}"
Reply: TRUE, FALSE, or MISLEADING`;
  const result = await call('auto_verdict', prompt, 10);
  const raw = result.text.trim().toUpperCase();
  if (raw.includes('FALSE'))     return 'fake';
  if (raw.includes('MISLEADING')) return 'misleading';
  return 'notsure';
}

async function analyseArticle(headline, snippet, personName) {
  const prompt = `You are a news intelligence analyst for MakeMyThread. Analyse this news in 2-3 sharp sentences:
(1) Why it matters now
(2) One non-obvious connection to recent context  
(3) What to watch next

Headline: "${headline}"
About: ${personName || 'a public figure'}
Details: "${snippet?.slice(0, 400) || ''}"

Be concise and insightful. No bullet points.`;
  return call('article_analysis', prompt, 200);
}

async function summariseThread(threadName, personName, headlines) {
  const prompt = `Summarize this MakeMyThread thread about ${personName || 'this person'} titled "${threadName}".

Articles:
- ${headlines.join('\n- ')}

Provide:
1. A 2-sentence narrative summary
2. Exactly 4 key bullet insights (start each with →)
3. One trend prediction (start with TREND:)

Be sharp, analytical, specific. Max 200 words.`;
  return call('thread_summary', prompt, 400);
}

async function factCheck(headline, claim) {
  const prompt = `Fact-check this claim in 2-3 sentences. Start with VERDICT: TRUE / FALSE / UNVERIFIED then your reasoning.

Headline: "${headline}"
Claim: "${claim || headline}"`;
  return call('fact_check', prompt, 200);
}

module.exports = { call, categoriseArticle, quickVerdict, analyseArticle, summariseThread, factCheck };
