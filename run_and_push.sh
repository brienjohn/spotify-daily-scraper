#!/bin/bash
set -e
cd "$(dirname "$0")"

TODAY=$(date +%Y-%m-%d)
SONGS_FILE="data/spotify_daily_songs_${TODAY}.csv"

if [ -f "$SONGS_FILE" ]; then
  echo "$(date): 今天的資料已經抓過了，跳過。"
  exit 0
fi

if ! curl -s --max-time 10 -o /dev/null -w "%{http_code}" https://charts.spotify.com | grep -qE "200|30[0-9]"; then
  echo "$(date): 目前連不上網路，等下一個排定時段再試。"
  exit 0
fi

node scrape_spotify_charts.js

git add data/
if ! git diff --staged --quiet; then
  git commit -m "Add Spotify chart snapshot ${TODAY}"
  git push
fi
