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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const QUALITY_HEIGHTS = {
  '360p': 360,
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
  '1440p': 1440,
  '2160p': 2160, // 4K
};

function isValidYouTubeUrl(url) {
  return typeof url === 'string' && (url.includes('youtube.com') || url.includes('youtu.be'));
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
      const heights = new Set(
        info.formats
          .filter((f) => f.height) // only entries that report a resolution
          .map((f) => f.height)
      );

      // Only offer qualities that actually exist for this video
      const available = Object.entries(QUALITY_HEIGHTS)
        .filter(([, h]) => [...heights].some((videoH) => videoH >= h))
        .map(([label]) => label);

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
    const ytdlp = spawn('yt-dlp', [
      '-j', '--no-warnings',
      '--extractor-args', 'youtube:formats=missing_pot',
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

  const height = QUALITY_HEIGHTS[quality] || 1080; // default to 1080p if omitted
  const formatSelector = `bv*[height<=${height}]+ba/b[height<=${height}]`;

  attemptDownload(formatSelector, url, res, /* isFallback */ false);
});

function attemptDownload(formatSelector, url, res, isFallback, retryCount = 0) {
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
    '--merge-output-format', 'mp4',
    '--no-warnings',
    '--extractor-args', 'youtube:formats=missing_pot',
    ...cookiesArgs(),
    url,
  ];

  const ytdlp = spawn('yt-dlp', args);
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
      res.setHeader('Content-Disposition', `attachment; filename="video${path.extname(finishedFile)}"`);
      res.setHeader('Content-Type', 'video/mp4');

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
      return attemptDownload(formatSelector, url, res, isFallback, retryCount + 1);
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

  const fallback = spawn('yt-dlp', args);
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
