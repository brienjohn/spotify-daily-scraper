#!/bin/bash
set -e
cd "$(dirname "$0")"

if ! curl -s --max-time 10 -o /dev/null -w "%{http_code}" https://charts.spotify.com | grep -qE "200|30[0-9]"; then
  echo "$(date): 目前連不上網路，等下一個排定時段再試。"
  exit 0
fi

/usr/local/bin/node scrape_spotify_charts.js

git add data/
if ! git diff --staged --quiet; then
  git commit -m "Add/backfill Spotify chart snapshot $(date +%Y-%m-%d)"
  git push
fi
