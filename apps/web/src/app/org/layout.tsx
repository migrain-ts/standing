import { AuthGate } from '@/components/AuthGate';
import { OrgSidebar } from '@/components/OrgSidebar';

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <div className="flex min-h-dvh flex-col md:flex-row">
        <OrgSidebar />
        <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 py-6 md:px-8 md:py-10">{children}</main>
      </div>
    </AuthGate>
  );
}
