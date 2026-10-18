'use client';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { UserMenu } from '@/components/UserMenu';
import { Building2LineIcon, CalendarLineIcon, DashboardLineIcon, DownLineIcon, GroupLineIcon, TicketLineIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader, SidebarItem } from '@/components/ui/sidebar';
import { useMe } from '@/lib/auth';

const SECTIONS = [
  { label: 'Overview', path: '', icon: <DashboardLineIcon /> },
  { label: 'Venues', path: '/venues', icon: <Building2LineIcon /> },
  { label: 'Events', path: '/events', icon: <CalendarLineIcon /> },
  { label: 'Members', path: '/members', icon: <GroupLineIcon /> },
];

/** Organizer console shell. Routes are /org/<tenantId>/<section>; /org picks the first organizer tenant. */
export function OrgSidebar() {
  const me = useMe().data ?? null;
  const router = useRouter();
  const pathname = usePathname();
  const { tenantId } = useParams<{ tenantId?: string }>();
  const tenants = (me?.tenants ?? []).filter((t) => t.role !== 'door');
  const active = tenants.find((t) => t.id === tenantId) ?? tenants[0];
  const base = active ? `/org/${active.id}` : '/org';

  return (
    <Sidebar className="sticky top-0 h-dvh">
      <SidebarHeader className="gap-2">
        <Link href="/" aria-label="Standing storefront">
          <TicketLineIcon className="size-5 text-primary" aria-hidden />
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-between" aria-label="Switch organization" />}>
            <span className="truncate">{active?.name ?? 'No organization'}</span>
            <DownLineIcon className="size-4 shrink-0" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {tenants.map((t) => (
              <DropdownMenuItem key={t.id} onClick={() => router.push(`/org/${t.id}`)}>
                {t.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          {SECTIONS.map((s) => {
            const href = `${base}${s.path}`;
            const isActive = s.path === '' ? pathname === href : pathname.startsWith(href);
            return <SidebarItem key={s.label} label={s.label} icon={s.icon} active={isActive} aria-current={isActive ? 'page' : undefined} onClick={() => router.push(href)} />;
          })}
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>{me && <UserMenu user={me.user} />}</SidebarFooter>
    </Sidebar>
  );
}
