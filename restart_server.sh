#!/bin/bash
cd /home/panthi/.openclaw/workspace/makemythread_v3
pkill -f "node server.js" 2>/dev/null || true
sleep 1
node server.js >> /tmp/mmt_server.log 2>&1 &
echo "Server restarted, PID: $!"
