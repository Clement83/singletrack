'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/field';
import { DIFFICULTY, type Difficulty } from '@/lib/design/scales';
import { SinglesLegend, useSinglesPref } from './singles-layer';
import type { TrackFilters } from '@/lib/tracks/filters';
import { cn } from '@/lib/utils';

type Props = { value: TrackFilters; onChange: (f: TrackFilters) => void; onReset: () => void };

const toNum = (v: string) => (v === '' || Number.isNaN(Number(v)) ? undefined : Math.max(0, Number(v)));

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'min-h-touch rounded-full border px-4 text-body font-medium transition-colors duration-150',
        on ? 'border-primary bg-primary text-primary-foreground hover:opacity-90 active:opacity-80' : 'border-input bg-card text-foreground hover:bg-accent/50 active:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

function toggle<T>(list: T[] | undefined, v: T): T[] | undefined {
  const cur = list ?? [];
  const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
  return next.length ? next : undefined;
}

/** Filters form: short numeric fields (numeric keyboard), chips, native select. */
export function FiltersForm({ value, onChange, onReset }: Props) {
  const tScales = useTranslations('scales');
  const t = useTranslations('filters');
  const tTrack = useTranslations('track');
  const tSingles = useTranslations('singles');
  const [singlesOn, setSinglesOn] = useSinglesPref();
  const set = (patch: Partial<TrackFilters>) => onChange({ ...value, ...patch });
  const pair = (label: string, a: 'minKm' | 'minGain', b: 'maxKm' | 'maxGain') => (
    <Field label={label}>
      {(c) => (
        <div className="flex items-center gap-2">
          <Input {...c} inputMode="numeric" placeholder={t('min')} defaultValue={value[a] ?? ''} key={`${a}-${value[a]}`} onBlur={(e) => set({ [a]: toNum(e.target.value) })} />
          <span aria-hidden>–</span>
          <Input aria-label={t('maxOf', { label })} inputMode="numeric" placeholder={t('max')} defaultValue={value[b] ?? ''} key={`${b}-${value[b]}`} onBlur={(e) => set({ [b]: toNum(e.target.value) })} />
        </div>
      )}
    </Field>
  );
  return (
    <form className="flex flex-col gap-5 pb-4" onSubmit={(e) => e.preventDefault()}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-body font-semibold">{t('difficulty')}</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
            <Chip key={d} on={!!value.difficulty?.includes(d)} onClick={() => set({ difficulty: toggle(value.difficulty, d) })}>
              {tScales(`difficulty.${d}`)}
            </Chip>
          ))}
        </div>
      </fieldset>
      {pair(t('distance'), 'minKm', 'maxKm')}
      {pair(t('gain'), 'minGain', 'maxGain')}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-body font-semibold">{t('shape')}</legend>
        <div className="flex flex-wrap gap-2">
          <Chip on={!value.shape} onClick={() => set({ shape: undefined })}>{t('all')}</Chip>
          <Chip on={value.shape === 'loop'} onClick={() => set({ shape: 'loop' })}>{tTrack('loop')}</Chip>
          <Chip on={value.shape === 'oneway'} onClick={() => set({ shape: 'oneway' })}>{tTrack('oneway')}</Chip>
        </div>
      </fieldset>
      <Field label={t('near')}>
        {(c) => (
          <NativeSelect {...c} value={value.near ?? ''} onChange={(e) => set({ near: toNum(e.target.value) })}>
            <option value="">{t('nearAll')}</option>
            {[5, 10, 20, 30, 50].map((k) => (
              <option key={k} value={k}>{t('nearKm', { km: k })}</option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-body font-semibold">{tSingles('toggle')}</legend>
        <div className="flex flex-wrap gap-2">
          <Chip on={singlesOn} onClick={() => setSinglesOn(!singlesOn)}>{tSingles('show')}</Chip>
        </div>
        {singlesOn && <SinglesLegend />}
      </fieldset>
      <Button variant="secondary" type="button" onClick={onReset}>{t('reset')}</Button>
    </form>
  );
}
