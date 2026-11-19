import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// shadcn/ui button adapted to the Singletrack charter (#1646): touch areas ≥ 44 px, control radius (6 px), spring press (`press`),
// 18 px thin-stroke icons; "lg" = full-width main action at the bottom of the screen (52 px).
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium press select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:stroke-[1.75]',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-sm hover:brightness-110 active:brightness-95',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent active:bg-accent',
        ghost: 'text-foreground active:bg-accent hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:brightness-110 active:brightness-95',
        glass: 'glass border border-border text-foreground shadow-md hover:brightness-95 active:brightness-90',
        outline: 'border border-input bg-card text-foreground hover:bg-accent active:bg-accent',
      },
      size: {
        md: 'min-h-touch px-4 text-body',
        lg: 'h-button-lg w-full px-5 text-body',
        icon: 'size-touch',
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
