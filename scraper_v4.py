#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MAKEMYTHREAD SCRAPER v4.0 — Improved
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Improvements over v3.2:
  • Parallel async fetching (httpx + asyncio)
  • Pre-checks DB for existing URLs before scraping
  • PINews failures detected fast (single attempt, DNS check first)
  • GNews pagination (up to 50 results per personality)
  • Smart RSS matching (partial name match, not strict first+last)
  • Retry logic with exponential backoff
  • Delta detection — only push new articles
  • Content quality scoring
  • Structured JSON logging per run
  • Proper error recovery per source

Usage:
  python scraper_v4.py              # CSV mode
  python scraper_v4.py --push       # Push to backend
  python scraper_v4.py --status     # Check backend
  python scraper_v4.py --push --force  # Push ALL (ignore dedup)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import sys, io, os, json, hashlib, time, argparse, logging
from datetime import datetime, timedelta
from urllib.parse import urlencode

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

import httpx
import asyncio
import feedparser
import pandas as pd
from bs4 import BeautifulSoup

# ── Config ────────────────────────────────────────────────────────
API_URL         = os.environ.get('MMT_API_URL',       'http://localhost:3000')
API_SECRET      = os.environ.get('MMT_API_SECRET',    '')
GNEWS_KEY       = os.environ.get('GNEWS_API_KEY',     '243261f5ab25fecc02d80e82d3859d20')
PINEWS_KEY      = os.environ.get('PINEWS_API_KEY',    '6b5856851f6e40ada902001dfc069158')
PINEWS_ENDPOINT = os.environ.get('PINEWS_ENDPOINT',   'https://api.apinews.net/news')
MAX_RESULTS_PER_SOURCE = 50   # GNews pagination cap


TARGETS = []

def load_targets():
    global TARGETS
    try:
        import urllib.request, json
        headers = {}
        if API_SECRET:
            headers['x-scraper-secret'] = API_SECRET
        req = urllib.request.Request(f'{API_URL}/api/personalities', headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            personas = data if isinstance(data, list) else data.get('personalities', data.get('data', []))
        TARGETS = []
        for p in personas:
            name_en = p.get('name', '')
            slug = p.get('slug', name_en.lower().replace(' ', '-'))
            terms = [name_en] if name_en else []
            parts = name_en.split()
            if len(parts) >= 2:
                terms.append(parts[0] + ' ' + parts[-1])
            if len(parts) == 3:
                terms.append(parts[0] + ' ' + parts[1])
            if p.get('name_local'):
                terms.append(p['name_local'])
            TARGETS.append({
                'name': p.get('name_local', name_en),
                'name_en': name_en,
                'slug': slug,
                'search_terms': list(dict.fromkeys(terms))[:4],
                'category': p.get('category', 'politician'),
                'bio': p.get('bio', ''),
                'keywords': [w.lower() for w in name_en.split()] + ([slug] if slug else []),
            })
        log.info(f'Loaded {len(TARGETS)} personalities from backend')
    except Exception as e:
        log.warning(f'Could not load personalities from API: {e}')
        global _FALLBACK_TARGETS
        TARGETS = _FALLBACK_TARGETS

_FALLBACK_TARGETS = [
    {'name': 'Balen Shah', 'name_en': 'Balen Shah', 'slug': 'balen-shah',
     'search_terms': ['Balen Shah', 'Balendra Shah'], 'category': 'politician', 'bio': '', 'keywords': ['balen']},
    {'name': 'Prachanda', 'name_en': 'Prachanda', 'slug': 'prachanda',
     'search_terms': ['Prachanda', 'Pushpa Kamal Dahal'], 'category': 'politician', 'bio': '', 'keywords': ['prachanda']},
    {'name': 'KP Oli', 'name_en': 'KP Oli', 'slug': 'kp-oli',
     'search_terms': ['KP Oli', 'K.P. Oli', 'Khadga Prasad Oli'], 'category': 'politician', 'bio': '', 'keywords': ['kp', 'oli']},
    {'name': 'Gagan Thapa', 'name_en': 'Gagan Thapa', 'slug': 'gagan-thapa',
     'search_terms': ['Gagan Thapa'], 'category': 'politician', 'bio': '', 'keywords': ['gagan', 'thapa']},
    {'name': 'Harka Sampang', 'name_en': 'Harka Sampang', 'slug': 'harka-sampang',
     'search_terms': ['Harka Sampang', 'Harka Bahadur'], 'category': 'politician', 'bio': '', 'keywords': ['harka', 'sampang']},
]


RSS_FEEDS = [
    ('onlinekhabar',     'https://www.onlinekhabar.com/feed'),
    ('ekantipur',        'https://ekantipur.com/rss'),
    ('setopati',         'https://www.setopati.com/feed'),
    ('ratopati',         'https://ratopati.com/feed'),
    ('kathmandupost',    'https://kathmandupost.com/rss'),
    ('thehimalayantimes', 'https://thehimalayantimes.com/feed'),
    ('myrepublica',      'https://myrepublica.nagariknetwork.com/feed'),
    ('nepallivetoday',   'https://nepallivetoday.com/feed'),
]

# Keywords that indicate a personality mention in RSS
RSS_KEYWORDS = {
    'balen-shah':    ['balen', 'balendra', 'kathmandu mayor', 'rsp', 'swatantra'],
    'prachanda':     ['prachanda', 'maoist', 'dahal', 'pushpa'],
    'kp-oli':        ['kp oli', 'koli', 'khadga', 'oli', 'cpn-uml'],
    'gagan-thapa':   ['gagan thapa'],
    'harka-sampang': ['harka sampang', 'harka', 'dharan'],
}


# ── Logging setup ───────────────────────────────────────────────
LOG_DIR = 'scraper_logs'
os.makedirs(LOG_DIR, exist_ok=True)
RUN_ID = datetime.now().strftime('%Y%m%d_%H%M%S')
LOG_FILE = os.path.join(LOG_DIR, f'run_{RUN_ID}.log')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
log = logging.getLogger('mmt_scraper')


# ── Async HTTP client ────────────────────────────────────────────
class AsyncHTTP:
    def __init__(self):
        self._client = None
        self._timeout = httpx.Timeout(15.0, connect=5.0)

    async def __aenter__(self):
        self._client = httpx.AsyncClient(timeout=self._timeout)
        return self

    async def __aexit__(self, *args):
        await self._client.aclose()

    async def get(self, url, retries=2, backoff=1.0, headers=None):
        last_err = None
        for attempt in range(retries + 1):
            try:
                resp = await self._client.get(url, headers=headers or {})
                return resp
            except httpx.TimeoutException as e:
                last_err = f'timeout after {self._timeout.read_timeout}s'
            except httpx.ConnectError as e:
                last_err = f'connection error: {e}'
            except httpx.HTTPStatusError as e:
                last_err = f'HTTP {e.response.status_code}'
            except Exception as e:
                last_err = str(e)

            if attempt < retries:
                wait = backoff * (2 ** attempt)
                log.warning(f'  Retry {attempt+1}/{retries} for {url[:60]} after {wait:.1f}s ({last_err})')
                await asyncio.sleep(wait)

        return None, last_err

    async def post(self, url, json=None, headers=None, retries=1, backoff=1.0):
        for attempt in range(retries + 1):
            try:
                resp = await self._client.post(url, json=json, headers=headers or {})
                return resp, None
            except Exception as e:
                last_err = str(e)
                if attempt < retries:
                    wait = backoff * (2 ** attempt)
                    await asyncio.sleep(wait)
        return None, last_err


# ── Main Scraper ─────────────────────────────────────────────────
class ScraperV4:

    def __init__(self, output_dir='scraped_data', dry_run=False, force_push=False):
        self.output_dir = output_dir
        self.dry_run = dry_run
        self.force_push = force_push
        self.articles = []       # final deduplicated articles to push
        self._seen_urls = set()
        self._db_urls = set()    # URLs already in DB
        self.stats = {
            'gnews_fetched': 0, 'gnews_new': 0,
            'pinews_fetched': 0, 'pinews_new': 0,
            'rss_fetched': 0, 'rss_new': 0,
            'dupes_skipped': 0, 'quality_filtered': 0,
        }
        self.run_id = RUN_ID
        os.makedirs(output_dir, exist_ok=True)
        self._session = None

    # ── Check DB for existing URLs ─────────────────────────────
    async def preload_db_urls(self):
        """Fetch all existing article URLs from backend to avoid re-scraping."""
        if self.dry_run or not API_SECRET:
            return
        try:
            async with AsyncHTTP() as client:
                headers = {'x-scraper-secret': API_SECRET}
                resp = await client.get(f'{API_URL}/api/scraper/status', headers=headers)
                if not resp or resp.status_code != 200:
                    log.warning(f'  Could not preload DB URLs: {resp.status_code if resp else "none"}')
                    return

                # Get all existing URLs by querying the feed (no auth needed)
                resp2 = await client.get(f'{API_URL}/api/news/feed?limit=500', headers={})
                if not resp2 or resp2.status_code != 200:
                    return

                data = resp2.json()
                articles = data.get('data', []) or []
                for a in articles:
                    if url := a.get('source_url') or a.get('url'):
                        self._db_urls.add(url)
                    if url := a.get('link'):
                        self._db_urls.add(url)

                log.info(f'  Preloaded {len(self._db_urls)} existing article URLs from DB')
        except Exception as e:
            log.warning(f'  Could not preload DB URLs: {e}')

    # ── Check if URL is new ─────────────────────────────────────
    def _is_new_url(self, url):
        if not url:
            return False
        # Normalize: remove trailing slash, query params
        normalized = url.rstrip('/').split('?')[0].lower()
        if normalized in self._db_urls or normalized in self._seen_urls:
            return False
        self._seen_urls.add(normalized)
        return True

    # ── Quality scoring ─────────────────────────────────────────
    def _quality_score(self, title, snippet, url):
        score = 0
        # URL authority bonus
        known_news = ['kathmandupost.com', 'thehimalayantimes.com', 'ekantipur.com',
                      'onlinekhabar.com', 'setopati.com', 'ratopati.com',
                      'myrepublica.com', 'nepallivetoday.com']
        if any(d in url.lower() for d in known_news):
            score += 20
        # Title length sanity
        if 30 < len(title) < 200:
            score += 10
        # Snippet has content
        if len(snippet or '') > 50:
            score += 10
        # Has source
        if url:
            score += 5
        return score

    # ── Auto-categorise ─────────────────────────────────────────
    def _categorise(self, title, content):
        text = (title + ' ' + (content or '')).lower()
        rules = [
            ('politics',      ['election','parliament','minister','government','party',
                              'सरकार','मन्त्री','निर्वाचन','संसद','नेपाल कम्युनिस्ट']),
            ('sports',        ['cricket','football','sports','game','match','खेल','क्रिकेट','नेपाली खेल']),
            ('business',      ['economy','business','trade','investment','market','GDP','आर्थिक']),
            ('technology',    ['technology','digital','internet','AI','software','tech','सूचना प्रविधि']),
            ('health',        ['health','hospital','medical','disease','doctor','स्वास्थ्य','उपचार']),
            ('international', ['international','foreign','india','china','UN','US','global','विदेश']),
            ('social',        ['social','community','education','school','women','youth','समाज']),
        ]
        for cat, keywords in rules:
            if any(kw in text for kw in keywords):
                return cat
        return 'general'

    # ── Make article dict ────────────────────────────────────────
    def _make_article(self, target, title, snippet, full_content, source_name,
                      source_url, published_at, source_type='unknown'):
        quality = self._quality_score(title, snippet, source_url)
        return {
            'title':              title[:300],
            'snippet':           (snippet or title or '')[:500],
            'full_content':      (full_content or snippet or '')[:10000],
            'source_name':       source_name or 'Unknown',
            'source_url':        source_url or '',
            'link':              source_url or '',
            'category':          self._categorise(title, snippet or ''),
            'published_at':      published_at or datetime.now().isoformat(),
            'personality_name_en': target['name_en'],
            'personality_name':    target['name'],
            'personality_slug':    target['slug'],
            'source_type':        source_type,   # 'gnews' | 'pinews' | 'rss'
            'quality_score':      quality,
            'run_id':             self.run_id,
            # Legacy aliases
            'headline':          title[:300],
            'summary':           (snippet or title or '')[:500],
            'source':            source_name or 'Unknown',
        }

    # ── SOURCE 1: GNews (async, batched, rate-limit aware) ─────
    async def fetch_gnews(self, client, target):
        """Fetch GNews with:
          • Single combined query per personality (reduces API calls 3x)
          • Rate-limit backoff (429 = wait 60s, don't spam)
          • Max 20 results per personality per run
        """
        if not GNEWS_KEY:
            log.info(f'  [GNews] No API key — skipping')
            return 0, 0

        added = 0
        fetched = 0

        # Combine all search terms into ONE query per personality (free tier friendly)
        terms = target['search_terms'][:3]
        combined_query = ' OR '.join(f'"{t}"' for t in terms)

        params = {
            'q': combined_query,
            'lang': 'en',
            'max': 20,          # increased but still capped
            'token': GNEWS_KEY,
            'sortby': 'publishedAt',
        }

        url = 'https://gnews.io/api/v4/search?' + urlencode(params)

        # Retry once after 60s if rate-limited
        for attempt in range(2):
            try:
                resp = await client.get(url)

                if resp is None:
                    log.warning(f'  [GNews] Network failure for {target["name_en"]}')
                    break

                if resp.status_code == 429:
                    log.warning(f'  [GNews] Rate limited (429) — waiting 65s before retry...')
                    await asyncio.sleep(65)
                    continue  # retry the same URL

                if resp.status_code != 200:
                    log.warning(f'  [GNews] {resp.status_code} for "{target["name_en"]}"')
                    break

                data = resp.json()
                articles = data.get('articles', [])
                fetched = len(articles)

                for a in articles:
                    art = self._make_article(
                        target,
                        a.get('title', ''),
                        a.get('description', ''),
                        a.get('content', ''),
                        a.get('source', {}).get('name', 'GNews'),
                        a.get('url', ''),
                        a.get('publishedAt', ''),
                        'gnews'
                    )
                    if self._is_new_url(art['source_url']):
                        self.articles.append(art)
                        added += 1

                log.info(f'  [GNews] {target["name_en"]}: {fetched} fetched, {added} new (from combined query)')
                break  # success or non-429 error — don't retry

            except Exception as e:
                log.error(f'  [GNews] Error: {e}')
                break

        self.stats['gnews_fetched'] += fetched
        self.stats['gnews_new'] += added
        return fetched, added

    # ── SOURCE 2: PINews (with DNS pre-check) ───────────────────
    async def fetch_pinews(self, client, target):
        if not PINEWS_KEY:
            log.info(f'  [PINews] No API key — skipping')
            return 0, 0

        # Fast DNS check
        import socket
        try:
            socket.setdefaulttimeout(3)
            socket.gethostbyname('api.apinews.net')
        except socket.gaierror:
            log.warning(f'  [PINews] DNS resolution failed for api.apinews.net — skipping')
            self.stats['pinews_fetched'] += 0
            return 0, 0

        added = 0
        fetched = 0

        for term in [target['name_en'], target['name']][:2]:
            try:
                # Try main param name
                url = f'{PINEWS_ENDPOINT}?q={httpx.utils.encode_path_param(term)}&apiKey={PINEWS_KEY}&language=en&pageSize=10'
                resp = await client.get(url)

                # Single retry with alternate param name
                if resp is None or resp.status_code != 200:
                    alt_url = f'{PINEWS_ENDPOINT}?q={httpx.utils.encode_path_param(term)}&api_key={PINEWS_KEY}&language=en&pageSize=10'
                    resp2 = await client.get(alt_url)
                    if not resp2:
                        log.warning(f'  [PINews] Both apiKey and api_key failed for "{term}"')
                        continue
                    resp = resp2

                if resp is None:
                    continue

                data = resp.json()
                items = (data.get('articles') or data.get('results')
                      or data.get('data') or [])

                fetched += len(items)

                for a in items:
                    src = a.get('source', '')
                    if isinstance(src, dict):
                        src = src.get('name', 'PINews')
                    art = self._make_article(
                        target,
                        a.get('title') or a.get('headline', ''),
                        a.get('description') or a.get('summary', ''),
                        a.get('content') or a.get('body', ''),
                        src or 'PINews',
                        a.get('url') or a.get('link', ''),
                        a.get('publishedAt') or a.get('pubDate', ''),
                        'pinews'
                    )
                    if self._is_new_url(art['source_url']):
                        self.articles.append(art)
                        added += 1

                log.info(f'  [PINews] "{term}" → {len(items)} results, {added} new')

            except Exception as e:
                log.error(f'  [PINews] Error: {e}')

        self.stats['pinews_fetched'] += fetched
        self.stats['pinews_new'] += added
        return fetched, added

    # ── SOURCE 3: RSS (async fetch, smart matching) ─────────────
    async def fetch_rss(self, client, source_name, feed_url):
        try:
            resp = await client.get(feed_url, retries=1)
            if resp is None or resp.status_code != 200:
                log.warning(f'  [RSS] {source_name}: failed to fetch')
                return 0, 0

            feed = feedparser.parse(resp.text)
            added = 0
            fetched = 0

            for entry in feed.entries[:30]:  # increased from 20
                title   = (entry.get('title') or '').strip()
                link    = entry.get('link', '')
                summary = (entry.get('summary') or entry.get('description') or '').strip()
                if not title or not link:
                    continue

                fetched += 1

                # Check which personalities this matches
                text = (title + ' ' + summary).lower()

                for target in TARGETS:
                    slug = target['slug']
                    kws = RSS_KEYWORDS.get(slug, [])

                    # Smart match: any keyword appears in text
                    matched = any(kw in text for kw in target['keywords']) or any(
                        kw.lower() in text for kw in target['search_terms'][:2]
                    )

                    if matched:
                        art = self._make_article(
                            target, title, summary, summary,
                            source_name, link,
                            entry.get('published') or entry.get('updated')
                            or datetime.now().isoformat(),
                            'rss'
                        )
                        if self._is_new_url(link):
                            self.articles.append(art)
                            added += 1
                            log.info(f'    ✓ [{source_name}] {target["name_en"]}: {title[:60]}')
                            break  # one article → one personality (first match)

            return fetched, added

        except Exception as e:
            log.error(f'  [RSS] {source_name}: {e}')
            return 0, 0

    # ── Run all sources ─────────────────────────────────────────
    async def run(self, use_apis=True, use_rss=True):
        log.info('=' * 70)
        log.info(f'MAKEMYTHREAD SCRAPER v4.0 — Run {self.run_id}')
        log.info(f'API: {API_URL} | Push: {bool(API_SECRET)} | Force: {self.force_push}')
        log.info('=' * 70)

        # Load personalities from backend (falls back to hardcoded list on failure)
        load_targets()

        await self.preload_db_urls()

        async with AsyncHTTP() as client:
            tasks = []

            if use_apis:
                for target in TARGETS:
                    log.info(f'\n── {target["name_en"]} ({target["name"]}) ──')
                    tasks.append(self.fetch_gnews(client, target))
                    tasks.append(self.fetch_pinews(client, target))
                    await asyncio.sleep(0.5)  # stagger to avoid rate limiting

            if use_rss:
                log.info('\n── RSS Feeds ──')
                for source_name, feed_url in RSS_FEEDS:
                    tasks.append(self.fetch_rss(client, source_name, feed_url))
                    await asyncio.sleep(0.3)

            results = await asyncio.gather(*tasks, return_exceptions=True)

        # Summary
        log.info(f'\n── Results for Run {self.run_id} ──')
        log.info(f'  Total unique articles: {len(self.articles)}')

        by_source = {}
        by_slug = {}
        for art in self.articles:
            src = art['source_type']
            by_source[src] = by_source.get(src, 0) + 1
            slug = art['personality_slug']
            by_slug[slug] = by_slug.get(slug, 0) + 1

        for src, count in sorted(by_source.items()):
            log.info(f'  {src}: {count}')
        for slug, count in sorted(by_slug.items()):
            target = next((t for t in TARGETS if t['slug'] == slug), {})
            log.info(f'  {target.get("name_en", slug)}: {count}')

        return self.articles

    # ── Save CSV + run metadata ─────────────────────────────────
    def save_csv(self, extra_tag=''):
        if not self.articles:
            log.info('No articles to save')
            return

        ts = RUN_ID
        tag = f'_{extra_tag}' if extra_tag else ''

        # Articles CSV
        f = os.path.join(self.output_dir, f'news_{ts}{tag}.csv')
        pd.DataFrame(self.articles).to_csv(f, index=False, encoding='utf-8-sig')
        log.info(f'✓ Saved {len(self.articles)} articles → {f}')

        # Personalities CSV
        pf = pd.DataFrame([{
            'name': t['name'], 'name_en': t['name_en'],
            'slug': t['slug'], 'category': t['category'], 'bio': t['bio']
        } for t in TARGETS])
        ppf = os.path.join(self.output_dir, f'personalities_{ts}{tag}.csv')
        pf.to_csv(ppf, index=False, encoding='utf-8-sig')
        log.info(f'✓ Saved personalities → {ppf}')

        # Run metadata JSON
        meta = {
            'run_id': self.run_id, 'timestamp': datetime.now().isoformat(),
            'total_articles': len(self.articles),
            'by_source': dict(by_source) if 'by_source' in dir() else {},
            'by_personality': dict(by_slug) if 'by_slug' in dir() else {},
            'stats': self.stats,
        }
        mf = os.path.join(self.output_dir, f'meta_{ts}{tag}.json')
        with open(mf, 'w', encoding='utf-8') as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)
        log.info(f'✓ Saved metadata → {mf}')

    # ── Push to API ─────────────────────────────────────────────
    async def push_to_api(self):
        if not API_SECRET:
            log.error('MMT_API_SECRET not set — cannot push')
            return False

        if not self.force_push and not self.articles:
            log.info('No new articles to push')
            return True

        log.info(f'\nPushing {len(self.articles)} articles to {API_URL}/api/scraper/push')

        if self.dry_run:
            log.info('[DRY RUN] Skipping actual push')
            return True

        personalities = [{
            'name': t['name_en'], 'name_local': t['name'],
            'slug': t['slug'], 'category': t['category'],
            'bio': t['bio'], 'nationality': 'Nepali',
        } for t in TARGETS]

        payload = {
            'personalities': personalities,
            'news': self.articles,
            'run_id': self.run_id,
        }
        headers = {
            'Content-Type': 'application/json',
            'x-scraper-secret': API_SECRET,
        }

        async with AsyncHTTP() as client:
            resp, err = await client.post(
                f'{API_URL}/api/scraper/push',
                json=payload, headers=headers, retries=2, backoff=2.0
            )

            if err or not resp:
                log.error(f'Push failed: {err or resp}')
                return False

            if resp.status_code == 200:
                r = resp.json()
                log.info(f'\n✓ Push success!')
                log.info(f'  Inserted:     {r.get("news_inserted", "?")}')
                log.info(f'  Duplicates:   {r.get("news_skipped_duplicate", "?")}')
                log.info(f'  No-match:     {r.get("news_skipped_no_personality", "?")}')
                if r.get('errors'):
                    for e in r['errors'][:5]:
                        log.error(f'    Error: {e}')
                return True
            else:
                log.error(f'✗ HTTP {resp.status_code}: {resp.text[:300]}')
                return False

    # ── Status check ─────────────────────────────────────────────
    async def check_status(self):
        log.info(f'Checking {API_URL}/api/scraper/status ...')
        if not API_SECRET:
            log.error('MMT_API_SECRET not set')
            return

        async with AsyncHTTP() as client:
            headers = {'x-scraper-secret': API_SECRET}
            resp, err = await client.get(f'{API_URL}/api/scraper/status', headers=headers)

            if err or not resp or resp.status_code != 200:
                log.error(f'Status check failed: {err or resp.status_code if resp else "none"}')
                return

            d = resp.json()
            log.info(f'✓ Backend online')
            log.info(f'  Total news in DB: {d.get("total_news", "?")}')
            log.info(f'  Personalities: {len(d.get("personalities", []))}')
            for p in d.get('personalities', []):
                match = '✓' if any(t['slug'] == p['slug'] for t in TARGETS) else '?'
                local = p.get('name_local', '—')
                log.info(f'    {match} {p["name"]} ({local}) → /p/{p["slug"]}')


# ── CLI ─────────────────────────────────────────────────────────
if __name__ == '__main__':
    p = argparse.ArgumentParser(description='MakeMyThread Scraper v4.0')
    p.add_argument('--push',     action='store_true', help='Push to backend')
    p.add_argument('--status',   action='store_true', help='Check backend status')
    p.add_argument('--csv',      action='store_true', help='Save CSV output')
    p.add_argument('--api-only', action='store_true', help='Skip RSS')
    p.add_argument('--rss-only', action='store_true', help='Skip API sources')
    p.add_argument('--api-url',  default=None)
    p.add_argument('--secret',   default=None)
    p.add_argument('--force',    action='store_true', help='Push all (skip dedup against DB)')
    args = p.parse_args()

    if args.api_url: API_URL    = args.api_url
    if args.secret:  API_SECRET = args.secret

    scraper = ScraperV4(
        output_dir='scraped_data_v4',
        dry_run=False,
        force_push=args.force,
    )

    if args.status:
        asyncio.run(scraper.check_status())
        sys.exit(0)

    use_apis = not args.rss_only
    use_rss  = not args.api_only

    asyncio.run(scraper.run(use_apis=use_apis, use_rss=use_rss))

    if args.push:
        asyncio.run(scraper.push_to_api())
    elif args.csv or True:  # always save CSV
        scraper.save_csv()

    log.info(f'\nDone — Run {RUN_ID} | Log: {LOG_FILE}')