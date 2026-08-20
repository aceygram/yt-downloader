#!/bin/sh
echo "Checking for yt-dlp updates..."
pip3 install --break-system-packages -U yt-dlp

# If a base64-encoded cookies file was provided via env var, decode it to disk.
# YouTube aggressively bot-checks datacenter IPs (like Railway's) without cookies.
if [ -n "$YTDLP_COOKIES_B64" ]; then
  echo "$YTDLP_COOKIES_B64" | base64 -d > /app/cookies.txt
  echo "Loaded cookies.txt from YTDLP_COOKIES_B64"
else
  echo "No YTDLP_COOKIES_B64 set — running without cookies (may hit bot-check errors)"
fi

echo "yt-dlp version: $(yt-dlp --version)"
npm start
