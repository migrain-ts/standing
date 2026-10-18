'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { QueryError } from '@/components/QueryError';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/auth';

/** Redirects anonymous visitors to /login?next=<path>; renders children only for a signed-in user. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const anonymous = me.isSuccess && me.data === null;

  useEffect(() => {
    if (anonymous) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [anonymous, pathname, router]);

  if (me.isError) return <QueryError title="Could not load your session" error={me.error} onRetry={() => me.refetch()} />;
  if (!me.isSuccess || anonymous) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 p-6" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  return <>{children}</>;
}
