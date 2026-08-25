'use client';

import { useEffect, useRef, useState } from 'react';
import { getPending, removePending, addHistoryEntry, onPendingChanged } from '../lib/history';
import { friendlyErrorHint } from '../lib/errorHints';

// Renders every currently-tracked download (freshly started or resumed after
// reopening the tab), reconnects to each one's SSE progress stream, lets the
// user cancel any of them, and finishes them into history once done. This is
// the single place any in-progress download lives and can be stopped.
export default function PendingDownloads({ onSettled }) {
  const [items, setItems] = useState([]);
  const [progress, setProgress] = useState({}); // jobId -> { percent, message, error }
  const sourcesRef = useRef({}); // jobId -> EventSource, so we can close ones that disappear

  const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');

  const trackJob = (entry) => {
    if (sourcesRef.current[entry.jobId]) return; // already tracking this one
    const es = new EventSource(`${backendUrl}/download/progress/${entry.jobId}`);
    sourcesRef.current[entry.jobId] = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);

      if (data.status === 'error') {
        setProgress((prev) => ({ ...prev, [entry.jobId]: { percent: 0, message: '', error: data.error || 'Download failed' } }));
        removePending(entry.jobId);
        es.close();
        delete sourcesRef.current[entry.jobId];
        return;
      }

      setProgress((prev) => ({ ...prev, [entry.jobId]: { percent: data.percent, message: data.message, error: '' } }));

      if (data.status === 'done') {
        es.close();
        delete sourcesRef.current[entry.jobId];

        const fileUrl = `${backendUrl}/download/file/${entry.jobId}`;
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = fileUrl;
        document.body.appendChild(iframe);
        setTimeout(() => iframe.remove(), 5 * 60 * 1000);

        addHistoryEntry({
          url: entry.url,
          title: entry.title,
          thumbnail: entry.thumbnail,
          channel: entry.channel,
          duration: entry.duration,
          qualityId: entry.qualityId,
          qualityLabel: entry.qualityLabel,
          badge: entry.badge,
          container: entry.container,
          sizeBytes: data.sizeBytes || null,
        });
        removePending(entry.jobId);
        if (onSettled) onSettled();
      }
    };

    es.onerror = () => {
      es.close();
      delete sourcesRef.current[entry.jobId];
    };
  };

  const syncFromStorage = () => {
    const pending = getPending();
    setItems(pending);
    pending.forEach(trackJob);

    // Stop tracking (and drop progress for) anything no longer in the pending list
    const currentIds = new Set(pending.map((p) => p.jobId));
    Object.keys(sourcesRef.current).forEach((jobId) => {
      if (!currentIds.has(jobId)) {
        sourcesRef.current[jobId].close();
        delete sourcesRef.current[jobId];
      }
    });
  };

  useEffect(() => {
    syncFromStorage();
    const unsubscribe = onPendingChanged(syncFromStorage);
    return () => {
      unsubscribe();
      Object.values(sourcesRef.current).forEach((es) => es.close());
      sourcesRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = async (jobId) => {
    try {
      await fetch(`${backendUrl}/download/job/${jobId}`, { method: 'DELETE' });
    } catch {
      // best-effort — remove locally regardless, since the job may already be gone
    }
    if (sourcesRef.current[jobId]) {
      sourcesRef.current[jobId].close();
      delete sourcesRef.current[jobId];
    }
    removePending(jobId);
  };

  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-label-sm text-label-sm text-on-surface-variant font-bold uppercase tracking-wide">
        Downloads in progress
      </h2>
      {items.map((entry) => {
        const p = progress[entry.jobId] || { percent: 0, message: 'Resuming…', error: '' };
        return (
          <div
            key={entry.jobId}
            className="flex items-center gap-4 bg-surface-container-lowest border border-outline-variant rounded-xl p-4"
          >
            <div className="w-20 h-14 rounded-lg overflow-hidden bg-surface-container-low flex-shrink-0">
              {entry.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="w-full h-full object-cover" src={entry.thumbnail} alt={entry.title} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-button-text text-button-text text-primary truncate">{entry.title}</p>
              {p.error ? (
                <>
                  <p className="font-label-sm text-label-sm text-error mt-1">{p.error}</p>
                  <p className="font-label-sm text-[11px] text-on-surface-variant mt-0.5">{friendlyErrorHint(p.error)}</p>
                </>
              ) : (
                <>
                  <div className="w-full h-1.5 rounded-full bg-surface-container-high overflow-hidden mt-1.5">
                    <div
                      className="h-full bg-secondary transition-all duration-300"
                      style={{ width: `${Math.max(2, p.percent)}%` }}
                    />
                  </div>
                  <p className="font-label-sm text-[11px] text-on-surface-variant mt-1">
                    {p.message} {p.percent > 0 ? `(${Math.round(p.percent)}%)` : ''}
                  </p>
                </>
              )}
            </div>
            <button
              onClick={() => handleCancel(entry.jobId)}
              aria-label="Cancel download"
              className="shrink-0 p-2 text-on-surface-variant hover:text-error transition-colors bg-surface-container-low rounded-lg hover:bg-error-container flex items-center justify-center"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        );
      })}
    </section>
  );
}