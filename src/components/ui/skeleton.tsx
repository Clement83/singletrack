import { cn } from '@/lib/utils';

/** Bloc de chargement (squelette) : on montre la forme de ce qui arrive. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" aria-hidden className={cn('animate-pulse rounded-xl bg-muted', className)} {...props} />;
}
