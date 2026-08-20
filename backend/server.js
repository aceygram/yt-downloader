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

// Maps a friendly quality label to a max-height for the format selector
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
app.post('/formats', (req, res) => {
  const { url } = req.body;
  if (!isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Valid YouTube URL required' });
  }

  const ytdlp = spawn('yt-dlp', ['-j', '--no-warnings', url]);
  let output = '';
  let errOutput = '';

  ytdlp.stdout.on('data', (d) => (output += d));
  ytdlp.stderr.on('data', (d) => (errOutput += d));

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      console.error(errOutput);
      return res.status(500).json({ error: 'Could not fetch video info' });
    }
    try {
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

      res.json({ title: info.title, qualities: available });
    } catch (e) {
      res.status(500).json({ error: 'Failed to parse video info' });
    }
  });
});

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

function attemptDownload(formatSelector, url, res, isFallback) {
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
    url,
  ];

  const ytdlp = spawn('yt-dlp', args);
  let stderrBuffer = '';

  ytdlp.stderr.on('data', (d) => {
    stderrBuffer += d.toString();
    console.log(d.toString());
  });

  ytdlp.on('close', (code) => {
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
