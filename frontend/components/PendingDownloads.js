'use client';

import { useEffect, useState } from 'react';
import { getPending, removePending, addHistoryEntry } from '../lib/history';
import { friendlyErrorHint } from '../lib/errorHints';

// Renders any downloads that were still in progress when this tab was last
// closed/reloaded, reconnects to their SSE progress stream, and finishes them
// into history once done — this is what makes "close the tab, come back
// later" actually work, instead of losing track of an in-progress job.
export default function PendingDownloads({ onSettled }) {
  const [items, setItems] = useState([]);
  const [progress, setProgress] = useState({}); // jobId -> { percent, message, error }

  const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');

  useEffect(() => {
    const pending = getPending();
    setItems(pending);

    const sources = pending.map((entry) => {
      const es = new EventSource(`${backendUrl}/download/progress/${entry.jobId}`);

      es.onmessage = (e) => {
        const data = JSON.parse(e.data);

        if (data.status === 'error') {
          setProgress((prev) => ({ ...prev, [entry.jobId]: { percent: 0, message: '', error: data.error || 'Download failed' } }));
          removePending(entry.jobId);
          es.close();
          return;
        }

        setProgress((prev) => ({ ...prev, [entry.jobId]: { percent: data.percent, message: data.message, error: '' } }));

        if (data.status === 'done') {
          es.close();

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
          });
          removePending(entry.jobId);
          setItems((prev) => prev.filter((p) => p.jobId !== entry.jobId));
          if (onSettled) onSettled();
        }
      };

      es.onerror = () => es.close();
      return es;
    });

    return () => sources.forEach((es) => es.close());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          </div>
        );
      })}
    </section>
  );
}
