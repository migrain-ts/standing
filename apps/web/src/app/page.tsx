import { H1 } from '@/components/ui/typography';
import { SiteHeader } from '@/components/SiteHeader';

// Placeholder until Task 19 builds the storefront.
export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-10">
        <H1 className="text-2xl">Upcoming events</H1>
        <p className="mt-2 text-sm text-muted-foreground">The event catalogue arrives with the storefront.</p>
      </main>
    </>
  );
}
