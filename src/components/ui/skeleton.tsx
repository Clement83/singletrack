import { cn } from '@/lib/utils';

/** Loading block (skeleton): shows the shape of what is coming. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" aria-hidden className={cn('animate-pulse rounded-lg bg-muted', className)} {...props} />;
}
