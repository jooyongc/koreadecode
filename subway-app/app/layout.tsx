import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Seoul Subway Position Guide',
  description: 'Find the best subway car and door to board for quick exits and transfers in Seoul.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white antialiased">{children}</body>
    </html>
  );
}
