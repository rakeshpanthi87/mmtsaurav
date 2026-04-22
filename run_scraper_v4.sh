#!/bin/bash
cd /home/panthi/.openclaw/workspace/makemythread_v3
export MMT_API_URL=http://localhost:3000
export MMT_API_SECRET=mmt_scraper_secret_2026
export GNEWS_API_KEY=243261f5ab25fecc02d80e82d3859d20
export PINEWS_API_KEY=6b5856851f6e40ada902001dfc069158
python3 scraper_v4.py --push --csv