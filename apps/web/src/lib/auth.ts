'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { TenantRoleName } from '@standing/shared';
import { api, ApiClientError } from './api';
import type { NavMe } from './nav';

export type SessionUser = { id: string; email: string; name: string };
export type TenantSummary = { id: string; name: string; slug: string; role: TenantRoleName };
export type Me = { user: SessionUser; tenants: TenantSummary[]; nav: NavMe };

export const ME_KEY = ['me'] as const;

async function fetchMe(): Promise<Me | null> {
  try {
    const [{ user }, { tenants }] = await Promise.all([
      api<{ user: SessionUser }>('/auth/me'),
      api<{ tenants: TenantSummary[] }>('/tenants'),
    ]);
    return {
      user,
      tenants,
      // Organizer console needs manager or owner; any membership can use the door.
      nav: { tenants: tenants.filter((t) => t.role !== 'door').length, door: tenants.length > 0 },
    };
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 401) return null;
    throw e;
  }
}

/** The signed-in user and memberships, or `null` when anonymous (401). */
export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: fetchMe, retry: false, staleTime: 30_000 });
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(ME_KEY, null);
      router.replace('/login');
    },
  });
}
