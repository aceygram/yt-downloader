# YouTube Downloader

## Structure
- `backend/` — Express server that runs yt-dlp + ffmpeg, streams the video to the browser (no disk storage). Deploy to Railway.
- `frontend/` — Next.js app: URL input, quality dropdown, download button. Deploy to Vercel.

## Local setup

### Backend
Requires: Node.js 18+, Python 3 + pip, ffmpeg installed on your machine (or just test via Docker).
```
cd backend
npm install
npm install -g yt-dlp   # or: python -m pip install -U yt-dlp
npm start
```
Server runs on http://localhost:3000

Or with Docker (matches what Railway will run):
```
cd backend
docker build -t yt-downloader-backend .
docker run -p 3000:3000 yt-downloader-backend
```

### Frontend
Requires: Node.js 18+
```
cd frontend
npm install
cp .env.local.example .env.local
# edit .env.local -> point NEXT_PUBLIC_BACKEND_URL at your local backend (http://localhost:3000) or deployed Railway URL
npm run dev
```
Opens on http://localhost:3000 by default — if the backend is also on 3000 locally, run the frontend with `npm run dev -- -p 3001` and update `NEXT_PUBLIC_BACKEND_URL` accordingly.

The frontend follows the "yt4kSave" design (Tailwind + Hanken Grotesk/Geist/Inter + Material Symbols icons), with two pages:
- `/` — Download page: paste a link, see a thumbnail/title/channel preview, pick quality/container, download.
- `/history` — History page: recently downloaded videos, stored in the browser's `localStorage` (the backend deletes each file right after streaming it, so there's nothing server-side to list — history is per-browser, not shared across family members' devices).

## Deploying

### Backend -> Railway
1. Push the `backend/` folder to its own GitHub repo (or the repo root, pointing Railway's root directory setting at `backend/`).
2. Railway -> New Project -> Deploy from GitHub repo. It auto-detects the Dockerfile.
3. Copy the generated public URL (e.g. `https://your-app.up.railway.app`).

### Frontend -> Vercel
1. Push `frontend/` to GitHub.
2. Vercel -> New Project -> import the repo.
3. In Project Settings -> Environment Variables, add `NEXT_PUBLIC_BACKEND_URL` set to your Railway URL.
4. Deploy.

## Notes
- The backend re-checks for a yt-dlp update every time the container boots (see `entrypoint.sh`) — YouTube changes its streaming behavior often, and a stale yt-dlp is the most common cause of download failures (403 / SABR errors).
- Quality options shown in the dropdown are pulled live per-video from `/formats`, so a video that was never uploaded in 4K won't offer a fake 2160p option.
- If the requested quality fails, the backend automatically retries once at 360p via the Android client as a fallback, so users get a working file instead of a dead error.
- Any quality above 360p requires yt-dlp/ffmpeg to merge separate video+audio streams, which only works when writing to a real file — so the backend downloads to a short-lived temp file per request, streams it to the browser, then deletes it immediately. This means brief per-request disk usage on Railway (proportional to the video size), not permanent storage.
- YouTube's highest-quality formats (often 2160p/4K) sometimes require a "PO Token" the client doesn't have, and yt-dlp silently drops those formats rather than showing them as broken. The backend passes `--extractor-args "youtube:formats=missing_pot"` to reveal them anyway — the underlying download usually still works, but if YouTube tightens enforcement further, the fallback (360p via Android client) still kicks in so users aren't left with a dead error. For a more robust long-term fix, look into running an actual PO Token provider (e.g. `bgutil-ytdlp-pot-provider`) as a background service alongside the backend — see https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide.
- **"Sign in to confirm you're not a bot" errors:** YouTube aggressively bot-checks requests from datacenter IPs (Railway, AWS, etc.) — this often doesn't happen on your home PC but does happen on a hosted server. The fix is supplying cookies from a real logged-in YouTube session:
  1. In Chrome, log into YouTube with a **secondary/throwaway Google account** (not your main one — see caution below), install the "Get cookies.txt LOCALLY" extension, and export cookies for youtube.com as `cookies.txt`.
  2. Base64-encode it and set it as a Railway environment variable named `YTDLP_COOKIES_B64` (don't commit the raw file to GitHub — it's a live login session):
     ```powershell
     [Convert]::ToBase64String([IO.File]::ReadAllBytes("cookies.txt")) | Set-Clipboard
     ```
     Paste the clipboard contents as the value of `YTDLP_COOKIES_B64` in Railway's Variables tab.
  3. `entrypoint.sh` decodes it back into `backend/cookies.txt` on every boot, and `server.js` automatically passes `--cookies` to yt-dlp whenever that file exists.
  4. **Use a throwaway account, not your personal one** — yt-dlp's own docs note that using an account this way risks it getting temporarily or permanently banned by YouTube, and cookies do eventually expire and need re-exporting.
- **"The page needs to be reloaded" errors:** this is a known, intermittent YouTube/yt-dlp quirk (confirmed by yt-dlp maintainers) — the same request often succeeds on a quick retry. The backend now automatically retries the same request up to 2 extra times (with a short backoff) before giving up or falling back to a lower quality, so this should mostly resolve itself without the user seeing an error.
- Keep this tool private/invite-only for friends and family rather than a public URL — downloading YouTube content outside their own tools sits in a legal gray area under YouTube's Terms of Service.
