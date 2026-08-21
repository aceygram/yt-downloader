import './globals.css';

export const metadata = {
  title: 'yt4kSave - YouTube Downloader',
  description: 'Download YouTube videos at your chosen quality, up to 4K.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;700&family=Geist:wght@500&family=Inter:wght@400;600&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-surface text-on-surface font-body-md text-body-md min-h-screen flex flex-col antialiased">
        {children}
      </body>
    </html>
  );
}
