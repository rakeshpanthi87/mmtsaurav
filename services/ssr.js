/**
 * services/ssr.js
 *
 * Server-side renders fully populated HTML for SEO-critical pages.
 * At startup, splits public/index.html into three parts:
 *   - CSS      → injected into every <head>
 *   - bodyHTML → the app markup (nav, cards, overlays, etc.)
 *   - appJS    → the full app script
 *
 * Each SSR page overrides <head> meta (title, OG, canonical, JSON-LD)
 * and injects window.__SSR__ / window.__INITIAL_SCREEN__ before the
 * app script runs, so the SPA hydrates without a second API round-trip.
 */

const fs   = require('fs');
const path = require('path');
const { db } = require('../database/db');

const APP_URL   = () => process.env.APP_URL || 'http://localhost:3000';
const SITE_NAME = 'MakeMyThread';
const SITE_DESC = 'People-centric news intelligence for Nepal and the world. Follow personalities, track fake news, read AI-powered analysis.';

// ── Parse index.html once at startup ─────────────────────────────
function loadSPAParts() {
  const html = fs.readFileSync(
    path.join(__dirname, '../public/index.html'), 'utf8'
  );

  // Extract the single <style> block
  const cssMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  const css = cssMatch ? `<style>${cssMatch[1]}</style>` : '';

  // Extract body HTML — everything between <body> and the opening <script>
  const bodyMatch = html.match(/<body>([\s\S]*?)<script>/);
  const bodyHTML = bodyMatch ? bodyMatch[1].trim() : '';

  // Extract the app script content — the last (and only) <script>...</script>
  const scriptMatch = html.match(/<script>([\s\S]+)<\/script>\s*<\/body>/);
  const appJS = scriptMatch ? scriptMatch[1] : '';

  return { css, bodyHTML, appJS };
}

let _spa = null;
function spa() {
  if (!_spa) _spa = loadSPAParts();
  return _spa;
}

// ── HTML escape ───────────────────────────────────────────────────
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Shared shell ──────────────────────────────────────────────────
function htmlShell({
  title,
  description,
  canonical,
  ogImage,
  ogType = 'website',
  jsonLD,
  screenName = 'discover',
  preloadData = {},
}) {
  const { css, bodyHTML, appJS } = spa();
  const ogImg = ogImage || `${APP_URL()}/og-default.png`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — ${SITE_NAME}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index,follow,max-snippet:200,max-image-preview:large">
<link rel="canonical" href="${esc(canonical)}">

<!-- Open Graph -->
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:image" content="${esc(ogImg)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="en_US">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ogImg)}">

<!-- PWA / Theme -->
<meta name="theme-color" content="#C9963A">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${SITE_NAME}">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧵</text></svg>">

${jsonLD ? `<script type="application/ld+json">${jsonLD}</script>` : ''}

<!-- Preload server data — must run BEFORE the app script -->
<script>
window.__SSR__            = ${JSON.stringify(preloadData)};
window.__INITIAL_SCREEN__ = '${screenName}';
</script>

<!-- Fonts -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&display=swap" rel="stylesheet">

<!-- App styles -->
${css}
</head>
<body>
${bodyHTML}
<script>
${appJS}
</script>
</body>
</html>`;
}

// ── Page renderers ────────────────────────────────────────────────

function renderHome() {
  const personalities = db.prepare(
    `SELECT p.*, COUNT(DISTINCT f.user_id) as followers
     FROM personalities p LEFT JOIN follows f ON f.personality_id = p.id
     GROUP BY p.id ORDER BY followers DESC LIMIT 16`
  ).all();

  const newsCount = db.prepare('SELECT COUNT(*) as c FROM news').get().c;
  const pCount    = db.prepare('SELECT COUNT(*) as c FROM personalities').get().c;

  const jsonLD = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: APP_URL(),
    description: SITE_DESC,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${APP_URL()}/?q={search_term_string}` },
      'query-input': 'required name=search_term_string'
    }
  });

  return htmlShell({
    title: 'People-Centric News Intelligence for Nepal',
    description: SITE_DESC,
    canonical: APP_URL(),
    ogType: 'website',
    jsonLD,
    screenName: 'discover',
    preloadData: { personalities, newsCount, pCount }
  });
}

function renderPersonality(slug) {
  const p = db.prepare(
    `SELECT pe.*, COUNT(DISTINCT f.user_id) as followers
     FROM personalities pe LEFT JOIN follows f ON f.personality_id = pe.id
     WHERE pe.slug = ? GROUP BY pe.id`
  ).get(slug);

  if (!p) return null;

  const news = db.prepare(
    `SELECT id, title, snippet, source_name, source_url, category, published_at
     FROM news WHERE personality_id = ? ORDER BY published_at DESC LIMIT 20`
  ).all(p.id);

  const fakeNews = db.prepare(
    `SELECT id, headline, verdict, debunk FROM fake_news WHERE personality_id = ? ORDER BY created_at DESC`
  ).all(p.id);

  const displayName = p.name_local ? `${p.name} (${p.name_local})` : p.name;
  const description = p.bio
    ? `${p.name} — ${p.bio}. Follow ${p.name}'s latest news, analysis and fact-checks on MakeMyThread.`
    : `Follow ${displayName}'s latest news, AI analysis and fake news alerts on MakeMyThread.`;

  const jsonLD = JSON.stringify([
    {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: p.name,
      alternateName: p.name_local || undefined,
      description: p.bio || undefined,
      url: `${APP_URL()}/p/${slug}`,
      mainEntityOfPage: `${APP_URL()}/p/${slug}`
    },
    ...news.slice(0, 5).map(n => ({
      '@type': 'NewsArticle',
      headline: n.title,
      url: n.source_url || `${APP_URL()}/p/${slug}`,
      datePublished: n.published_at,
      description: n.snippet || undefined,
      publisher: { '@type': 'Organization', name: n.source_name || SITE_NAME }
    }))
  ]);

  return htmlShell({
    title: `${displayName} — Latest News & Analysis`,
    description,
    canonical: `${APP_URL()}/p/${slug}`,
    ogType: 'profile',
    jsonLD,
    screenName: 'discover',
    preloadData: { personality: p, news, fakeNews, openProfile: p.id }
  });
}

function renderFakeRadar() {
  const fakeNews = db.prepare(
    `SELECT f.*, p.name as person_name, p.name_local as person_name_local,
            p.slug as person_slug
     FROM fake_news f LEFT JOIN personalities p ON p.id = f.personality_id
     ORDER BY f.created_at DESC LIMIT 30`
  ).all();

  const fakeCount = db.prepare('SELECT COUNT(*) as c FROM fake_news').get().c;
  const desc = `Fake Radar — AI-powered fake news detection for Nepal. ${fakeCount} verified fake news entries tracked and debunked.`;

  const jsonLD = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `Fake Radar — ${SITE_NAME}`,
    description: desc,
    url: `${APP_URL()}/fakeradar`,
    mainEntity: fakeNews.slice(0, 5).map(f => ({
      '@type': 'Claim',
      name: f.headline,
      text: f.claim || f.headline,
      appearance: { '@type': 'CreativeWork', description: f.debunk || '' }
    }))
  });

  return htmlShell({
    title: 'Fake Radar — AI-Powered Fake News Detection for Nepal',
    description: desc,
    canonical: `${APP_URL()}/fakeradar`,
    jsonLD,
    screenName: 'fakeradar',
    preloadData: { fakeNews, fakeCount }
  });
}

function renderDiscover() {
  const personalities = db.prepare(
    `SELECT p.*, COUNT(DISTINCT f.user_id) as followers
     FROM personalities p LEFT JOIN follows f ON f.personality_id = p.id
     GROUP BY p.id ORDER BY followers DESC`
  ).all();

  const jsonLD = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Nepal Personalities on MakeMyThread',
    itemListElement: personalities.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Person',
        name: p.name,
        alternateName: p.name_local || undefined,
        url: `${APP_URL()}/p/${p.slug}`
      }
    }))
  });

  return htmlShell({
    title: 'Discover Nepal Personalities — MakeMyThread',
    description: `Discover ${personalities.length} Nepal and global personalities. Follow them for AI-powered news analysis, fact-checks, and fake news alerts.`,
    canonical: `${APP_URL()}/discover`,
    jsonLD,
    screenName: 'discover',
    preloadData: { personalities }
  });
}

function renderArticle(id) {
  const n = db.prepare(
    `SELECT n.*, p.name as person_name, p.name_local as person_name_local, p.slug as person_slug
     FROM news n LEFT JOIN personalities p ON p.id = n.personality_id
     WHERE n.id = ?`
  ).get(id);

  if (!n) return null;

  const description = n.snippet || `Read the latest news about ${n.person_name} on MakeMyThread.`;

  const jsonLD = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: n.title,
    description,
    datePublished: n.published_at || n.created_at,
    dateModified: n.created_at,
    url: n.source_url || `${APP_URL()}/news/${id}`,
    author: { '@type': 'Organization', name: n.source_name || SITE_NAME },
    publisher: { '@type': 'Organization', name: SITE_NAME },
    about: n.person_name ? { '@type': 'Person', name: n.person_name } : undefined,
    mainEntityOfPage: `${APP_URL()}/news/${id}`
  });

  return htmlShell({
    title: n.title,
    description,
    canonical: `${APP_URL()}/news/${id}`,
    ogType: 'article',
    jsonLD,
    screenName: 'feed',
    preloadData: { article: n }
  });
}

module.exports = { renderHome, renderPersonality, renderFakeRadar, renderDiscover, renderArticle };
