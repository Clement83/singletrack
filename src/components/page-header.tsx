import { cn } from '@/lib/utils';

// Page title of the private screens (#1426): on mobile, it fits on the same line as the `UserMenu` avatar
// (fixed, top left, 40 px) instead of going under it; on desktop (avatar in the side bar) it is not shifted.
export const PAGE_TOP_PAD = 'pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-16';

export function PageHeader({ title, children, className }: { title: string; children?: React.ReactNode; className?: string }) {
  return (
    <header className={cn('flex flex-col gap-1 pl-[3.25rem] lg:pl-0', className)}>
      <h1 className="flex min-h-10 items-center text-title lg:min-h-0"><span className="min-w-0 truncate">{title}</span></h1>
      {children}
    </header>
  );
}
