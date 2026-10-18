'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { DownLineIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { storeTenant } from '@/lib/tenants';

type Props = { tenants: { id: string; name: string }[]; activeId: string | null; suffix: string; onNavigate?: () => void };

/** Organization switcher; remembers the last organization in localStorage (see lib/tenants.ts). */
export function TenantSwitcher({ tenants, activeId, suffix, onNavigate }: Props) {
  const router = useRouter();
  const active = tenants.find((t) => t.id === activeId);
  useEffect(() => {
    if (activeId) storeTenant(activeId);
  }, [activeId]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-11 min-w-0 flex-1 justify-between md:h-8" aria-label="Switch organization" />}>
        <span className="truncate">{active?.name ?? 'No organization'}</span>
        <DownLineIcon className="size-4 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {tenants.map((t) => (
          <DropdownMenuItem
            key={t.id}
            className="min-h-11 md:min-h-0"
            onClick={() => {
              router.push(`/org/${t.id}${suffix}`);
              onNavigate?.();
            }}
          >
            {t.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
