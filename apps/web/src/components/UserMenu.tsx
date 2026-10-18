'use client';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ExitLineIcon } from '@/components/icons';
import { useLogout, type SessionUser } from '@/lib/auth';

export function UserMenu({ user }: { user: SessionUser }) {
  const logout = useLogout();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="h-auto gap-2 px-2 py-1.5" aria-label={`Account menu for ${user.name}`} />}>
        <Avatar className="size-7">
          <AvatarFallback className="text-xs">{user.name.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="hidden max-w-32 truncate text-sm text-foreground sm:inline">{user.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => logout.mutate()}>
          <ExitLineIcon className="size-4" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
