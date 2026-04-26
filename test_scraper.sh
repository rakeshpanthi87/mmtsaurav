#!/bin/bash
source /home/panthi/.openclaw/workspace/makemythread_v3/.env
export MMT_API_SECRET="$SCRAPER_SECRET"
export MMT_API_URL="http://localhost:3000"
cd /home/panthi/.openclaw/workspace/makemythread_v3
echo "=== Testing --from-api (no push, just verifying API fetch) ==="
python3 final_scraper_v3.py --status 2>&1