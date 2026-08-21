const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const COOKIES_PATH = path.join(__dirname, 'cookies.txt');

// Returns ['--cookies', <path>] if a cookies file is present (see entrypoint.sh),
// otherwise an empty array. YouTube bot-checks datacenter IPs like Railway's
// aggressively, and cookies from a logged-in session are the main way around it.
function cookiesArgs() {
  return fs.existsSync(COOKIES_PATH) ? ['--cookies', COOKIES_PATH] : [];
}

// YouTube intermittently returns this error even for valid, playable videos —
// yt-dlp maintainers have confirmed it's transient and retrying the same
// command shortly after often succeeds. Detect it so we can auto-retry.
function isTransientReloadError(stderrText) {
  return stderrText.includes('The page needs to be reloaded');
}

// Node resolves extension-less executables like "yt-dlp" (yt-dlp.exe on Windows)
// correctly on its own via PATH — no shell needed, and shell:true would pass args
// unescaped (Node's own deprecation warning), which is a real injection risk here
// since args include a user-supplied URL.
function spawnYtDlp(args) {
  return spawn('yt-dlp', args);
}

// With cookies present, yt-dlp's automatic client selection leans toward the
// "web" client, which is the most PO-Token-gated one — this is what was hiding
// 2160p/4K formats even with formats=missing_pot. Explicitly requesting
// tv/visionos alongside the default merges in their format lists too, which is
// exactly what surfaced 4K successfully in earlier CLI testing without cookies.
const YOUTUBE_EXTRACTOR_ARGS = 'youtube:player_client=default,tv,visionos;formats=missing_pot';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
// Each option is a distinct choice offered to the user. WebM (VP9 video + Opus
// audio) generally compresses more efficiently than MP4's usual H.264/AAC pair,
// so it can look and sound noticeably better at the same file size — offered as
// an extra pick at the top tier rather than replacing MP4 everywhere, since MP4
// has broader compatibility.
const QUALITY_OPTIONS = [
  { id: '360p', label: '360p', height: 360, container: 'mp4' },
  { id: '480p', label: '480p', height: 480, container: 'mp4' },
  { id: '720p', label: '720p', height: 720, container: 'mp4' },
  { id: '1080p', label: '1080p', height: 1080, container: 'mp4' },
  { id: '1440p', label: '1440p', height: 1440, container: 'mp4' },
  { id: '2160p-mp4', label: '2160p (MP4)', height: 2160, container: 'mp4' },
  { id: '2160p-webm', label: '2160p (WebM - best quality)', height: 2160, container: 'webm' },
];

function findQualityOption(id) {
  return QUALITY_OPTIONS.find((o) => o.id === id);
}

function isValidYouTubeUrl(url) {
  return typeof url === 'string' && (url.includes('youtube.com') || url.includes('youtu.be'));
}

// Some videos (e.g. cinema-aspect-ratio trailers) are wider than standard 16:9,
// so their "2160p"/"1440p" streams report a raw pixel height below the actual
// tier (e.g. 3840x1920 labeled 2160p by YouTube, but f.height is only 1920).
// Deriving an equivalent height from width fixes quality detection for these.
function effectiveHeight(f) {
  const widthDerived = f.width ? Math.round((f.width * 9) / 16) : 0;
  return Math.max(f.height || 0, widthDerived);
}

// STEP A: given a URL, tell the frontend which qualities actually exist for this video
app.post('/formats', async (req, res) => {
  const { url } = req.body;
  if (!isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Valid YouTube URL required' });
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { output } = await fetchVideoInfo(url);
      const info = JSON.parse(output);

      // For each option, check whether a matching format actually exists in
      // its required container at that effective height — this is what keeps
      // "2160p (WebM)" from showing on a video that only has it in MP4, etc.
      const available = QUALITY_OPTIONS.filter((opt) =>
        info.formats.some(
          (f) => f.height && f.ext === opt.container && effectiveHeight(f) >= opt.height
        )
      ).map((opt) => ({ id: opt.id, label: opt.label }));

      return res.json({ title: info.title, qualities: available });
    } catch (err) {
      const isLastAttempt = attempt === maxAttempts;
      if (isTransientReloadError(err.stderr || '') && !isLastAttempt) {
        console.warn(`/formats: transient reload error, retrying (attempt ${attempt + 1}/${maxAttempts})...`);
        await sleep(1000 * attempt); // brief backoff before retrying
        continue;
      }
      console.error(err.stderr || err.message);
      return res.status(500).json({ error: 'Could not fetch video info', details: (err.stderr || err.message || '').slice(-500) });
    }
  }
});

// Runs `yt-dlp -j` for a URL and resolves with stdout, or rejects with { stderr }
function fetchVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const ytdlp = spawnYtDlp([
      '-j', '--no-warnings',
      '--extractor-args', YOUTUBE_EXTRACTOR_ARGS,
      ...cookiesArgs(),
      url,
    ]);
    let output = '';
    let errOutput = '';

    ytdlp.stdout.on('data', (d) => (output += d));
    ytdlp.stderr.on('data', (d) => (errOutput += d));

    ytdlp.on('error', (err) => reject({ stderr: `yt-dlp is not available on the server: ${err.message}` }));

    ytdlp.on('close', (code) => {
      if (code !== 0) {
        reject({ stderr: errOutput });
      } else {
        resolve({ output });
      }
    });
  });
}

// STEP B: download at the selected quality, with a fallback if the primary attempt fails
app.post('/download', (req, res) => {
  const { url, quality } = req.body;
  if (!isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Valid YouTube URL required' });
  }

  const option = findQualityOption(quality) || { height: 1080, container: 'mp4' }; // default if omitted/unknown
  const { height, container } = option;

  // Constrain both video and audio to the requested container so the merge
  // produces a genuine MP4 (H.264/AAC) or genuine WebM (VP9/Opus) — without
  // this, yt-dlp could mix codecs and just remux into whichever container we
  // ask ffmpeg for, losing the actual quality benefit of picking WebM.
  const formatSelector =
    container === 'webm'
      ? `bv*[ext=webm][height<=${height}]+ba[ext=webm]/b[ext=webm][height<=${height}]`
      : `bv*[ext=mp4][height<=${height}]+ba[ext=m4a]/b[ext=mp4][height<=${height}]`;

  attemptDownload(formatSelector, url, res, /* isFallback */ false, 0, container);
});

function attemptDownload(formatSelector, url, res, isFallback, retryCount = 0, container = 'mp4') {
  // yt-dlp/ffmpeg can only MERGE separate video+audio streams when writing to a real
  // file on disk — merging directly into a stdout pipe isn't supported and silently
  // produces a broken/audio-only result. So we download+merge into a temp folder,
  // then stream the finished file to the browser and delete it right after.
  const jobId = crypto.randomUUID();
  const tempDir = path.join(os.tmpdir(), `ytdl-${jobId}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const outputTemplate = path.join(tempDir, 'video.%(ext)s');

  const args = [
    '-f', formatSelector,
    '-o', outputTemplate,
    '--merge-output-format', container,
    '--no-warnings',
    '--extractor-args', YOUTUBE_EXTRACTOR_ARGS,
    ...cookiesArgs(),
    url,
  ];

  const ytdlp = spawnYtDlp(args);
  let stderrBuffer = '';

  ytdlp.on('error', (err) => {
    console.error('Failed to launch yt-dlp:', err);
    cleanupTempDir(tempDir);
    if (!res.headersSent) {
      res.status(500).json({ error: 'yt-dlp is not available on the server', details: err.message });
    }
  });

  ytdlp.stderr.on('data', (d) => {
    stderrBuffer += d.toString();
    console.log(d.toString());
  });

  ytdlp.on('close', async (code) => {
    const files = fs.existsSync(tempDir) ? fs.readdirSync(tempDir) : [];
    const finishedFile = files.find((f) => f.startsWith('video.'));

    if (code === 0 && finishedFile) {
      const filePath = path.join(tempDir, finishedFile);
      const ext = path.extname(finishedFile);
      res.setHeader('Content-Disposition', `attachment; filename="video${ext}"`);
      res.setHeader('Content-Type', container === 'webm' ? 'video/webm' : 'video/mp4');

      const readStream = fs.createReadStream(filePath);
      readStream.pipe(res);
      readStream.on('close', () => cleanupTempDir(tempDir));
      readStream.on('error', () => cleanupTempDir(tempDir));
      return;
    }

    cleanupTempDir(tempDir);

    // Transient "page needs to be reloaded" errors usually succeed on retry —
    // try the same quality up to 2 more times before dropping to the fallback.
    const maxRetries = 2;
    if (isTransientReloadError(stderrBuffer) && retryCount < maxRetries && !res.headersSent) {
      console.warn(`Transient reload error, retrying same quality (attempt ${retryCount + 2}/${maxRetries + 1})...`);
      await sleep(1000 * (retryCount + 1));
      return attemptDownload(formatSelector, url, res, isFallback, retryCount + 1, container);
    }

    // If it failed before sending any data, and this wasn't already the fallback attempt,
    // retry once with the android client at a safe low quality (itag 18, 360p)
    if (!res.headersSent && !isFallback) {
      console.warn('Primary download failed, retrying with android client fallback...');
      attemptDownloadFallback(url, res);
    } else if (!res.headersSent) {
      res.status(500).json({ error: 'Download failed', details: stderrBuffer.slice(-300) });
    }
  });
}

function attemptDownloadFallback(url, res) {
  // itag 18 (360p) is a single progressive stream — video+audio already combined,
  // no merge needed, so it's safe to pipe straight to stdout.
  const args = [
    '-f', 'best[height<=360]',
    '--extractor-args', 'youtube:player_client=android',
    ...cookiesArgs(),
    '-o', '-',
    url,
  ];

  res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
  res.setHeader('Content-Type', 'video/mp4');

  const fallback = spawnYtDlp(args);
  fallback.stdout.pipe(res);
  fallback.on('close', (fCode) => {
    if (fCode !== 0 && !res.headersSent) {
      res.status(500).json({ error: 'Download failed after retry' });
    }
  });
}

function cleanupTempDir(tempDir) {
  fs.rm(tempDir, { recursive: true, force: true }, (err) => {
    if (err) console.error('Failed to clean up temp dir:', err);
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));