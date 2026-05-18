import type { Metadata } from 'next';

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
