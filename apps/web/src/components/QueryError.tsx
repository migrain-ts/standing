'use client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function QueryError({ title, error, onRetry }: { title: string; error: Error | null; onRetry: () => unknown }) {
  return (
    <Alert variant="destructive" className="flex items-start justify-between gap-4">
      <div>
        <AlertTitle>{title}</AlertTitle>
        {error && <AlertDescription>{error.message}</AlertDescription>}
      </div>
      <Button size="sm" variant="outline" onClick={() => onRetry()}>
        Try again
      </Button>
    </Alert>
  );
}
