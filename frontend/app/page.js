'use client';

import { useState } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [qualities, setQualities] = useState([]);
  const [selectedQuality, setSelectedQuality] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [status, setStatus] = useState('idle'); // idle | checking | loading | error | done
  const [errorMsg, setErrorMsg] = useState('');

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

  const checkFormats = async () => {
    if (!url.trim()) return;
    setStatus('checking');
    setErrorMsg('');
    setQualities([]);

    try {
      const res = await fetch(`${backendUrl}/formats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not fetch video info');
      }

      const data = await res.json();
      setQualities(data.qualities || []);
      setVideoTitle(data.title || '');
      setSelectedQuality(data.qualities?.[data.qualities.length - 1] || '');
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message);
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
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${videoTitle || 'video'}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setStatus('done');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message);
    }
  };

  return (
    <main style={{ maxWidth: 480, margin: '80px auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h1 style={{ marginBottom: 16 }}>YouTube Downloader</h1>

      <input
        type="text"
        placeholder="Paste YouTube URL here"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={checkFormats}
        style={{ width: '100%', padding: 10, fontSize: 16, marginBottom: 12 }}
      />

      {status === 'checking' && <p>Checking available qualities…</p>}

      {qualities.length > 0 && (
        <>
          {videoTitle && <p style={{ marginBottom: 8 }}>{videoTitle}</p>}
          <select
            value={selectedQuality}
            onChange={(e) => setSelectedQuality(e.target.value)}
            style={{ width: '100%', padding: 10, fontSize: 16, marginBottom: 12 }}
          >
            {qualities.map((q) => (
              <option key={q} value={q}>{q}</option>
            ))}
          </select>
        </>
      )}

      <button
        onClick={handleDownload}
        disabled={status === 'loading' || !selectedQuality}
        style={{ width: '100%', padding: 12, fontSize: 16, cursor: 'pointer' }}
      >
        {status === 'loading' ? 'Downloading…' : 'Download'}
      </button>

      {status === 'error' && (
        <p style={{ color: 'red', marginTop: 12 }}>{errorMsg}</p>
      )}
      {status === 'done' && (
        <p style={{ color: 'green', marginTop: 12 }}>Done — check your downloads folder.</p>
      )}
    </main>
  );
}
