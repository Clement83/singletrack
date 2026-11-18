import { ChevronDown } from 'lucide-react';

/** Section repliée de la vue de sortie (#1619) : `<details>` natif, clavier et lecteurs d'écran gratuits, ≥ 44 px. */
export function OutingSection({ id, title, summary, children }: { id: string; title: string; summary?: string; children: React.ReactNode }) {
  return (
    <details id={id} className="group rounded-2xl border border-border bg-card text-card-foreground">
      <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="text-heading">{title}</span>
        <span className="flex items-center gap-2 text-small text-muted-foreground tabular-nums">
          {summary}
          <ChevronDown aria-hidden className="size-5 shrink-0 transition-transform duration-150 group-open:rotate-180" />
        </span>
      </summary>
      <div className="flex flex-col gap-4 px-4 pt-1 pb-4">{children}</div>
    </details>
  );
}
