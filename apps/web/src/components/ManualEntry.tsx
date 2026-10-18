'use client';
import { forwardRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Always-visible code field: paste, type, or let a keyboard-wedge USB scanner "type" the code and press Enter.
 * The parent refocuses it after every scan through the forwarded ref.
 */
export const ManualEntry = forwardRef<HTMLInputElement, { onSubmit: (code: string) => void }>(function ManualEntry(
  { onSubmit },
  ref,
) {
  const [value, setValue] = useState('');
  const submit = () => {
    const code = value.trim();
    if (!code) return;
    setValue('');
    onSubmit(code);
  };
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Label htmlFor="ticket-code">Ticket code</Label>
      <div className="flex gap-2">
        <Input
          ref={ref}
          id="ticket-code"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          placeholder="Paste or scan a code"
          className="h-11 min-w-0 flex-1 font-mono text-base"
        />
        <Button type="submit" className="h-11 min-w-24" disabled={value.trim() === ''}>
          Check
        </Button>
      </div>
    </form>
  );
});
