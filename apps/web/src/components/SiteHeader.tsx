'use client';
import Link from 'next/link';
import { UserMenu } from '@/components/UserMenu';
import { TicketLineIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMe } from '@/lib/auth';
import { navItems } from '@/lib/nav';

/** Storefront shell: brand, primary links by role, user menu. */
export function SiteHeader() {
  const me = useMe().data ?? null;
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4">
        <Link href="/" className="mr-2 flex min-h-11 items-center gap-2 font-semibold tracking-tight md:min-h-0">
          <TicketLineIcon className="size-5 text-primary" aria-hidden />
          Standing
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1">
          {navItems(me?.nav ?? null).map((item) => (
            <Link key={item.href} href={item.href} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-11 md:h-8')}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          {me ? (
            <UserMenu user={me.user} />
          ) : (
            <Link href="/login" className={cn(buttonVariants({ size: 'sm' }), 'h-11 md:h-8')}>
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
