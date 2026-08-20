#!/bin/sh
echo "Checking for yt-dlp updates..."
pip3 install --break-system-packages -U yt-dlp
echo "yt-dlp version: $(yt-dlp --version)"
npm start
