'use client';

import { useState } from 'react';
import Header from '../components/Header';
import { addHistoryEntry } from '../lib/history';

// Maps a quality id to the short badge shown on the video preview thumbnail
const BADGE_BY_ID = {
  '2160p-webm': '4K',
  '2160p-mp4': '4K',
  '1440p': '1440p',
  '1080p': 'HD',
  '720p': '720p',
  '480p': '480p',
  '360p': '360p',
};

export default function Home() {
  const [url, setUrl] = useState('');
  const [qualities, setQualities] = useState([]);
  const [selectedQuality, setSelectedQuality] = useState('');
  const [videoInfo, setVideoInfo] = useState(null); // { title, thumbnail, channel, duration }
  const [status, setStatus] = useState('idle'); // idle | checking | loading | error | done
  const [errorMsg, setErrorMsg] = useState('');

  const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');

  const checkFormats = async (pastedUrl) => {
    const targetUrl = (pastedUrl ?? url).trim();
    if (!targetUrl) return;
    setStatus('checking');
    setErrorMsg('');
    setQualities([]);
    setVideoInfo(null);

    try {
      const res = await fetch(`${backendUrl}/formats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not fetch video info');
      }

      const data = await res.json();
      setQualities(data.qualities || []);
      setVideoInfo({
        title: data.title || '',
        thumbnail: data.thumbnail || '',
        channel: data.channel || '',
        duration: data.duration || '',
      });
      setSelectedQuality(data.qualities?.[data.qualities.length - 1]?.id || '');
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text);
        checkFormats(text);
      }
    } catch {
      // Clipboard permission denied or unavailable — user can still paste manually
    }
  };

  const handleDownload = async () => {
    if (!url.trim() || !selectedQuality) return;

    setStatus('loading');
    setErrorMsg('');

    try {
      const res = await fetch(`${backendUrl}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, quality: selectedQuality }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Download failed');
      }

      const blob = await res.blob();
      const ext = blob.type === 'video/webm' ? 'webm' : 'mp4';
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${videoInfo?.title || 'video'}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      const qualityOption = qualities.find((q) => q.id === selectedQuality);
      addHistoryEntry({
        url,
        title: videoInfo?.title || 'video',
        thumbnail: videoInfo?.thumbnail || '',
        channel: videoInfo?.channel || '',
        duration: videoInfo?.duration || '',
        qualityId: selectedQuality,
        qualityLabel: qualityOption?.label || selectedQuality,
        badge: BADGE_BY_ID[selectedQuality] || '',
        container: ext,
        sizeBytes: blob.size,
      });

      setStatus('done');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message);
    }
  };

  const topBadge = qualities.length > 0 ? BADGE_BY_ID[qualities[qualities.length - 1].id] : '';

  return (
    <>
      <Header />
      <main className="flex-grow flex flex-col items-center p-margin-mobile md:p-stack-lg pb-24 md:pb-stack-lg">
        <div className="w-full max-w-container-max flex flex-col gap-stack-lg">
          {/* Hero / Input Section */}
          <section className="flex flex-col gap-stack-md text-center py-8">
            <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-primary">
              Download YouTube Videos in 4K
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl mx-auto">
              Paste your link below to get started.
            </p>
            <div className="flex flex-col gap-stack-sm relative w-full max-w-2xl mx-auto">
              <input
                className="w-full h-16 pl-6 pr-14 text-lg rounded-2xl border-2 border-outline-variant bg-surface-container-lowest text-on-surface focus:outline-none focus:border-secondary focus:ring-4 focus:ring-secondary-fixed-dim transition-all shadow-sm"
                placeholder="https://www.youtube.com/watch?v=..."
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={() => checkFormats()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') checkFormats();
                }}
              />
              <button
                onClick={handlePaste}
                aria-label="Paste from clipboard"
                className="absolute right-3 top-3 h-10 w-10 rounded-xl bg-surface-container-low hover:bg-surface-container-high flex items-center justify-center transition-colors"
              >
                <span className="material-symbols-outlined text-on-surface-variant">content_paste</span>
              </button>
            </div>
            {status === 'checking' && (
              <p className="font-label-sm text-label-sm text-on-surface-variant">Checking available qualities…</p>
            )}
            {status === 'error' && (
              <p className="font-label-sm text-label-sm text-error">{errorMsg}</p>
            )}
          </section>

          {/* Results Section */}
          {videoInfo && qualities.length > 0 && (
            <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
              {/* Video Preview Card */}
              <div className="md:col-span-2 rounded-2xl border border-outline-variant bg-surface-container-lowest overflow-hidden flex flex-col shadow-sm">
                <div className="relative w-full aspect-[1.60] bg-surface-container-low">
                  {videoInfo.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt="Video thumbnail"
                      className="w-full h-full object-cover"
                      src={videoInfo.thumbnail}
                    />
                  )}
                  <div className="absolute top-4 left-4 flex gap-2">
                    {topBadge && (
                      <span className="px-3 py-1.5 bg-surface-container-lowest text-on-surface font-label-sm text-label-sm font-bold rounded-lg shadow-md">
                        {topBadge}
                      </span>
                    )}
                    {videoInfo.duration && (
                      <span className="px-3 py-1.5 bg-surface-container-lowest text-on-surface font-label-sm text-label-sm font-bold rounded-lg shadow-md">
                        {videoInfo.duration}
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-6 flex flex-col gap-2">
                  <h3 className="font-headline-lg-mobile text-headline-lg-mobile text-primary truncate">
                    {videoInfo.title}
                  </h3>
                  {videoInfo.channel && (
                    <p className="font-body-md text-body-md text-on-surface-variant truncate">
                      Channel: {videoInfo.channel}
                    </p>
                  )}
                </div>
              </div>

              {/* Download Options Card */}
              <div className="md:col-span-1 rounded-2xl border border-outline-variant bg-surface-container-lowest p-6 flex flex-col gap-stack-md shadow-sm">
                <h3 className="font-headline-lg-mobile text-headline-lg-mobile text-primary border-b border-outline-variant pb-4">
                  Options
                </h3>
                <div className="flex flex-col gap-3">
                  <label className="font-label-sm text-label-sm text-on-surface-variant font-bold">
                    Format &amp; Quality
                  </label>
                  <div className="relative w-full">
                    <select
                      className="w-full h-14 pl-4 pr-10 rounded-xl border border-outline-variant bg-surface-container-lowest text-on-surface appearance-none focus:outline-none focus:border-secondary focus:ring-2 focus:ring-secondary-fixed-dim transition-all cursor-pointer font-body-md text-body-md"
                      value={selectedQuality}
                      onChange={(e) => setSelectedQuality(e.target.value)}
                    >
                      {qualities.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.label}
                        </option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined absolute right-4 top-4 text-on-surface-variant pointer-events-none">
                      expand_more
                    </span>
                  </div>
                </div>
                <div className="flex-grow" />
                <button
                  onClick={handleDownload}
                  disabled={status === 'loading' || !selectedQuality}
                  className="w-full h-14 rounded-xl bg-primary text-on-primary font-button-text text-button-text text-lg hover:bg-surface-tint hover:shadow-lg transition-all flex items-center justify-center gap-2 active:scale-95 duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined">download</span>
                  {status === 'loading' ? 'Downloading…' : 'Download'}
                </button>
                {status === 'done' && (
                  <p className="font-label-sm text-label-sm text-on-tertiary-container text-center">
                    Done — check your downloads folder.
                  </p>
                )}
                {status === 'error' && (
                  <p className="font-label-sm text-label-sm text-error text-center">{errorMsg}</p>
                )}
              </div>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
