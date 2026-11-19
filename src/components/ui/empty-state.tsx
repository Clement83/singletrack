import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  /** Le bouton qui propose la suite (« On en crée une ? »). */
  action?: React.ReactNode;
  tone?: 'neutral' | 'error';
  className?: string;
};

/** État vide ou erreur : ton simple et tutoyé, et toujours une suite possible. */
export function EmptyState({ icon: Icon, title, children, action, tone = 'neutral', className }: Props) {
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={cn('flex flex-col items-center gap-3 px-gutter py-12 text-center', className)}
    >
      <span
        className={cn(
          'flex size-12 items-center justify-center rounded-xl ring-1 ring-inset ring-border/60',
          tone === 'error' ? 'bg-destructive-soft text-destructive' : 'bg-accent text-accent-foreground',
        )}
      >
        <Icon aria-hidden className="size-6" strokeWidth={1.75} />
      </span>
      <p className="text-heading">{title}</p>
      {children && <p className="max-w-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-2 w-full max-w-sm">{action}</div>}
    </div>
  );
}
