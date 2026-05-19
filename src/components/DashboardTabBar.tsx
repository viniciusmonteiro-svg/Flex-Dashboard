'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const TABS = [
  { label: 'Budget vs Actual', href: '/budget-vs-actual' },
  { label: 'Pipeline', href: '/salesforce' },
  { label: 'Channel Breakdown', href: '/channel-breakdown' },
  { label: 'Channel Detail', href: '/channel-detail' },
  { label: 'Vendor Classification', href: '/vendor-classifications' },
  { label: 'Data Management', href: '/data-management' },
] as const;

export function DashboardTabBar() {
  const pathname = usePathname();

  return (
    <nav className="w-full border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-screen-2xl gap-0 px-6">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + '/');
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'inline-flex items-center border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                active
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-transparent text-[var(--color-neutral)] hover:border-gray-300 hover:text-gray-700'
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
