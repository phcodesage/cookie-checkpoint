import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cookie Checkpoint | Cookie Chain',
  description: 'Make a verifiable daily signal on Cookie Chain with Nightly.',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
