#!/bin/bash
cd /home/panthi/.openclaw/workspace/makemythread_v3
export MMT_API_URL=http://localhost:3000
export MMT_API_SECRET=mmt_scraper_secret_2026
python3 final_scraper_v3.py --push --api-only
