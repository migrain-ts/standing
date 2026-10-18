'use client';
import Link from 'next/link';
import { UserMenu } from '@/components/UserMenu';
import { TicketLineIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useMe } from '@/lib/auth';
import { navItems } from '@/lib/nav';

/** Storefront shell: brand, primary links by role, user menu. */
export function SiteHeader() {
  const me = useMe().data ?? null;
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4">
        <Link href="/" className="mr-2 flex items-center gap-2 font-semibold tracking-tight">
          <TicketLineIcon className="size-5 text-primary" aria-hidden />
          Standing
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1">
          {navItems(me?.nav ?? null).map((item) => (
            <Button key={item.href} asChild nativeButton={false} variant="ghost" size="sm">
              <Link href={item.href}>{item.label}</Link>
            </Button>
          ))}
        </nav>
        <div className="ml-auto">
          {me ? (
            <UserMenu user={me.user} />
          ) : (
            <Button asChild nativeButton={false} size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
