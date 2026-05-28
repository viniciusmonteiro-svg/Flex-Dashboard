import { UserButton } from '@clerk/nextjs';

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full bg-[var(--color-primary)] text-white">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-6">
        <span className="font-sans text-base font-bold tracking-tight">
          Marketing Dashboard
        </span>
        <UserButton
          appearance={{
            elements: {
              avatarBox: 'w-8 h-8',
            },
          }}
        />
      </div>
    </header>
  );
}
