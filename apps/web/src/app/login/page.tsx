'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { DemoLogin } from '@/components/DemoLogin';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { H1 } from '@/components/ui/typography';
import { api } from '@/lib/api';
import { ME_KEY } from '@/lib/auth';
import { safeNext } from '@/lib/nav';

function LoginForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const rawNext = useSearchParams().get('next');
  const next = safeNext(rawNext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api('/auth/login', { method: 'POST', json: { email, password } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ME_KEY });
      router.replace(next);
    },
  });
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <H1 className="text-xl">Sign in to Standing</H1>
        </CardHeader>
        <CardContent className="space-y-6">
          <DemoLogin next={rawNext ? next : null} />
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              login.mutate();
            }}
          >
            {login.error && (
              <Alert variant="destructive">
                <AlertDescription>{login.error.message}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input className="h-11 md:h-9" id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input className="h-11 md:h-9" id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="h-11 w-full md:h-9" disabled={login.isPending}>
              {login.isPending ? 'Signing in' : 'Sign in'}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            No account?{' '}
            <Link className="text-primary underline-offset-4 hover:underline" href={`/register?next=${encodeURIComponent(next)}`}>
              Create one
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
