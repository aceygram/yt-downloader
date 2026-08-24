// Download history lives in the browser's localStorage rather than the backend —
// the backend deletes each video right after streaming it, so there's nothing
// server-side to list. This means history is per-device/per-browser, not shared
// across a family's different computers. If that's ever needed, it'd mean adding
// a small database + user accounts on the backend instead.

const STORAGE_KEY = 'yt4ksave-history';

export function getHistory() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addHistoryEntry(entry) {
  if (typeof window === 'undefined') return;
  const history = getHistory();
  const withId = { id: crypto.randomUUID(), downloadedAt: new Date().toISOString(), ...entry };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([withId, ...history]));
}

export function deleteHistoryEntry(id) {
  if (typeof window === 'undefined') return;
  const history = getHistory().filter((h) => h.id !== id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export function clearHistory() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function formatBytes(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

export function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Pending (in-progress) downloads — kept separate from finished history so a
// closed and reopened tab can find its job again and pick up the live SSE
// progress instead of losing track of it. The backend keeps a finished job's
// file available for 1 hour after completion, so there's a real window to
// come back within.
const PENDING_KEY = 'yt4ksave-pending';

export function getPending() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addPending(entry) {
  if (typeof window === 'undefined') return;
  const pending = getPending().filter((p) => p.jobId !== entry.jobId);
  window.localStorage.setItem(PENDING_KEY, JSON.stringify([{ startedAt: new Date().toISOString(), ...entry }, ...pending]));
}

export function removePending(jobId) {
  if (typeof window === 'undefined') return;
  const pending = getPending().filter((p) => p.jobId !== jobId);
  window.localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}
