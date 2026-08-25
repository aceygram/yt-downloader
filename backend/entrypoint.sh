#!/bin/sh
echo "Checking for yt-dlp updates..."
pip3 install --break-system-packages -U yt-dlp

# If a base64-encoded cookies file was provided via env var, decode it to disk.
# YouTube aggressively bot-checks datacenter IPs (like Railway's) without cookies.
if [ -n "$YTDLP_COOKIES_B64" ]; then
  echo "$YTDLP_COOKIES_B64" | base64 -d > /app/cookies.txt
  LINES=$(wc -l < /app/cookies.txt 2>/dev/null | tr -d ' ')
  BYTES=$(wc -c < /app/cookies.txt 2>/dev/null | tr -d ' ')
  echo "Loaded cookies.txt from YTDLP_COOKIES_B64 ($LINES lines, $BYTES bytes)"
  echo "First line: $(head -n 1 /app/cookies.txt)"
  # A real Netscape-format cookies file for youtube.com is normally tens of
  # lines / several KB. If this looks tiny, the paste into Railway almost
  # certainly got truncated or corrupted — re-export and re-paste it.
  if [ "$BYTES" -lt 500 ]; then
    echo "WARNING: cookies.txt looks suspiciously small — it was likely truncated or corrupted during paste into Railway's Variables tab. Try the Raw Editor instead of the plain text field, or re-export fresh cookies."
  fi
else
  echo "No YTDLP_COOKIES_B64 set — running without cookies (may hit bot-check errors)"
fi

echo "yt-dlp version: $(yt-dlp --version)"
npm start