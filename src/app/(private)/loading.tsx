import { Skeleton } from '@/components/ui/skeleton';

// Squelette commun des pages privées pendant le rendu serveur (#1649) : la forme d'un titre et de deux cartes.
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-gutter py-6" aria-busy>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}
