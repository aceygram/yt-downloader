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
python -m pip install -U yt-dlp
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
- Keep this tool private/invite-only for friends and family rather than a public URL — downloading YouTube content outside their own tools sits in a legal gray area under YouTube's Terms of Service.
