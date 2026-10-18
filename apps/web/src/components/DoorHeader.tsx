'use client';
import Link from 'next/link';
import { UserMenu } from '@/components/UserMenu';
import { ScanLineIcon } from '@/components/icons';
import { useMe } from '@/lib/auth';

/** Compact header for the door scanner, sized for a phone held in one hand. */
export function DoorHeader() {
  const me = useMe().data ?? null;
  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-background px-3">
      <Link href="/door" className="flex items-center gap-2 text-sm font-semibold">
        <ScanLineIcon className="size-5 text-primary" aria-hidden />
        Door
      </Link>
      {me && <UserMenu user={me.user} />}
    </header>
  );
}
