#!/bin/bash
cd /home/panthi/.openclaw/workspace/makemythread_v3
node server.js >> /tmp/mmt_server.log 2>&1 &
echo "Server PID: $!"
sleep 3
curl -s http://localhost:3000/api/scraper/status -H "x-scraper-secret: mmt_scraper_secret_2026"
