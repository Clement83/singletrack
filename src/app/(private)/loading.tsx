import { Skeleton } from '@/components/ui/skeleton';

// Shared skeleton of the private pages during server rendering (#1649): the shape of a title and two cards.
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-gutter py-6" aria-busy>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}
