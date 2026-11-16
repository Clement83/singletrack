import { cn } from '@/lib/utils';

// Titre de page des écrans privés (#1426) : sur mobile, il tient dans la même ligne que l'avatar du `UserMenu`
// (fixe, en haut à gauche, 40 px) au lieu de passer dessous ; en desktop (avatar dans la barre latérale) il n'est pas décalé.
export const PAGE_TOP_PAD = 'pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-16';

export function PageHeader({ title, children, className }: { title: string; children?: React.ReactNode; className?: string }) {
  return (
    <header className={cn('flex flex-col gap-1 pl-[3.25rem] lg:pl-0', className)}>
      <h1 className="flex min-h-10 items-center text-title lg:min-h-0"><span className="min-w-0 truncate">{title}</span></h1>
      {children}
    </header>
  );
}
