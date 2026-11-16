import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Bouton shadcn/ui adapté à la charte : zones tactiles ≥ 44 px, « lg » = action principale
// pleine largeur en bas d'écran (52 px).
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-colors duration-150 ease-out select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-sm active:brightness-95 hover:brightness-105',
        secondary: 'bg-secondary text-secondary-foreground active:bg-accent hover:bg-accent',
        ghost: 'text-foreground active:bg-accent hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground active:brightness-95 hover:brightness-105',
        outline: 'border border-input bg-card text-foreground active:bg-accent hover:bg-accent',
      },
      size: {
        md: 'min-h-touch px-4 text-body',
        lg: 'h-button-lg w-full px-5 text-body',
        icon: 'size-touch rounded-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
