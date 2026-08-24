// Turns a raw backend/error message into a short, actionable hint shown
// alongside it — the original error text is never hidden, this just adds
// guidance on what to try next.
export function friendlyErrorHint(rawError) {
  if (!rawError) return '';
  const msg = rawError.toLowerCase();

  if (msg.includes('bot') || msg.includes('cookies') || msg.includes('sign in')) {
    return "YouTube is asking to verify the request. This usually clears up on its own — try again in a minute.";
  }
  if (msg.includes('valid youtube url')) {
    return 'Double-check the link is a full YouTube video URL (starts with youtube.com or youtu.be).';
  }
  if (msg.includes('could not fetch video info')) {
    return "This can happen if the video is private, age-restricted, or region-locked — double-check it plays normally in a regular browser tab.";
  }
  if (msg.includes('download failed')) {
    return 'Some videos don\u2019t support every quality — try a lower quality, or try again in a moment.';
  }
  return 'If this keeps happening, try a lower quality or a different video.';
}