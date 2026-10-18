import { AuthGate } from '@/components/AuthGate';
import { DoorHeader } from '@/components/DoorHeader';

export default function DoorLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <DoorHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-5">{children}</main>
    </AuthGate>
  );
}
