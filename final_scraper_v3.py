#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FINAL NEWS SCRAPER v3.2
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Sources (in order of preference):
  1. GNews API     — targeted search by personality name (cleanest data)
  2. NewsData.io   — real-time news API (pub_e0fed32fe9ff41d985da6297729b5726)
  3. NewsAPI.org   — global news coverage (6b5856851f6e40ada902001dfc069158)
  4. Serper.dev    — Google search results API (1e3eb2d6d6889bff1c5793a29fdb8654399d4ef1)
  5. TheNewsAPI    — structured news data (6bLJaKvNAq7CQywg8DUxoSemT5U7pbvhpiT6qT15)
  6. PINews API    — supplemental API coverage
  7. RSS feeds     — 8 Nepali outlets (broad fallback coverage)

All results merged, deduplicated by URL, then pushed to backend.

Usage:
  python final_scraper_v3.py              # CSV mode (original)
  python final_scraper_v3.py --push       # push to MakeMyThread backend
  python final_scraper_v3.py --status     # check backend connection
  python final_scraper_v3.py --api-only   # GNews + PINews only, skip RSS
  python final_scraper_v3.py --rss-only   # RSS only, skip APIs

Environment variables:
  MMT_API_URL        http://localhost:3000
  MMT_API_SECRET     your_scraper_secret
  GNEWS_API_KEY      243261f5ab25fecc02d80e82d3859d20
  PINEWS_API_KEY     6b5856851f6e40ada902001dfc069158
  PINEWS_ENDPOINT    https://api.apinews.net/news   (optional override)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import sys, io, os, json, hashlib, time, argparse, ast
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

import requests
from bs4 import BeautifulSoup
import pandas as pd
import feedparser

# ── Config from environment ───────────────────────────────────────
API_URL         = os.environ.get('MMT_API_URL',       'http://localhost:3000')
API_SECRET      = os.environ.get('MMT_API_SECRET',    '')
GNEWS_KEY       = os.environ.get('GNEWS_API_KEY',     '243261f5ab25fecc02d80e82d3859d20')
PINEWS_KEY      = os.environ.get('PINEWS_API_KEY',    '6b5856851f6e40ada902001dfc069158')
PINEWS_ENDPOINT = os.environ.get('PINEWS_ENDPOINT',   'https://api.apinews.net/news')
# New sources
NEWSDATA_KEY    = os.environ.get('NEWSDATA_API_KEY',  'pub_e0fed32fe9ff41d985da6297729b5726')
NEWSAPI_KEY     = os.environ.get('NEWSAPI_KEY',       '6b5856851f6e40ada902001dfc069158')
SERPER_KEY      = os.environ.get('SERPER_API_KEY',    '1e3eb2d6d6889bff1c5793a29fdb8654399d4ef1')
THENEWSAPI_KEY  = os.environ.get('THENEWSAPI_KEY',   '6bLJaKvNAq7CQywg8DUxoSemT5U7pbvhpiT6qT15')

# ── Personalities ─────────────────────────────────────────────────
# TARGETS loaded dynamically from API when --from-api is used
# Falls back to hardcoded list below
TARGETS = []

def load_targets_from_api():
    """Fetch personalities from MMT backend API instead of using hardcoded list."""
    import requests
    secret = os.environ.get('MMT_API_SECRET', os.environ.get('SCRAPER_SECRET', ''))
    if not secret:
        print('[API] MMT_API_SECRET not set — using hardcoded targets')
        return False

    try:
        resp = requests.get(
            f'{API_URL}/api/scraper/personalities',
            headers={'x-scraper-secret': secret},
            timeout=15
        )
        if resp.status_code != 200:
            print(f'[API] Failed to fetch personalities: {resp.status_code}')
            return False
        personas = resp.json()
        if not personas:
            print('[API] No personalities returned — using hardcoded targets')
            return False

        global TARGETS
        TARGETS = []
        for p in personas:
            terms = p.get('search_terms', [])
            if isinstance(terms, str):
                try: terms = json.loads(terms)
                except: terms = [terms]
            TARGETS.append({
                'name':        p.get('name_local') or p.get('name', ''),
                'name_en':     p.get('name', ''),
                'slug':        p.get('slug', ''),
                'search_terms': terms,
                'category':    p.get('category') or 'politician',
                'bio':         p.get('bio') or '',
            })
        print(f'[API] Loaded {len(TARGETS)} personalities from backend')
        return True
    except Exception as e:
        print(f'[API] Error loading personalities: {e} — using hardcoded targets')
        return False

# Default hardcoded personalities (used if --from-api fails or not set)
_hardcoded_targets = [
    {
        'name':       'बालेन शाह',
        'name_en':    'Balen Shah',
        'slug':       'balen-shah',
        'search_terms': ['"Balen Shah"', '"Balendra Shah"', 'बालेन शाह'],
        'category':   'politician',
        'bio':        'Mayor of Kathmandu — Rastriya Swatantra Party',
    },
    {
        'name':       'प्रचण्ड',
        'name_en':    'Prachanda',
        'slug':       'prachanda',
        'search_terms': ['"Prachanda"', '"Pushpa Kamal Dahal"', 'प्रचण्ड दाहाल'],
        'category':   'politician',
        'bio':        'Former Prime Minister — CPN (Maoist Centre)',
    },
    {
        'name':       'केपी ओली',
        'name_en':    'KP Oli',
        'slug':       'kp-oli',
        'search_terms': ['"KP Oli"', '"K.P. Oli"', '"Khadga Prasad Oli"', 'केपी ओली'],
        'category':   'politician',
        'bio':        'Former Prime Minister — CPN-UML',
    },
    {
        'name':       'गगन थापा',
        'name_en':    'Gagan Thapa',
        'slug':       'gagan-thapa',
        'search_terms': ['"Gagan Thapa"', 'गगन थापा'],
        'category':   'politician',
        'bio':        'Member of Parliament — Nepali Congress',
    },
    {
        'name':       'हर्क साम्पाङ',
        'name_en':    'Harka Sampang',
        'slug':       'harka-sampang',
        'search_terms': ['"Harka Sampang"', '"Harka Bahadur"', 'हर्क साम्पाङ'],
        'category':   'politician',
        'bio':        'Mayor of Dharan — Independent',
    },
]

# ── RSS fallback sources ──────────────────────────────────────────
RSS_FEEDS = {
    'onlinekhabar':     'https://www.onlinekhabar.com/feed',
    'ekantipur':        'https://ekantipur.com/rss',
    'setopati':         'https://www.setopati.com/feed',
    'ratopati':         'https://ratopati.com/feed',
    'kathmandupost':    'https://kathmandupost.com/rss',
    'thehimalayantimes':'https://thehimalayantimes.com/feed',
    'myrepublica':      'https://myrepublica.nagariknetwork.com/feed',
    'nepallivetoday':   'https://nepallivetoday.com/feed',
}

# Name matching for RSS articles (first + surname required)
RSS_NAME_PATTERNS = {
    'balen-shah':    (['Balen','Balendra','बालेन','बालेन्द्र'], ['Shah','शाह']),
    'prachanda':     (['Prachanda','Pushpa','प्रचण्ड','पुष्प'],  ['Dahal','दाहाल']),
    'kp-oli':        (['KP','K.P.','Khadga','केपी','खड्ग'],       ['Oli','ओली']),
    'gagan-thapa':   (['Gagan','গগन'],                             ['Thapa','थापा']),
    'harka-sampang': (['Harka','हर्क'],                            ['Sampang','साम्पाङ']),
}


class ScraperV32:

    def __init__(self, output_dir='scraped_data'):
        self.output_dir = output_dir
        self.articles   = []         # final deduplicated list
        self._seen_urls = set()
        os.makedirs(output_dir, exist_ok=True)
        self.session = requests.Session()
        self.session.headers.update({'User-Agent': 'Mozilla/5.0 (compatible; MMT-Scraper/3.2)'})

    # ── Dedup helper ──────────────────────────────────────────────
    def _add(self, article):
        url = article.get('source_url', '')
        if not url or url in self._seen_urls:
            return False
        self._seen_urls.add(url)
        self.articles.append(article)
        return True

    def _make_article(self, target, title, snippet, full_content, source_name, source_url, published_at):
        return {
            # Backend API field names
            'title':             title,
            'snippet':           (snippet or title)[:500],
            'full_content':      (full_content or snippet or '')[:10000],
            'source_name':       source_name,
            'source_url':        source_url,
            'category':          self._categorise(title, snippet or ''),
            'published_at':      published_at,
            'personality_name_en': target['name_en'],
            'personality_name':    target['name'],
            'personality_slug':    target['slug'],
            # Legacy CSV aliases
            'headline':          title,
            'summary':           (snippet or title)[:500],
            'source':            source_name,
            'link':              source_url,
        }

    # ── Auto-categorise (keyword, no API needed in Python) ────────
    def _categorise(self, title, content):
        text = (title + ' ' + content).lower()
        rules = [
            ('politics',     ['election','parliament','minister','government','party','सरकार','मन्त्री','निर्वाचन']),
            ('sports',       ['cricket','football','sports','game','match','खेल','क्रिकेट']),
            ('business',     ['economy','business','trade','investment','market','GDP']),
            ('technology',   ['technology','digital','internet','AI','software','tech']),
            ('health',       ['health','hospital','medical','disease','doctor','स्वास्थ्य']),
            ('international',['international','foreign','india','china','UN','US','global']),
            ('social',       ['social','community','education','school','women','youth']),
        ]
        for cat, keywords in rules:
            if any(kw in text for kw in keywords):
                return cat
        return 'general'

    # ── SOURCE 1: GNews API ───────────────────────────────────────
    def fetch_gnews(self, target):
        if not GNEWS_KEY:
            print('  [GNews] No key set — skipping')
            return 0
        added = 0
        for term in target['search_terms'][:2]:  # max 2 queries per personality
            try:
                url = (f'https://gnews.io/api/v4/search'
                       f'?q={requests.utils.quote(term)}'
                       f'&lang=en&max=10&sortby=publishedAt&token={GNEWS_KEY}')
                resp = self.session.get(url, timeout=15)
                if resp.status_code != 200:
                    print(f'  [GNews] {resp.status_code} for {term}')
                    continue
                data = resp.json()
                for a in data.get('articles', []):
                    art = self._make_article(
                        target,
                        a.get('title', ''),
                        a.get('description', ''),
                        a.get('content', ''),
                        a.get('source', {}).get('name', 'GNews'),
                        a.get('url', ''),
                        a.get('publishedAt', datetime.now().isoformat()),
                    )
                    if self._add(art):
                        added += 1
                print(f'  [GNews] "{term}" → {len(data.get("articles",[]))} results, {added} new')
                time.sleep(0.5)
            except Exception as e:
                print(f'  [GNews] Error: {e}')
        return added

    # ── SOURCE 2: PINews API ──────────────────────────────────────
    def fetch_pinews(self, target):
        if not PINEWS_KEY:
            print('  [PINews] No key set — skipping')
            return 0
        added = 0
        for term in [target['name_en'], target['name']][:2]:
            try:
                url = (f'{PINEWS_ENDPOINT}'
                       f'?q={requests.utils.quote(term)}'
                       f'&apiKey={PINEWS_KEY}&language=en&pageSize=10')
                resp = self.session.get(url, timeout=15)
                if resp.status_code != 200:
                    print(f'  [PINews] {resp.status_code} for "{term}"')
                    # Try alternate param name if first fails
                    url2 = url.replace('apiKey=', 'api_key=')
                    resp = self.session.get(url2, timeout=15)
                    if resp.status_code != 200:
                        continue
                data = resp.json()
                items = data.get('articles') or data.get('results') or data.get('data') or []
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
                        a.get('publishedAt') or a.get('pubDate', datetime.now().isoformat()),
                    )
                    if self._add(art):
                        added += 1
                print(f'  [PINews] "{term}" → {len(items)} results, {added} new')
                time.sleep(0.5)
            except Exception as e:
                print(f'  [PINews] Error: {e}')
        return added

    # ── SOURCE 3: RSS (original strict-match logic) ───────────────
    def _rss_matches(self, text, slug):
        firsts, surnames = RSS_NAME_PATTERNS.get(slug, ([], []))
        text_lo = text.lower()
        is_en = lambda s: any(c in 'abcdefghijklmnopqrstuvwxyz' for c in s)
        f_ne = any(f.lower() in text_lo for f in firsts  if not is_en(f))
        s_ne = any(s.lower() in text_lo for s in surnames if not is_en(s))
        f_en = any(f.lower() in text_lo for f in firsts  if is_en(f))
        s_en = any(s.lower() in text_lo for s in surnames if is_en(s))
        return (f_ne and s_ne) or (f_en and s_en)


    # ── NewsData.io ───────────────────────────────────────────────
    def fetch_newsdata(self, target):
        if not NEWSDATA_KEY:
            print(f'  [NewsData] No API key')
            return
        for term in target.get('search_terms', []):
            try:
                url = 'https://newsdata.io/api/1/news'
                params = {
                    'apikey': NEWSDATA_KEY,
                    'q': term,
                    'language': 'en',
                    'size': 10
                }
                r = requests.get(url, params=params, timeout=10)
                if r.status_code != 200:
                    print(f'  [NewsData] Error {r.status_code} for "{term}"')
                    continue
                data = r.json()
                for article in (data.get('results') or []):
                    self.articles.append({
                        'headline': article.get('title', ''),
                        'summary': article.get('description', ''),
                        'source': article.get('source_id', ''),
                        'link': article.get('link', ''),
                        'published': article.get('pubDate', ''),
                        'category': target.get('category', 'general'),
                        'personality_name_en': target.get('name_en', ''),
                        'personality_name': target.get('name', ''),
                        'personality_slug': target.get('slug', ''),
                        'source_name': article.get('source_name', article.get('source_id', '')),
                        'source_url': article.get('link', ''),
                        'img_color': '#DBEAFE',
                        'is_breaking': False
                    })
                print(f'  [NewsData] "{term}" → {len(data.get("results", []))} results')
            except Exception as e:
                print(f'  [NewsData] Exception for "{term}": {e}')
            time.sleep(0.5)

    # ── NewsAPI.org ────────────────────────────────────────────────
    def fetch_newsapi(self, target):
        if not NEWSAPI_KEY:
            print(f'  [NewsAPI] No API key')
            return
        for term in target.get('search_terms', []):
            try:
                url = 'https://newsapi.org/v2/everything'
                params = {
                    'apiKey': NEWSAPI_KEY,
                    'q': term,
                    'language': 'en',
                    'pageSize': 10,
                    'sortBy': 'publishedAt'
                }
                r = requests.get(url, params=params, timeout=10)
                if r.status_code != 200:
                    print(f'  [NewsAPI] Error {r.status_code} for "{term}"')
                    continue
                data = r.json()
                for article in (data.get('articles') or []):
                    self.articles.append({
                        'headline': article.get('title', ''),
                        'summary': article.get('description', ''),
                        'source': article.get('source', {}).get('name', ''),
                        'link': article.get('url', ''),
                        'published': article.get('publishedAt', ''),
                        'category': target.get('category', 'general'),
                        'personality_name_en': target.get('name_en', ''),
                        'personality_name': target.get('name', ''),
                        'personality_slug': target.get('slug', ''),
                        'source_name': article.get('source', {}).get('name', ''),
                        'source_url': article.get('url', ''),
                        'img_color': '#DBEAFE',
                        'is_breaking': False
                    })
                print(f'  [NewsAPI] "{term}" → {len(data.get("articles", []))} results')
            except Exception as e:
                print(f'  [NewsAPI] Exception for "{term}": {e}')
            time.sleep(0.5)

    # ── Serper.dev ────────────────────────────────────────────────
    def fetch_serper(self, target):
        if not SERPER_KEY:
            print(f'  [Serper] No API key')
            return
        for term in target.get('search_terms', []):
            try:
                url = 'https://google.serper.dev/search'
                payload = {'q': term, 'num': 10}
                headers = {'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json'}
                r = requests.post(url, json=payload, headers=headers, timeout=10)
                if r.status_code != 200:
                    print(f'  [Serper] Error {r.status_code} for "{term}"')
                    continue
                data = r.json()
                for item in (data.get('organic', []) or [])[:10]:
                    snippet = item.get('snippet', '')
                    self.articles.append({
                        'headline': item.get('title', ''),
                        'summary': snippet,
                        'source': item.get('source', ''),
                        'link': item.get('link', ''),
                        'published': item.get('date', ''),
                        'category': target.get('category', 'general'),
                        'personality_name_en': target.get('name_en', ''),
                        'personality_name': target.get('name', ''),
                        'personality_slug': target.get('slug', ''),
                        'source_name': item.get('source', ''),
                        'source_url': item.get('link', ''),
                        'img_color': '#DBEAFE',
                        'is_breaking': False
                    })
                print(f'  [Serper] "{term}" → {len(data.get("organic", [])[:10])} results')
            except Exception as e:
                print(f'  [Serper] Exception for "{term}": {e}')
            time.sleep(0.5)

    # ── TheNewsAPI ────────────────────────────────────────────────
    def fetch_thenewsapi(self, target):
        if not THENEWSAPI_KEY:
            print(f'  [TheNewsAPI] No API key')
            return
        for term in target.get('search_terms', []):
            try:
                url = 'https://api.thenewsapi.com/v1/news/all'
                params = {
                    'api_token': THENEWSAPI_KEY,
                    'q': term,
                    'language': 'en',
                    'page_size': 10
                }
                r = requests.get(url, params=params, timeout=10)
                if r.status_code != 200:
                    print(f'  [TheNewsAPI] Error {r.status_code} for "{term}"')
                    continue
                data = r.json()
                for article in (data.get('results') or []):
                    self.articles.append({
                        'headline': article.get('title', ''),
                        'summary': article.get('description', ''),
                        'source': article.get('source', {}).get('name', ''),
                        'link': article.get('url', ''),
                        'published': article.get('published_at', ''),
                        'category': target.get('category', 'general'),
                        'personality_name_en': target.get('name_en', ''),
                        'personality_name': target.get('name', ''),
                        'personality_slug': target.get('slug', ''),
                        'source_name': article.get('source', {}).get('name', ''),
                        'source_url': article.get('url', ''),
                        'img_color': '#DBEAFE',
                        'is_breaking': False
                    })
                print(f'  [TheNewsAPI] "{term}" → {len(data.get("results", []))} results')
            except Exception as e:
                print(f'  [TheNewsAPI] Exception for "{term}": {e}')
            time.sleep(0.5)

    def fetch_rss_all(self):
        total = 0
        for source_name, feed_url in RSS_FEEDS.items():
            print(f'\n  [RSS] {source_name}')
            try:
                feed = feedparser.parse(feed_url)
                for entry in feed.entries[:20]:
                    title   = (entry.get('title') or '').strip()
                    link    = entry.get('link', '')
                    summary = entry.get('summary', '')
                    if not title or not link:
                        continue
                    # Check which personalities this article matches
                    for target in TARGETS:
                        if self._rss_matches(title + ' ' + summary, target['slug']):
                            art = self._make_article(
                                target, title, summary, summary,
                                source_name, link,
                                entry.get('published', datetime.now().isoformat())
                            )
                            if self._add(art):
                                total += 1
                                print(f'    ✓ {target["name_en"]}: {title[:55]}')
            except Exception as e:
                print(f'    RSS error: {e}')
        return total

    # ── Main scrape run ───────────────────────────────────────────
    def run(self, use_apis=True, use_rss=True):
        print('=' * 70)
        print('MAKEMYTHREAD SCRAPER v3.2')
        print('Sources: GNews API + PINews API + RSS')
        print('=' * 70)
        print(f'Started: {datetime.now()}')

        if use_apis:
            for target in TARGETS:
                print(f'\n── {target["name_en"]} ({target["name"]}) ──')
                self.fetch_gnews(target)
                time.sleep(0.5)
                self.fetch_newsdata(target)
                time.sleep(0.5)
                self.fetch_newsapi(target)
                time.sleep(0.5)
                self.fetch_serper(target)
                time.sleep(0.5)
                self.fetch_thenewsapi(target)
                time.sleep(0.5)
                self.fetch_pinews(target)
                time.sleep(1)

        if use_rss:
            print('\n── RSS Feeds ──')
            self.fetch_rss_all()

        print(f'\nTotal unique articles: {len(self.articles)}')

        # Summary by personality
        for target in TARGETS:
            count = sum(1 for a in self.articles if a['personality_slug'] == target['slug'])
            print(f'  {target["name_en"]}: {count}')

        return self.articles

    # ── Save CSV ──────────────────────────────────────────────────
    def save_csv(self):
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        if self.articles:
            f = os.path.join(self.output_dir, f'news_{ts}.csv')
            pd.DataFrame(self.articles).to_csv(f, index=False, encoding='utf-8-sig')
            print(f'✓ {f} ({len(self.articles)} rows)')
        # Personalities CSV
        pdf = pd.DataFrame([{
            'name': t['name'], 'name_en': t['name_en'],
            'slug': t['slug'], 'category': t['category'], 'bio': t['bio']
        } for t in TARGETS])
        pf = os.path.join(self.output_dir, f'personalities_{ts}.csv')
        pdf.to_csv(pf, index=False, encoding='utf-8-sig')
        print(f'✓ {pf}')

    # ── Push to API ───────────────────────────────────────────────
    def push_to_api(self):
        if not API_SECRET:
            print('✗ MMT_API_SECRET not set')
            print('  export MMT_API_SECRET=your_secret  (must match SCRAPER_SECRET in .env)')
            return False

        personalities = [{
            'name': t['name'], 'name_en': t['name_en'], 'slug': t['slug'],
            'category': t['category'], 'bio': t['bio'],
        } for t in TARGETS]

        payload = {'personalities': personalities, 'news': self.articles}
        headers = {
            'Content-Type': 'application/json',
            'x-scraper-secret': API_SECRET,
        }

        endpoint = f'{API_URL}/api/scraper/push'
        print(f'\nPushing to {endpoint}')
        print(f'  Personalities: {len(personalities)}')
        print(f'  Articles:      {len(self.articles)}')

        try:
            resp = requests.post(endpoint, json=payload, headers=headers, timeout=30)
            if resp.status_code == 200:
                r = resp.json()
                print(f'\n✓ Success!')
                print(f'  Inserted:    {r.get("news_inserted", "?")} articles')
                print(f'  Duplicates:  {r.get("news_skipped_duplicate", "?")} skipped')
                print(f'  No-match:    {r.get("news_skipped_no_personality", "?")} skipped')
                if r.get('errors'):
                    print(f'  Errors:')
                    for e in r['errors'][:5]: print(f'    - {e}')
                return True
            else:
                print(f'✗ HTTP {resp.status_code}: {resp.text[:200]}')
                return False
        except requests.ConnectionError:
            print(f'✗ Cannot connect to {API_URL}')
            print('  Is the server running? (npm start)')
            return False
        except Exception as e:
            print(f'✗ {e}')
            return False

    # ── Status check ──────────────────────────────────────────────
    def check_status(self):
        print(f'\nChecking {API_URL}/api/scraper/status ...')
        if not API_SECRET:
            print('✗ MMT_API_SECRET not set')
            return
        try:
            resp = requests.get(
                f'{API_URL}/api/scraper/status',
                headers={'x-scraper-secret': API_SECRET}, timeout=10
            )
            if resp.status_code == 200:
                d = resp.json()
                print(f'✓ Backend online')
                print(f'  Total news in DB: {d["total_news"]}')
                print(f'  Personalities ({len(d["personalities"])}) :')
                for p in d['personalities']:
                    match = '✓' if any(t['slug'] == p['slug'] for t in TARGETS) else '?'
                    print(f'    {match} {p["name"]} ({p.get("name_local","—")}) → /p/{p["slug"]}')

                # Check AI status
                ai_resp = requests.get(f'{API_URL}/api/ai/status', timeout=5)
                if ai_resp.status_code == 200:
                    ai = ai_resp.json()
                    print(f'\n  AI Providers:')
                    print(f'    Anthropic:  {"✓" if ai.get("anthropic")  else "✗ not configured"}')
                    print(f'    OpenRouter: {"✓" if ai.get("openrouter") else "✗ not configured"}')
                    print(f'    GNews:      {"✓" if ai.get("gnews")      else "✗ not configured"}')
                    print(f'    PINews:     {"✓" if ai.get("pinews")     else "✗ not configured"}')
            else:
                print(f'✗ {resp.status_code}: {resp.text[:100]}')
        except Exception as e:
            print(f'✗ {e}')


# ── CLI ────────────────────────────────────────────────────────────
if __name__ == '__main__':
    p = argparse.ArgumentParser(description='MakeMyThread Scraper v3.2')
    p.add_argument('--push',     action='store_true', help='Push to backend API')
    p.add_argument('--status',   action='store_true', help='Check backend status')
    p.add_argument('--csv',      action='store_true', help='Save CSV (also with --push)')
    p.add_argument('--api-only', action='store_true', help='Skip RSS, use news APIs only')
    p.add_argument('--rss-only', action='store_true', help='Skip news APIs, use RSS only')
    p.add_argument('--api-url',  default=None)
    p.add_argument('--secret',   default=None)
    p.add_argument('--from-api', action='store_true', help='Fetch personalities from MMT API instead of hardcoded list')
    args = p.parse_args()

    if args.api_url: API_URL    = args.api_url
    if args.secret:  API_SECRET = args.secret

    # Load personalities from API if --from-api flag is set
    if args.from_api:
        print('[MODE] Fetching personalities from backend API (--from-api)')
        load_targets_from_api()
    else:
        print('[MODE] Using hardcoded personality list (use --from-api to fetch from backend)')

    scraper = ScraperV32(output_dir='scraped_data')

    if args.status:
        scraper.check_status()
        sys.exit(0)

    use_apis = not args.rss_only
    use_rss  = not args.api_only
    scraper.run(use_apis=use_apis, use_rss=use_rss)

    if args.push:
        ok = scraper.push_to_api()
        if args.csv or not ok:
            scraper.save_csv()
    else:
        scraper.save_csv()

    print(f'\nDone at {datetime.now()}')
