'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { DemoPersona } from '@standing/shared';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { ME_KEY } from '@/lib/auth';

const PERSONAS: { persona: DemoPersona; label: string; landing: string }[] = [
  { persona: 'organizer', label: 'Organizer', landing: '/org' },
  { persona: 'buyer', label: 'Buyer', landing: '/' },
  { persona: 'door', label: 'Door staff', landing: '/door' },
];

/** Local demo only: the API serves /auth/demo when DEMO_LOGIN=1. Hidden unless NEXT_PUBLIC_DEMO_LOGIN=1. */
export function DemoLogin({ next }: { next: string | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const login = useMutation({
    mutationFn: ({ persona }: { persona: DemoPersona; landing: string }) => api('/auth/demo', { method: 'POST', json: { persona } }),
    onSuccess: async (_data, { landing }) => {
      await qc.invalidateQueries({ queryKey: ME_KEY, refetchType: 'all' }); // the cached anonymous 'me' may have no observer here
      router.replace(next ?? landing);
    },
  });
  if (process.env.NEXT_PUBLIC_DEMO_LOGIN !== '1') return null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Try a demo account</p>
      <div className="grid grid-cols-3 gap-2">
        {PERSONAS.map(({ persona, label, landing }) => (
          <Button key={persona} type="button" variant="secondary" size="sm" className="h-11 md:h-8" disabled={login.isPending} onClick={() => login.mutate({ persona, landing })}>
            {label}
          </Button>
        ))}
      </div>
      {login.error && <p role="alert" className="text-sm text-destructive">{login.error.message}</p>}
    </div>
  );
}
