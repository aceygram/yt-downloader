'use client';

import { useEffect, useState } from 'react';
import Header from '../../components/Header';
import PendingDownloads from '../../components/PendingDownloads';
import { getHistory, deleteHistoryEntry, clearHistory, addPending, formatBytes, formatDate } from '../../lib/history';
import { friendlyErrorHint } from '../../lib/errorHints';

export default function History() {
  const [entries, setEntries] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [redownloadState, setRedownloadState] = useState({}); // id -> { starting, error }

  const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');

  useEffect(() => {
    setEntries(getHistory());
  }, []);

  const handleDelete = (id) => {
    deleteHistoryEntry(id);
    setEntries(getHistory());
  };

  const handleClearAll = () => {
    clearHistory();
    setEntries([]);
  };

  const handleRedownload = async (entry) => {
    setErrorMsg('');
    setRedownloadState((prev) => ({ ...prev, [entry.id]: { starting: true, active: false, ready: false, percent: 0, message: '', error: '' } }));

    try {
      const res = await fetch(`${backendUrl}/download/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: entry.url, quality: entry.qualityId, title: entry.title || 'video' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not start download');
      }
      const { jobId } = await res.json();
      addPending({
        jobId,
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
      // The shared <PendingDownloads /> list above is what actually asks to
      // confirm-and-save the finished file and handles history/cancellation.
      // This connection is just a read-only mirror so progress also shows
      // right next to this button.
      setRedownloadState((prev) => ({ ...prev, [entry.id]: { starting: false, active: true, ready: false, percent: 0, message: 'Starting…', error: '' } }));

      const es = new EventSource(`${backendUrl}/download/progress/${jobId}`);
      es.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.status === 'error') {
          setRedownloadState((prev) => ({ ...prev, [entry.id]: { starting: false, active: false, ready: false, percent: 0, message: '', error: data.error || 'Download failed' } }));
          es.close();
          return;
        }
        if (data.status === 'done') {
          es.close();
          setRedownloadState((prev) => ({ ...prev, [entry.id]: { starting: false, active: false, ready: true, percent: 100, message: 'Ready', error: '', sizeBytes: data.sizeBytes || null } }));
          return;
        }
        setRedownloadState((prev) => ({ ...prev, [entry.id]: { starting: false, active: true, ready: false, percent: data.percent, message: data.message, error: '' } }));
      };
      es.onerror = () => es.close();
    } catch (err) {
      setRedownloadState((prev) => ({ ...prev, [entry.id]: { starting: false, active: false, ready: false, percent: 0, message: '', error: err.message } }));
    }
  };

  return (
    <>
      <Header />
      <main className="flex-1 max-w-container-max mx-auto w-full min-w-0 px-margin-mobile md:px-gutter py-stack-md flex flex-col gap-stack-lg pb-24 md:pb-stack-lg overflow-x-hidden">
        <PendingDownloads onSettled={() => setEntries(getHistory())} />

        <section className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3 sm:gap-stack-sm">
          <div className="flex flex-col gap-1 min-w-0">
            <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-primary break-words">
              History
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Your recently downloaded videos.
            </p>
          </div>
          {entries.length > 0 && (
            <button
              onClick={handleClearAll}
              className="self-start sm:self-auto shrink-0 text-secondary font-button-text text-button-text hover:text-primary transition-colors pb-1"
            >
              Clear All
            </button>
          )}
        </section>

        {errorMsg && (
          <p className="font-label-sm text-label-sm text-error break-words">{errorMsg}</p>
        )}

        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-stack-lg text-center px-4">
            <span className="material-symbols-outlined text-5xl text-on-surface-variant">history</span>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-sm">
              Nothing downloaded yet. Paste a link on the Download page to get started.
            </p>
          </div>
        ) : (
          <section className="flex flex-col gap-4 sm:gap-8 min-w-0">
            {entries.map((entry) => (
              <article
                key={entry.id}
                className="flex flex-col md:flex-row gap-4 sm:gap-8 bg-surface-container-lowest p-4 sm:p-6 rounded-xl border border-outline-variant shadow-sm hover:shadow-md transition-shadow min-w-0"
              >
                <div className="relative w-full md:w-56 aspect-video rounded-lg overflow-hidden bg-surface-container-low flex-shrink-0">
                  {entry.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="w-full h-full object-cover" src={entry.thumbnail} alt={entry.title} />
                  )}
                  {entry.duration && (
                    <div className="absolute bottom-2 right-2 bg-primary-container/90 backdrop-blur-sm text-on-primary text-xs px-2 py-1 rounded font-label-sm">
                      {entry.duration}
                    </div>
                  )}
                </div>
                <div className="flex flex-col flex-grow justify-between gap-3 min-w-0">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-primary line-clamp-2 leading-tight break-words">
                      {entry.title}
                    </h2>
                    {entry.channel && (
                      <p className="font-label-sm text-on-surface-variant mt-1.5 truncate">{entry.channel}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1">
                    <div className="flex flex-wrap gap-1.5">
                      {entry.badge && (
                        <span className="bg-primary/10 text-primary px-2.5 py-1 rounded-md text-xs font-label-sm font-semibold">
                          {entry.badge}
                        </span>
                      )}
                      <span className="bg-surface-container-high text-on-surface-variant px-2.5 py-1 rounded-md text-xs font-label-sm border border-outline-variant/50">
                        {(entry.container || 'mp4').toUpperCase()}
                      </span>
                    </div>
                    {entry.sizeBytes ? (
                      <span className="text-xs font-label-sm text-on-surface-variant flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-outline-variant" />
                        {formatBytes(entry.sizeBytes)}
                      </span>
                    ) : null}
                    <span className="text-xs font-label-sm text-on-surface-variant flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-outline-variant" />
                      {formatDate(entry.downloadedAt)}
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mt-3 pt-3 border-t border-surface-container-highest">
                    <div className="flex items-center gap-1.5 text-on-tertiary-container text-sm font-label-sm font-medium">
                      <span className="material-symbols-outlined text-[18px]">check_circle</span>
                      Completed
                    </div>
                    <div className="flex flex-col gap-2 w-full sm:w-auto">
                      <div className="flex items-center gap-3 w-full sm:w-auto">
                        <button
                          onClick={() => handleDelete(entry.id)}
                          aria-label="Remove from history"
                          className="shrink-0 p-2 text-on-surface-variant hover:text-error transition-colors bg-surface-container-low rounded-lg hover:bg-error-container flex items-center justify-center"
                        >
                          <span className="material-symbols-outlined text-[20px]">delete</span>
                        </button>
                        <button
                          onClick={() => handleRedownload(entry)}
                          disabled={redownloadState[entry.id]?.starting || redownloadState[entry.id]?.active || redownloadState[entry.id]?.ready}
                          className="flex-1 sm:flex-none justify-center px-4 sm:px-5 py-2.5 bg-primary text-on-primary font-button-text rounded-lg hover:bg-on-background transition-colors flex items-center gap-2 disabled:opacity-50 whitespace-nowrap"
                        >
                          <span className="material-symbols-outlined text-[20px]">download</span>
                          <span className="truncate">
                            {redownloadState[entry.id]?.starting
                              ? 'Starting…'
                              : redownloadState[entry.id]?.active
                              ? 'Downloading…'
                              : redownloadState[entry.id]?.ready
                              ? 'Ready above ↑'
                              : 'Download again'}
                          </span>
                        </button>
                      </div>
                      {redownloadState[entry.id]?.active && (
                        <div className="flex flex-col gap-1 w-full sm:w-48">
                          <div className="w-full h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                            <div
                              className="h-full bg-secondary transition-all duration-300"
                              style={{ width: `${Math.max(2, redownloadState[entry.id].percent)}%` }}
                            />
                          </div>
                          <p className="font-label-sm text-[11px] text-on-surface-variant text-right">
                            {redownloadState[entry.id].message}{' '}
                            {redownloadState[entry.id].percent > 0 ? `(${Math.round(redownloadState[entry.id].percent)}%)` : ''}
                          </p>
                        </div>
                      )}
                      {redownloadState[entry.id]?.ready && (
                        <p className="font-label-sm text-[11px] text-on-tertiary-container text-right">
                          {redownloadState[entry.id].sizeBytes ? formatBytes(redownloadState[entry.id].sizeBytes) : 'Size unknown'}{' '}
                          — confirm in Downloads above
                        </p>
                      )}
                      {redownloadState[entry.id]?.error && (
                        <div className="text-right">
                          <p className="font-label-sm text-[11px] text-error">
                            {redownloadState[entry.id].error}
                          </p>
                          <p className="font-label-sm text-[11px] text-on-surface-variant mt-0.5">
                            {friendlyErrorHint(redownloadState[entry.id].error)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
    </>
  );
}