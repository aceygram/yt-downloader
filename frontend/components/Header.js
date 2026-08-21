'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Header() {
  const pathname = usePathname();
  const isDownload = pathname === '/';
  const isHistory = pathname === '/history';

  return (
    <>
      {/* Desktop / tablet top app bar */}
      <header className="hidden md:block bg-surface text-primary font-headline-lg-mobile text-headline-lg-mobile w-full top-0 sticky border-b border-outline-variant z-50">
        <div className="flex items-center justify-between px-gutter h-20 w-full max-w-container-max mx-auto">
          <Link
            href="/"
            className="flex items-center gap-2 font-headline-lg text-headline-lg font-bold text-primary"
          >
            <span className="material-symbols-outlined text-3xl logo">download</span>
            yt4kSave
          </Link>
          <nav className="flex gap-8">
            <Link
              href="/"
              className={`hover:opacity-80 transition-opacity font-button-text text-button-text flex items-center gap-2 active:scale-95 duration-100 ${
                isDownload ? 'text-primary' : 'text-on-surface-variant'
              }`}
            >
              <span className={`material-symbols-outlined ${isDownload ? 'icon-fill-1' : ''}`}>
                download
              </span>
              Download
            </Link>
            <Link
              href="/history"
              className={`hover:opacity-80 transition-opacity font-button-text text-button-text flex items-center gap-2 active:scale-95 duration-100 ${
                isHistory ? 'text-primary' : 'text-on-surface-variant'
              }`}
            >
              <span className={`material-symbols-outlined ${isHistory ? 'icon-fill-1' : ''}`}>
                history
              </span>
              History
            </Link>
          </nav>
        </div>
      </header>

      {/* Mobile top bar — brand only, matches the mobile reference screens */}
      <header className="flex md:hidden justify-between items-center w-full px-margin-mobile py-4 bg-surface border-b border-outline-variant sticky top-0 z-40">
        <div className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-primary">
          yt4kSave
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center h-16 bg-surface border-t border-outline-variant">
        <Link
          href="/"
          className={`flex flex-col items-center justify-center w-full h-full transition-colors ${
            isDownload ? 'text-secondary font-bold scale-95' : 'text-on-surface-variant'
          }`}
        >
          <span
            className="material-symbols-outlined text-[24px] mb-1"
            style={isDownload ? { fontVariationSettings: "'FILL' 1" } : undefined}
          >
            download
          </span>
          <span className="font-label-sm text-label-sm">Download</span>
        </Link>
        <Link
          href="/history"
          className={`flex flex-col items-center justify-center w-full h-full transition-colors ${
            isHistory ? 'text-secondary font-bold scale-95' : 'text-on-surface-variant'
          }`}
        >
          <span
            className="material-symbols-outlined text-[24px] mb-1"
            style={isHistory ? { fontVariationSettings: "'FILL' 1" } : undefined}
          >
            history
          </span>
          <span className="font-label-sm text-label-sm">History</span>
        </Link>
      </nav>
    </>
  );
}
