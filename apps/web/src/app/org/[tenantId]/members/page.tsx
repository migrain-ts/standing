'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import type { TenantRoleName } from '@standing/shared';
import { PageHeader, TenantMissing } from '@/components/OrgBits';
import { QueryError } from '@/components/QueryError';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { orgKeys, toastError, useOrgTenant, type Member } from '@/lib/organizer';
import { canAdmin, roleLabel } from '@/lib/tenants';
import { trapTab } from '@/lib/focusTrap';
import { tenantApi } from '@/lib/paths';

const ROLES: TenantRoleName[] = ['owner', 'manager', 'door'];

export default function MembersPage() {
  const { tenantId, tenant, ready } = useOrgTenant();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TenantRoleName>('manager');
  const key = orgKeys.members(tenantId);
  const q = useQuery({ queryKey: key, queryFn: () => api<{ members: Member[] }>(tenantApi(tenantId, 'members')), enabled: tenant != null });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: () => api(tenantApi(tenantId, 'members'), { method: 'POST', json: { email: email.trim(), role } }),
    onSuccess: () => {
      toast.success(`${email.trim()} added as ${roleLabel(role).toLowerCase()}`);
      setEmail('');
      return refresh();
    },
    onError: toastError,
  });
  const change = useMutation({
    mutationFn: (v: { userId: string; role: TenantRoleName }) => api(tenantApi(tenantId, 'members', v.userId), { method: 'PATCH', json: { role: v.role } }),
    onSuccess: () => {
      toast.success('Role updated');
      return refresh();
    },
    // Refetch so a select the API refused snaps back to the stored role.
    onError: (e) => {
      toastError(e);
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api(tenantApi(tenantId, 'members', userId), { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Member removed');
      return refresh();
    },
    onError: toastError,
  });

  if (ready && !tenant) return <TenantMissing />;
  const admin = tenant ? canAdmin(tenant.role) : false;
  const members = q.data?.members ?? [];

  return (
    <>
      <PageHeader title="Members" description={admin ? 'Add people by the email of their account and set what they can do.' : 'Only owners can change the team.'} />
      {admin && (
        <form
          className="mb-8 grid items-end gap-3 sm:grid-cols-[1fr_10rem_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) add.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="member-email">Email</Label>
            <Input id="member-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 md:h-9" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-role">Role</Label>
            <NativeSelect id="member-role" value={role} onChange={(e) => setRole(e.target.value as TenantRoleName)} className="h-11 md:h-9">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" className="h-11 md:h-9" disabled={!email.trim() || add.isPending}>
            Add member
          </Button>
        </form>
      )}
      {q.isError && <QueryError title="Could not load members" error={q.error} onRetry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-40 w-full" aria-busy="true" />}
      {q.isSuccess && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-2 sm:px-4">Member</TableHead>
              <TableHead className="px-2 sm:px-4">Role</TableHead>
              {admin && (
                <TableHead className="px-2 sm:px-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.userId}>
                <TableCell className="px-2 sm:px-4">
                  <div className="font-medium">{m.name}</div>
                  <div className="break-all text-xs text-muted-foreground">{m.email}</div>
                </TableCell>
                <TableCell className="px-2 sm:px-4">
                  {admin ? (
                    <NativeSelect
                      aria-label={`Role of ${m.name}`}
                      value={m.role}
                      disabled={change.isPending}
                      onChange={(e) => change.mutate({ userId: m.userId, role: e.target.value as TenantRoleName })}
                      className="h-11 w-32 sm:w-36 md:h-9"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    roleLabel(m.role)
                  )}
                </TableCell>
                {admin && (
                  <TableCell className="px-2 sm:px-4 text-right">
                    <AlertDialog>
                      <AlertDialogTrigger render={<Button variant="ghost" size="sm" className="h-11 md:h-8" />}>
                        Remove<span className="sr-only"> {m.name}</span>
                      </AlertDialogTrigger>
                      <AlertDialogContent onKeyDown={trapTab}>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove {m.name}?</AlertDialogTitle>
                          <AlertDialogDescription>They lose access to {tenant?.name}. Their account is not deleted.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="h-11 md:h-9">Keep member</AlertDialogCancel>
                          <AlertDialogAction className="h-11 md:h-9" onClick={() => remove.mutate(m.userId)}>
                            Remove member
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
