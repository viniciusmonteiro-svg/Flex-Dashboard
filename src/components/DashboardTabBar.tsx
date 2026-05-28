'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { cn } from '@/lib/cn';
import { useUnsavedChanges } from '@/lib/UnsavedChangesContext';

const TABS = [
  { label: 'Dashboard',             href: '/dashboard'              },
  { label: 'Channel Economics',     href: '/channel-costs'          },
  { label: 'Pipeline',              href: '/salesforce'             },
  { label: 'Vendor Classification', href: '/vendor-classifications' },
  { label: 'Data Management',       href: '/data-management'        },
] as const;

const ADMIN_TABS = [
  { label: 'Users', href: '/user-management' },
] as const;

export function DashboardTabBar() {
  const pathname = usePathname();
  const { confirmNavigation } = useUnsavedChanges();
  const { user } = useUser();
  const isAdmin = (user?.publicMetadata as { role?: string })?.role === 'admin';

  const allTabs = isAdmin ? [...TABS, ...ADMIN_TABS] : TABS;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (pathname === href) return;
    if (!confirmNavigation()) {
      e.preventDefault();
    }
  };

  return (
    <nav className="sticky top-14 z-40 w-full border-b border-gray-200 bg-[var(--color-background,white)]">
      <div className="mx-auto flex max-w-screen-2xl gap-0 px-6">
        {allTabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + '/');
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={(e) => handleClick(e, tab.href)}
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
