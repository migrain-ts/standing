import { DownloadLineIcon } from '@/components/icons';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export type ReportControl = {
  /** null: nothing requested yet. */
  status: 'queued' | 'running' | 'ready' | 'failed' | null;
  pending: boolean;
  downloadHref: string | null;
  error: string | null;
  onGenerate: () => void;
};

const link = cn(buttonVariants({ variant: 'outline' }), 'h-11 md:h-10');

/** Sales exports (plain links, the browser downloads them) and the PDF report job. */
export function ExportsPanel({ csvHref, xlsxHref, report }: { csvHref: string; xlsxHref: string; report: ReportControl }) {
  const working = report.pending || report.status === 'queued' || report.status === 'running';
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Sales of this event, one row per ticket.</p>
      <div className="flex flex-wrap gap-3">
        <a href={csvHref} download className={link}>
          <DownloadLineIcon className="size-4" aria-hidden />
          Download CSV
        </a>
        <a href={xlsxHref} download className={link}>
          <DownloadLineIcon className="size-4" aria-hidden />
          Download XLSX
        </a>
      </div>
      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" className="h-11 md:h-10" disabled={working} onClick={report.onGenerate}>
            Generate PDF report
          </Button>
          {report.status === 'ready' && report.downloadHref && (
            <a href={report.downloadHref} download className={cn(buttonVariants(), 'h-11 md:h-10')}>
              <DownloadLineIcon className="size-4" aria-hidden />
              Download report (PDF)
            </a>
          )}
        </div>
        {working && (
          <div className="flex items-center gap-3" role="status">
            <Skeleton className="h-4 w-24" />
            <span className="text-sm text-muted-foreground">Preparing the report</span>
          </div>
        )}
        {report.status === 'ready' && (
          <p role="status" className="text-sm text-muted-foreground">
            Report ready
          </p>
        )}
        {(report.status === 'failed' || report.error) && (
          <p role="alert" className="text-sm text-destructive">
            {report.error ?? 'The report could not be prepared. Try again.'}
          </p>
        )}
      </div>
    </div>
  );
}
