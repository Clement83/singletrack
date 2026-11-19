import { cva, type VariantProps } from 'class-variance-authority';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { DIFFICULTY, FIRE, RSVP, type Difficulty, type FireLevel, type Rsvp } from '@/lib/design/scales';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-small font-medium tabular-nums max-w-full text-left [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        neutral: 'bg-muted text-foreground ring-1 ring-inset ring-border/60',
        outline: 'border border-border bg-card text-foreground',
        primary: 'bg-accent text-accent-foreground',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-destructive-soft text-destructive',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export type BadgeProps = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

/** Pilule générique : niveau, VAE, boucle, source… */
export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Pastille de couleur d'échelle. Jamais seule : toujours dans un badge avec libellé. */
function Dot({ className }: { className: string }) {
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', className)} />;
}

export function DifficultyBadge({ level, className }: { level: Difficulty; className?: string }) {
  const t = useTranslations('scales');
  const d = DIFFICULTY[level];
  return (
    <Badge variant="outline" className={className}>
      <Dot className={d.dot} />
      {t(`difficulty.${level}`)}
    </Badge>
  );
}

export function FireBadge({ level, detailed = false, className }: { level: FireLevel; detailed?: boolean; className?: string }) {
  const t = useTranslations('scales');
  const f = FIRE[level];
  return (
    <Badge variant="outline" className={className}>
      {/* Le jaune officiel est trop clair sur fond clair : la pastille est cerclée. */}
      <Dot className={cn(f.dot, 'ring-1 ring-foreground/40')} />
      {detailed ? `${t(`fire.${level}.label`)} · ${t(`fire.${level}.detail`)}` : t(`fire.${level}.label`)}
    </Badge>
  );
}

export function RsvpBadge({ status, className }: { status: Rsvp; className?: string }) {
  const t = useTranslations('scales');
  const r = RSVP[status];
  return (
    <Badge variant="outline" className={className}>
      <Dot className={cn(r.dot, status === 'pending' && 'bg-transparent ring-1 ring-rsvp-no ring-inset')} />
      {t(`rsvp.${status}`)}
    </Badge>
  );
}
