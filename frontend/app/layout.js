export const metadata = {
  title: 'YouTube Downloader',
  description: 'Download YouTube videos at your chosen quality',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
