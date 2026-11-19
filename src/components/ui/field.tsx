import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// Form fields: 16 px (no iOS zoom), height ≥ 44 px, `input` outline (≥ 3:1).
// Native select (charter: native selects on mobile).
const control =
  'w-full min-h-touch rounded-md border border-input bg-card px-3 text-body text-foreground shadow-sm transition-[border-color,box-shadow] duration-150 ease-out hover:border-foreground/30 aria-invalid:border-destructive disabled:pointer-events-none disabled:opacity-50';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(control, 'py-2', className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(control, 'min-h-28 py-3', className)} {...props} />;
}

export function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select data-slot="select" className={cn(control, 'appearance-none py-2 pr-10', className)} {...props}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-[18px] -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label data-slot="label" className={cn('text-small font-medium text-foreground', className)} {...props} />;
}

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  /** Receives the id and the ARIA attributes to set on the control. */
  children: (control: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => React.ReactNode;
};

/** Label + control + help or error, linked for screen readers. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const descId = error || hint ? `${id}-desc` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, 'aria-describedby': descId, 'aria-invalid': error ? true : undefined })}
      {(error || hint) && (
        <p id={descId} className={cn('text-small', error ? 'text-destructive' : 'text-muted-foreground')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
