import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Header } from '@/components/Header';
import { DashboardTabBar } from '@/components/DashboardTabBar';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Marketing Dashboard',
  description: 'Curve Dental — FP&A Marketing Spend Analytics',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-[var(--color-band)] font-sans antialiased">
        <Header />
        <DashboardTabBar />
        <main className="mx-auto max-w-screen-2xl px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
