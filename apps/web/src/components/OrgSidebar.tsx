'use client';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TenantSwitcher } from '@/components/TenantSwitcher';
import { UserMenu } from '@/components/UserMenu';
import { Building2LineIcon, CalendarLineIcon, DashboardLineIcon, GroupLineIcon, MenuLineIcon, TicketLineIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader } from '@/components/ui/sidebar';
import { useMe } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { trapTab } from '@/lib/focusTrap';

const SECTIONS = [
  { label: 'Overview', path: '', icon: <DashboardLineIcon /> },
  { label: 'Venues', path: '/venues', icon: <Building2LineIcon /> },
  { label: 'Events', path: '/events', icon: <CalendarLineIcon /> },
  { label: 'Members', path: '/members', icon: <GroupLineIcon /> },
];

/** The installed SidebarItem is a <button> and cannot be an anchor, so this link carries its exact classes. */
function SidebarLink({ href, label, icon, active, onClick }: { href: string; label: string; icon: React.ReactNode; active: boolean; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors md:min-h-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      <span className="shrink-0 [&>svg]:size-4">{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

function SidebarBody({ onNavigate, inSheet = false }: { onNavigate?: () => void; inSheet?: boolean }) {
  const me = useMe().data ?? null;
  const pathname = usePathname();
  const { tenantId } = useParams<{ tenantId?: string }>();
  const tenants = (me?.tenants ?? []).filter((t) => t.role !== 'door');
  const active = tenants.find((t) => t.id === tenantId) ?? null;
  const base = active ? `/org/${active.id}` : '/org';
  const suffix = SECTIONS.find((s) => s.path && pathname.startsWith(`${base}${s.path}`))?.path ?? '';
  return (
    <>
      <SidebarHeader className={cn('gap-2', inSheet && 'pr-14')}>
        <Link href="/" aria-label="Standing storefront" className="flex size-11 shrink-0 items-center justify-center md:size-auto">
          <TicketLineIcon className="size-5 text-primary" aria-hidden />
        </Link>
        <TenantSwitcher tenants={tenants} activeId={active?.id ?? null} suffix={suffix} onNavigate={onNavigate} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <nav aria-label="Organizer" className="flex flex-col gap-0.5">
            {SECTIONS.map((s) => {
              const href = `${base}${s.path}`;
              const isActive = active != null && (s.path === '' ? pathname === href : pathname.startsWith(href));
              return <SidebarLink key={s.label} href={href} label={s.label} icon={s.icon} active={isActive} onClick={onNavigate} />;
            })}
          </nav>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>{me && <UserMenu user={me.user} />}</SidebarFooter>
    </>
  );
}

/** Organizer console navigation: a fixed sidebar from md up, a compact header with a Sheet below. */
export function OrgSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Navigating (including via browser history) always closes the mobile menu.
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <Sidebar className="sticky top-0 hidden h-dvh shrink-0 md:flex" aria-label="Organizer navigation">
        <SidebarBody />
      </Sidebar>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background px-4 md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger render={<Button variant="ghost" size="icon" className="size-11" aria-label="Open menu" />}>
            <MenuLineIcon className="size-5" aria-hidden />
          </SheetTrigger>
          <SheetContent onKeyDown={trapTab} side="left" className="flex w-72 flex-col p-0">
            <SheetTitle className="sr-only">Organizer menu</SheetTitle>
            <SheetDescription className="sr-only">Switch organization or open a section.</SheetDescription>
            <Sidebar className="w-full border-r-0">
              <SidebarBody inSheet onNavigate={() => setOpen(false)} />
            </Sidebar>
          </SheetContent>
        </Sheet>
        <TicketLineIcon className="size-5 text-primary" aria-hidden />
        <span className="font-medium">Standing</span>
      </header>
    </>
  );
}
