'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { H1 } from '@/components/ui/typography';
import { api } from '@/lib/api';
import { ME_KEY } from '@/lib/auth';
import { safeNext } from '@/lib/nav';

function RegisterForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const next = safeNext(useSearchParams().get('next'));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const register = useMutation({
    mutationFn: () => api('/auth/register', { method: 'POST', json: { name, email, password } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ME_KEY });
      router.replace(next);
    },
  });
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <H1 className="text-xl">Create your account</H1>
          <CardDescription>Buy tickets or run your own events.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              register.mutate();
            }}
          >
            {register.error && (
              <Alert variant="destructive">
                <AlertDescription>{register.error.message}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input className="h-11 md:h-9" id="name" autoComplete="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input className="h-11 md:h-9" id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input className="h-11 md:h-9" id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="password-hint" />
              <p id="password-hint" className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>
            <Button type="submit" className="h-11 w-full md:h-9" disabled={register.isPending}>
              {register.isPending ? 'Creating account' : 'Create account'}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            Already registered?{' '}
            <Link className="text-primary underline-offset-4 hover:underline" href={`/login?next=${encodeURIComponent(next)}`}>
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
