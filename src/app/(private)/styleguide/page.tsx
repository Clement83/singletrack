import type { Metadata } from 'next';
import tokens from '../../../../design/tokens.json';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { CharteSwitcher } from '@/components/charte-switcher';
import { ComponentDemos } from './demos';
import { ConcentricDemo, MaterialsDemo, StatesDemo, ThemePair } from './foundations';

export const metadata: Metadata = { title: 'Styleguide · Singletrack', robots: { index: false, follow: false } };

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="flex flex-col gap-4">
      <h2 id={`${id}-t`} className="text-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Visual reference of the design system (#1363): every token and component, every theme. */
export default function StyleguidePage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-gutter py-8 lg:px-gutter-lg">
      <header className="flex flex-col gap-3">
        <p className="text-label text-muted-foreground uppercase">Design system</p>
        <h1 className="text-display">singletrack</h1>
        <p className="text-muted-foreground">
          Source unique : <code className="text-small">design/tokens.json</code>, puis <code className="text-small">npm run tokens</code>.
        </p>
        <ThemeSwitcher />
        <CharteSwitcher />
      </header>

      <Section id="charte" title="Charte Singletrack">
        <p className="text-muted-foreground">
          Neutres raffinés, un seul accent, contours fins, ombres en couches, verre seulement au-dessus de la carte. Principes : <code className="text-small">design/README.md</code>.
        </p>
        <ThemePair />
      </Section>

      <Section id="materiaux" title="Matériaux sur la carte">
        <MaterialsDemo />
      </Section>

      <Section id="couleurs" title="Couleurs">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tokens.color.map((c) => (
            <li key={c.name} className="flex gap-3 rounded-2xl border border-border bg-card p-3">
              <span
                aria-hidden
                className="size-12 shrink-0 rounded-xl border border-border"
                style={{ background: `var(--${c.name})` }}
              />
              <div className="min-w-0">
                <p className="font-semibold">{c.name}</p>
                <p className="text-small text-muted-foreground">{c.usage}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="typo" title="Typographie">
        <ul className="flex flex-col gap-4">
          {tokens.text.map((t) => (
            <li key={t.name} className="flex flex-col gap-1 border-b border-border pb-4">
              <p className="text-caption text-muted-foreground">
                text-{t.name} · {t.size}/{t.lineHeight} · {t.weight}
                {t.letterSpacing ? ` · ${t.letterSpacing}` : ''}
              </p>
              <p
                className={t.name === 'label' ? 'uppercase' : 'tabular-nums'}
                style={{
                  fontSize: `var(--text-${t.name})`,
                  lineHeight: `var(--text-${t.name}--line-height)`,
                  fontWeight: `var(--text-${t.name}--font-weight)`,
                  letterSpacing: t.letterSpacing ? `var(--text-${t.name}--letter-spacing)` : undefined,
                }}
              >
                {t.sample}
              </p>
              <p className="text-small text-muted-foreground">{t.usage}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="formes" title="Rayons, ombres, tailles">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {tokens.radius.map((r) => (
            <div key={r.name} className="flex flex-col gap-2">
              <div className="h-16 border-2 border-primary bg-accent" style={{ borderRadius: `var(--radius-${r.name})` }} />
              <p className="text-small">
                rounded-{r.name} · {r.value}
              </p>
            </div>
          ))}
          {tokens.shadow.map((s) => (
            <div key={s.name} className="flex flex-col gap-2">
              <div className="h-16 rounded-2xl bg-card" style={{ boxShadow: `var(--elevation-${s.name})` }} />
              <p className="text-small">shadow-{s.name}</p>
            </div>
          ))}
        </div>
        <ul className="flex flex-col gap-1 text-small">
          {tokens.size.map((s) => (
            <li key={s.name}>
              <span className="font-semibold">{s.name}</span> · {s.value} — <span className="text-muted-foreground">{s.usage}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="etats" title="États et rayons concentriques">
        <StatesDemo />
        <ConcentricDemo />
      </Section>

      <Section id="mouvement" title="Mouvement">
        <ul className="flex flex-col gap-1 text-small">
          {[...tokens.motion, ...tokens.easing].map((m) => (
            <li key={m.name}>
              <span className="font-semibold">{m.name}</span> · <code className="text-caption">{m.value}</code> — <span className="text-muted-foreground">{m.usage}</span>
            </li>
          ))}
        </ul>
      </Section>

      <ComponentDemos />
    </main>
  );
}
