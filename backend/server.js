const express = require('express');
const cors = require('cors');
const { spawn, exec } = require('child_process');
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
  // detached:true (POSIX only) puts yt-dlp in its own process group, so cancelling
  // can kill it AND any ffmpeg process it spawned internally, not just yt-dlp itself.
  const options = process.platform === 'win32' ? {} : { detached: true };
  return spawn('yt-dlp', args, options);
}

// Kills a yt-dlp job's whole process tree (it may have spawned ffmpeg as a child),
// not just the top-level process — otherwise a cancelled job could leave ffmpeg
// running in the background, still eating CPU/bandwidth.
function killProcessTree(child) {
  if (!child || child.killed || !child.pid) return;
  if (process.platform === 'win32') {
    exec(`taskkill /PID ${child.pid} /T /F`, (err) => {
      if (err) console.error('Failed to kill process tree (Windows):', err.message);
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM'); // negative pid = whole process group
    } catch (err) {
      console.error('Failed to kill process group, falling back to single process:', err.message);
      try {
        child.kill('SIGTERM');
      } catch {
        // process may have already exited
      }
    }
  }
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
  { id: '360p', label: 'MP4 - 360p', height: 360, container: 'mp4' },
  { id: '480p', label: 'MP4 - 480p', height: 480, container: 'mp4' },
  { id: '720p', label: 'MP4 - 720p', height: 720, container: 'mp4' },
  { id: '1080p', label: 'MP4 - 1080p (HD)', height: 1080, container: 'mp4' },
  { id: '1440p', label: 'MP4 - 1440p (QHD)', height: 1440, container: 'mp4' },
  { id: '2160p-mp4', label: 'MP4 - 2160p (4K)', height: 2160, container: 'mp4' },
  { id: '2160p-webm', label: 'WebM - 2160p (4K, best quality)', height: 2160, container: 'webm' },
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

// Estimates total download size (video + audio combined) for a quality option,
// using yt-dlp's own reported filesize (exact) or filesize_approx (estimated).
// Returns null if either component's size is unknown — better to show nothing
// than a misleadingly partial number.
function estimateSizeBytes(formats, opt) {
  const sizeOf = (f) => f.filesize || f.filesize_approx || null;

  // Video: the best match at/under this tier's height, in the required container —
  // mirrors the same [ext=X][height<=H] logic the actual download selector uses.
  const videoCandidates = formats.filter(
    (f) => f.vcodec && f.vcodec !== 'none' && f.ext === opt.container && effectiveHeight(f) <= opt.height
  );
  const videoFormat = videoCandidates.sort((a, b) => effectiveHeight(b) - effectiveHeight(a))[0];

  // Audio: matches the extension the download selector actually requests
  // (m4a alongside mp4, webm alongside webm)
  const audioExt = opt.container === 'webm' ? 'webm' : 'm4a';
  const audioCandidates = formats.filter(
    (f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none') && f.ext === audioExt
  );
  const audioFormat = audioCandidates.sort((a, b) => (sizeOf(b) || 0) - (sizeOf(a) || 0))[0];

  const videoSize = videoFormat ? sizeOf(videoFormat) : null;
  const audioSize = audioFormat ? sizeOf(audioFormat) : null;
  if (videoSize == null || audioSize == null) return null;
  return videoSize + audioSize;
}

// Formats a duration in seconds as "m:ss" or "h:mm:ss" for display in the UI
function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// Strips characters that are invalid or risky in filenames across OSes, and
// caps length, so a video's real title can be used as the download's filename
// instead of a generic "video.mp4".
function sanitizeFilename(name) {
  if (!name) return 'video';
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '').trim();
  return cleaned.slice(0, 150) || 'video';
}

// In-memory download job store. Each job tracks real progress (parsed from
// yt-dlp's own output) so the frontend can show a live progress bar instead of
// relying on the browser's download manager, which only shows anything once
// the full merge is already done and bytes actually start flowing.
const jobs = new Map();

function createJob() {
  const id = crypto.randomUUID();
  const job = {
    id,
    status: 'starting', // starting | downloading | merging | retrying | done | error
    percent: 0,
    message: 'Starting…',
    container: 'mp4',
    filenameBase: 'video',
    filePath: null,
    tempDir: null,
    error: null,
    createdAt: Date.now(),
    completedAt: null, // set once status becomes done or error
    cancelled: false,
    process: null, // the current yt-dlp child process, so it can be killed on cancel
  };
  jobs.set(id, job);
  return job;
}

function updateJob(job, patch) {
  Object.assign(job, patch);
  if ((patch.status === 'done' || patch.status === 'error') && !job.completedAt) {
    job.completedAt = Date.now();
  }
}

// Sweep abandoned jobs so temp files and memory don't accumulate indefinitely.
// Finished jobs get a generous window (closing the tab and coming back later to
// grab the file is a supported flow) — timed from completion, not job start, so
// a long video that took a while to process doesn't get swept moments after
// finishing. Jobs that never finish (crashed process, etc.) get a separate,
// longer safety-net cutoff timed from when they started.
const COMPLETED_RETENTION_MS = 60 * 60 * 1000; // 1 hour after finishing
const MAX_PROCESSING_MS = 3 * 60 * 60 * 1000; // 3 hours — should never normally take this long
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const isFinished = job.status === 'done' || job.status === 'error';
    const shouldSweep = isFinished
      ? job.completedAt && now - job.completedAt > COMPLETED_RETENTION_MS
      : now - job.createdAt > MAX_PROCESSING_MS;
    if (shouldSweep) {
      if (job.tempDir) cleanupTempDir(job.tempDir);
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

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
      ).map((opt) => ({ id: opt.id, label: opt.label, sizeBytes: estimateSizeBytes(info.formats, opt) }));

      return res.json({
        title: info.title,
        thumbnail: info.thumbnail,
        channel: info.uploader || info.channel || '',
        duration: formatDuration(info.duration),
        qualities: available,
      });
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

// STEP B1: kick off a download job and return its id immediately. The actual
// yt-dlp work happens in the background — the client tracks it via SSE.
app.post('/download/start', (req, res) => {
  const { url, quality, title } = req.body;
  if (!isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Valid YouTube URL required' });
  }

  const option = findQualityOption(quality) || { height: 1080, container: 'mp4' };
  const { height, container } = option;
  const filenameBase = sanitizeFilename(title);

  const formatSelector =
    container === 'webm'
      ? `bv*[ext=webm][height<=${height}]+ba[ext=webm]/b[ext=webm][height<=${height}]`
      : `bv*[ext=mp4][height<=${height}]+ba[ext=m4a]/b[ext=mp4][height<=${height}]`;

  const job = createJob();
  updateJob(job, { container, filenameBase });
  res.json({ jobId: job.id });

  runDownloadJob(job, formatSelector, url, container, false, 0);
});

// STEP B2: live progress via Server-Sent Events — the frontend's actual progress bar
app.get('/download/progress/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = () => {
    res.write(`data: ${JSON.stringify({
      status: job.status,
      percent: job.percent,
      message: job.message,
      error: job.error,
      sizeBytes: job.sizeBytes || null,
    })}\n\n`);
  };

  send();
  const interval = setInterval(() => {
    send();
    if (job.status === 'done' || job.status === 'error') {
      clearInterval(interval);
      res.end();
    }
  }, 400);

  req.on('close', () => clearInterval(interval));
});

// STEP B3: once a job is done, this serves the actual finished file — fast,
// since the merge already happened; the browser handles this as a normal
// streamed download.
app.get('/download/file/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'done' || !job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(404).json({ error: 'File not ready or job not found' });
  }

  const ext = path.extname(job.filePath);
  res.setHeader('Content-Disposition', `attachment; filename="${job.filenameBase}${ext}"`);
  res.setHeader('Content-Type', job.container === 'webm' ? 'video/webm' : 'video/mp4');

  const readStream = fs.createReadStream(job.filePath);
  readStream.pipe(res);
  const cleanup = () => {
    cleanupTempDir(job.tempDir);
    jobs.delete(job.id);
  };
  readStream.on('close', cleanup);
  readStream.on('error', cleanup);
});

// STEP B4: cancel an in-progress job — kills the actual yt-dlp/ffmpeg process,
// not just the frontend's tracking of it, so cancelling really stops the work.
app.delete('/download/job/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  job.cancelled = true;
  if (job.process) killProcessTree(job.process);
  if (job.tempDir) cleanupTempDir(job.tempDir);
  updateJob(job, { status: 'error', error: 'Cancelled' });
  jobs.delete(job.id);

  res.json({ cancelled: true });
});

// Parses yt-dlp's own progress lines to drive the job's percent/message.
// yt-dlp reports each stream's download separately (e.g. video then audio),
// so we split the overall bar into rough phases rather than trying to get a
// byte-perfect combined percentage — good enough for a progress indicator.
function trackProgress(job, line, requiresMerge) {
  if (/\[download\]\s+Destination:/.test(line)) {
    job._destinationCount = (job._destinationCount || 0) + 1;
    if (requiresMerge && job._destinationCount === 2) {
      updateJob(job, { status: 'downloading', message: 'Downloading audio…' });
    } else {
      updateJob(job, { status: 'downloading', message: 'Downloading video…' });
    }
    return;
  }

  const match = line.match(/\[download\]\s+([\d.]+)%/);
  if (match) {
    const pct = parseFloat(match[1]);
    if (!requiresMerge) {
      updateJob(job, { percent: Math.min(99, pct) });
    } else if ((job._destinationCount || 1) <= 1) {
      updateJob(job, { percent: Math.min(70, pct * 0.7) });
    } else {
      updateJob(job, { percent: 70 + Math.min(25, pct * 0.25) });
    }
    return;
  }

  if (/\[Merger\]/.test(line)) {
    updateJob(job, { status: 'merging', message: 'Merging video and audio…', percent: 97 });
  }
}

function runDownloadJob(job, formatSelector, url, container, isFallback, retryCount) {
  const tempDir = path.join(os.tmpdir(), `ytdl-${job.id}`);
  fs.mkdirSync(tempDir, { recursive: true });
  updateJob(job, { tempDir });
  const outputTemplate = path.join(tempDir, 'video.%(ext)s');
  const requiresMerge = formatSelector.includes('+');

  const args = [
    '-f', formatSelector,
    '-o', outputTemplate,
    '--merge-output-format', container,
    '--no-warnings',
    '--newline', // one progress line per update instead of \r overwrites — needed to parse it
    '--extractor-args', YOUTUBE_EXTRACTOR_ARGS,
    ...cookiesArgs(),
    url,
  ];

  const ytdlp = spawnYtDlp(args);
  updateJob(job, { process: ytdlp });
  let stderrBuffer = '';
  let stdoutTail = '';

  ytdlp.on('error', (err) => {
    console.error('Failed to launch yt-dlp:', err);
    cleanupTempDir(tempDir);
    updateJob(job, { status: 'error', error: 'yt-dlp is not available on the server' });
  });

  ytdlp.stdout.on('data', (d) => {
    stdoutTail += d.toString();
    const lines = stdoutTail.split('\n');
    stdoutTail = lines.pop(); // keep any incomplete trailing line for next chunk
    lines.forEach((line) => trackProgress(job, line, requiresMerge));
  });

  ytdlp.stderr.on('data', (d) => {
    stderrBuffer += d.toString();
    console.log(d.toString());
  });

  ytdlp.on('close', async (code) => {
    if (job.cancelled) return; // already handled by the cancel endpoint

    const files = fs.existsSync(tempDir) ? fs.readdirSync(tempDir) : [];
    const finishedFile = files.find((f) => f.startsWith('video.'));

    if (code === 0 && finishedFile) {
      const filePath = path.join(tempDir, finishedFile);
      let sizeBytes = null;
      try {
        sizeBytes = fs.statSync(filePath).size;
      } catch {
        // non-fatal — history just won't show a size for this one
      }
      updateJob(job, {
        status: 'done',
        percent: 100,
        message: 'Done',
        filePath,
        sizeBytes,
      });
      return;
    }

    cleanupTempDir(tempDir);

    const maxRetries = 2;
    if (isTransientReloadError(stderrBuffer) && retryCount < maxRetries) {
      console.warn(`Transient reload error, retrying same quality (attempt ${retryCount + 2}/${maxRetries + 1})...`);
      updateJob(job, { status: 'retrying', message: 'Retrying…', percent: 0, _destinationCount: 0 });
      await sleep(1000 * (retryCount + 1));
      if (job.cancelled) return;
      return runDownloadJob(job, formatSelector, url, container, isFallback, retryCount + 1);
    }

    if (!isFallback) {
      console.warn('Primary download failed, retrying with android client fallback...');
      updateJob(job, { status: 'retrying', message: 'Falling back to a lower quality…', percent: 0, _destinationCount: 0 });
      return runDownloadJobFallback(job, url);
    }

    updateJob(job, { status: 'error', error: stderrBuffer.slice(-300) || 'Download failed' });
  });
}

function runDownloadJobFallback(job, url) {
  // itag 18 (360p) is a single progressive stream — video+audio already combined,
  // no merge needed, so it downloads straight to a file just like the main path.
  const tempDir = path.join(os.tmpdir(), `ytdl-${job.id}-fb`);
  fs.mkdirSync(tempDir, { recursive: true });
  updateJob(job, { tempDir, container: 'mp4' });
  const outputTemplate = path.join(tempDir, 'video.%(ext)s');

  const args = [
    '-f', 'best[height<=360]',
    '-o', outputTemplate,
    '--no-warnings',
    '--newline',
    '--extractor-args', 'youtube:player_client=android',
    ...cookiesArgs(),
    url,
  ];

  const ytdlp = spawnYtDlp(args);
  updateJob(job, { process: ytdlp });
  let stdoutTail = '';

  ytdlp.stdout.on('data', (d) => {
    stdoutTail += d.toString();
    const lines = stdoutTail.split('\n');
    stdoutTail = lines.pop();
    lines.forEach((line) => trackProgress(job, line, false));
  });

  ytdlp.on('close', (code) => {
    if (job.cancelled) return; // already handled by the cancel endpoint

    const files = fs.existsSync(tempDir) ? fs.readdirSync(tempDir) : [];
    const finishedFile = files.find((f) => f.startsWith('video.'));

    if (code === 0 && finishedFile) {
      const filePath = path.join(tempDir, finishedFile);
      let sizeBytes = null;
      try {
        sizeBytes = fs.statSync(filePath).size;
      } catch {
        // non-fatal — history just won't show a size for this one
      }
      updateJob(job, {
        status: 'done',
        percent: 100,
        message: 'Done',
        filePath,
        sizeBytes,
      });
    } else {
      cleanupTempDir(tempDir);
      updateJob(job, { status: 'error', error: 'Download failed after retry' });
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