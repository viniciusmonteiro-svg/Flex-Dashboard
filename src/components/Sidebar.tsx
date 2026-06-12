'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useUnsavedChanges } from '@/lib/UnsavedChangesContext';

const NAV_ITEMS = [
  { label: 'Dashboard',         href: '/dashboard'              },
  { label: 'Channel Economics', href: '/channel-costs'          },
  { label: 'Pipeline',          href: '/salesforce'             },
  { label: 'Allocation Center', href: '/vendor-classifications' },
  { label: 'Data Management',   href: '/data-management'        },
] as const;

const ADMIN_ITEMS = [
  { label: 'Users', href: '/user-management' },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { confirmNavigation } = useUnsavedChanges();
  const { user } = useUser();
  const isAdmin = (user?.publicMetadata as { role?: string })?.role === 'admin';
  const allItems = isAdmin ? [...NAV_ITEMS, ...ADMIN_ITEMS] : NAV_ITEMS;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (pathname === href) return;
    if (!confirmNavigation()) e.preventDefault();
  };

  return (
    <aside
      style={{
        width: 'var(--sidebar-width)',
        backgroundColor: 'var(--color-sidebar)',
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Logo area */}
      <div
        style={{
          padding: '24px 20px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '17px',
            color: '#FFFFFF',
            letterSpacing: '-0.025em',
            lineHeight: 1.2,
          }}
        >
          Flex Dental
        </div>
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: '10.5px',
            color: 'var(--color-text-sidebar)',
            marginTop: '3px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          FP&amp;A Dashboard
        </div>
      </div>

      {/* Nav section label */}
      <div style={{ padding: '20px 20px 8px' }}>
        <span
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: '10px',
            fontWeight: 600,
            color: 'var(--color-text-sidebar)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          Navigation
        </span>
      </div>

      {/* Nav links */}
      <nav style={{ flex: 1, padding: '0 10px' }}>
        {allItems.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={(e) => handleClick(e, item.href)}
              className={active ? '' : 'sidebar-nav-link'}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '9px 12px',
                borderRadius: '7px',
                marginBottom: '2px',
                fontFamily: 'var(--font-body)',
                fontSize: '13.5px',
                fontWeight: active ? 600 : 400,
                color: active
                  ? 'var(--color-text-sidebar-active)'
                  : 'var(--color-text-sidebar)',
                backgroundColor: active
                  ? 'var(--color-sidebar-active)'
                  : 'transparent',
                borderLeft: active
                  ? '2px solid var(--color-accent)'
                  : '2px solid transparent',
                textDecoration: 'none',
                transition: 'background-color 0.12s ease, color 0.12s ease',
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom glow */}
      <div
        aria-hidden="true"
        style={{
          height: '100px',
          background:
            'linear-gradient(to top, rgba(0,180,216,0.07) 0%, transparent 100%)',
          pointerEvents: 'none',
          flexShrink: 0,
        }}
      />
    </aside>
  );
}
