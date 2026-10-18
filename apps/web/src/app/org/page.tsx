'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { H1 } from '@/components/ui/typography';
import { api } from '@/lib/api';
import { ME_KEY, useMe } from '@/lib/auth';
import { toastError } from '@/lib/organizer';
import { pickDefaultTenant, readStoredTenant } from '@/lib/tenants';
import { orgPath } from '@/lib/paths';

/** /org opens the last used organization, else the first one the user can organize. */
export default function OrgIndexPage() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const organizing = (me.data?.tenants ?? []).filter((t) => t.role !== 'door');
  const target = me.isSuccess ? pickDefaultTenant(organizing, readStoredTenant()) : null;

  useEffect(() => {
    if (target) router.replace(`/org/${target}`);
  }, [target, router]);

  const create = useMutation({
    mutationFn: (n: string) => api<{ tenant: { id: string } }>('/tenants', { method: 'POST', json: { name: n } }),
    onSuccess: async ({ tenant }) => {
      await qc.invalidateQueries({ queryKey: ME_KEY });
      toast.success('Organization created');
      router.replace(orgPath(tenant.id));
    },
    onError: toastError,
  });

  if (!me.isSuccess || target) return <Skeleton className="h-24 w-full" aria-busy="true" />;
  return (
    <div className="max-w-md">
      <H1 className="text-2xl md:text-3xl">Create your organization</H1>
      <p className="mt-1 text-sm text-muted-foreground">An organization owns venues, events and its team.</p>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(name.trim());
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="org-name">Name</Label>
          <Input id="org-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className="h-11 md:h-9" />
        </div>
        <Button type="submit" className="h-11 md:h-9" disabled={!name.trim() || create.isPending}>
          Create organization
        </Button>
      </form>
    </div>
  );
}
