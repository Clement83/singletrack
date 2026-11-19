import { CircleCheck, CircleHelp, OctagonX, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { OverallTone } from '@/lib/conditions';

/** Icon and colour of the "Conditions" verdict (outings block and organisation screen line, #1407). */
export const OVERALL: Record<OverallTone, { icon: LucideIcon; className: string }> = {
  ok: { icon: CircleCheck, className: 'text-success' },
  warn: { icon: TriangleAlert, className: 'text-warning' },
  danger: { icon: OctagonX, className: 'text-destructive' },
  unknown: { icon: CircleHelp, className: 'text-muted-foreground' },
};
