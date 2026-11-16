import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge doit connaître nos tailles de texte (text-body, text-small…) pour ne pas les
// confondre avec des couleurs (text-foreground) et supprimer l'une des deux.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display', 'title', 'heading', 'body', 'small', 'label', 'caption', 'stat'] }],
    },
  },
});

/** Combine des classes Tailwind (convention shadcn/ui). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
