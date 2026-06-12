import type { Metadata } from 'next';
import { Space_Grotesk, DM_Sans, DM_Mono } from 'next/font/google';
import './globals.css';
import { ClerkProvider } from '@clerk/nextjs';
import { AppShell } from '@/components/AppShell';
import { UnsavedChangesProvider } from '@/lib/UnsavedChangesContext';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const dmMono = DM_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['300', '400', '500'],
});

export const metadata: Metadata = {
  title: 'Flex Dental Dashboard',
  description: 'Flex Dental — FP&A Marketing Spend Analytics',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-in"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      <html
        lang="en"
        className={`${spaceGrotesk.variable} ${dmSans.variable} ${dmMono.variable}`}
      >
        <body>
          <UnsavedChangesProvider>
            <AppShell>{children}</AppShell>
          </UnsavedChangesProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
